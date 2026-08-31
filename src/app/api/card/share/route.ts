// EMPIRE ENGLISH COMMUNITY — Rank card sharing (opt in / revoke)
// ═══════════════════════════════════════════════════════════
//
// POST   /api/card/share  { assessmentId }  → creates a share slug
// DELETE /api/card/share  { assessmentId }  → revokes it
//
// Sharing a result is OPT-IN. A placement score is personal information, and a
// system that publishes one automatically has made a decision that was not its to
// make. Revocation is a first-class operation for the same reason: someone who
// shares a Recruit card in January may not want it public in June.
//
// Spec: requirements R5.4, R5.7; design §4.2

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { checkRateLimit, getClientIdentifier, createRateLimitHeaders } from '@/lib/rate-limiter';
import { buildRankCard, generateShareSlug, type RankCardSource } from '@/lib/rank-card';

/** Resolve the caller, matching the pattern used by the other routes here. */
async function resolveUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const fromSession = (session?.user as Record<string, unknown> | undefined)?.id as
    | string
    | undefined;
  if (fromSession) return fromSession;
  if (session?.user?.email) {
    const user = await db.user.findUnique({ where: { email: session.user.email } });
    return user?.id ?? null;
  }
  return null;
}

/**
 * Load an assessment the caller actually owns.
 *
 * Fails closed: an assessment belonging to someone else is reported as not found,
 * never as forbidden, so this cannot be used to discover which ids exist.
 */
async function loadOwnedAssessment(assessmentId: string, userId: string) {
  return db.assessment.findFirst({
    where: { id: assessmentId, userId },
    select: {
      id: true,
      status: true,
      flagged: true,
      cefrLevel: true,
      assignedLevel: true,
      totalScore: true,
      readingScore: true,
      listeningScore: true,
      speakingScore: true,
      writingScore: true,
      voEstimatedSize: true,
      spWordsPerMinute: true,
      completedAt: true,
      shareSlug: true,
      user: { select: { displayName: true } },
    },
  });
}

export async function POST(req: NextRequest) {
  const rate = checkRateLimit(getClientIdentifier(req), 'general');
  if (!rate.allowed) {
    return NextResponse.json(
      { error: rate.reason ?? 'Rate limit exceeded' },
      { status: 429, headers: createRateLimitHeaders(rate) }
    );
  }

  const userId = await resolveUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  let body: { assessmentId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof body.assessmentId !== 'string' || !body.assessmentId) {
    return NextResponse.json({ error: 'assessmentId is required' }, { status: 400 });
  }

  const assessment = await loadOwnedAssessment(body.assessmentId, userId);
  if (!assessment) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Refuse to mint a shareable link for something that must not be published — an
  // unfinished result, or one the system itself distrusts. Checked here as well as
  // in the image route so a slug for an unpublishable result never exists at all.
  const source: RankCardSource = {
    status: assessment.status,
    flagged: assessment.flagged,
    cefrLevel: assessment.cefrLevel,
    assignedLevel: assessment.assignedLevel,
    totalScore: assessment.totalScore,
    readingScore: assessment.readingScore,
    listeningScore: assessment.listeningScore,
    speakingScore: assessment.speakingScore,
    writingScore: assessment.writingScore,
    voEstimatedSize: assessment.voEstimatedSize,
    spWordsPerMinute: assessment.spWordsPerMinute,
    completedAt: assessment.completedAt,
    displayName: assessment.user?.displayName ?? null,
  };
  const built = buildRankCard(source);
  if (!built.ok) {
    return NextResponse.json(
      { error: 'This result cannot be shared', reason: built.reason },
      { status: 409 }
    );
  }

  // Idempotent: asking twice returns the existing slug rather than rotating it,
  // so a link already sent to someone does not silently die.
  const shareSlug = assessment.shareSlug ?? generateShareSlug();
  if (!assessment.shareSlug) {
    await db.assessment.update({
      where: { id: assessment.id },
      data: { shareSlug, sharedAt: new Date() },
    });
  }

  return NextResponse.json({ shareSlug, url: `/rank/${shareSlug}` }, { status: 200 });
}

export async function DELETE(req: NextRequest) {
  const rate = checkRateLimit(getClientIdentifier(req), 'general');
  if (!rate.allowed) {
    return NextResponse.json(
      { error: rate.reason ?? 'Rate limit exceeded' },
      { status: 429, headers: createRateLimitHeaders(rate) }
    );
  }

  const userId = await resolveUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  let body: { assessmentId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof body.assessmentId !== 'string' || !body.assessmentId) {
    return NextResponse.json({ error: 'assessmentId is required' }, { status: 400 });
  }

  const assessment = await db.assessment.findFirst({
    where: { id: body.assessmentId, userId },
    select: { id: true },
  });
  if (!assessment) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Clearing the slug is the revocation. Both the landing page and the image route
  // key on it, so they 404 immediately afterwards.
  await db.assessment.update({
    where: { id: assessment.id },
    data: { shareSlug: null, sharedAt: null },
  });

  return NextResponse.json({ revoked: true }, { status: 200 });
}
