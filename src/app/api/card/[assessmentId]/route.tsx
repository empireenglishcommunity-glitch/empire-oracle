// EMPIRE ENGLISH COMMUNITY — Rank card image
// ═══════════════════════════════════════════════════════════
//
// GET /api/card/<assessmentId>  →  1200×630 PNG
//
// EVERY VALUE IS READ FROM THE DATABASE INSIDE THIS HANDLER.
// No score, rank, name or date is accepted as a query parameter — not one.
//
// This is the single most important property of the endpoint. If a card could be
// minted from a query string, anyone could produce a Champion card with a perfect
// score, and the credibility of every genuine card would be gone. The whole point
// of the artefact is that it cannot be faked, so the endpoint takes an identifier
// and nothing else.
//
// Spec: .kiro/specs/placement-report-and-rank-cards/ (requirements R5.1, R5.2,
// R3.5; design §4.2)

import { ImageResponse } from 'next/og';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkRateLimit, getClientIdentifier, createRateLimitHeaders } from '@/lib/rate-limiter';
import { buildRankCard, type RankCardSource } from '@/lib/rank-card';
import { RankCard, CARD_WIDTH, CARD_HEIGHT } from '@/components/og/RankCard';

const SITE_LABEL = 'assessment.empireenglish.online';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ assessmentId: string }> }
) {
  // Rasterising an image is far more expensive than serving JSON, so this route is
  // a cheap denial-of-service target if left open.
  const rate = checkRateLimit(getClientIdentifier(req), 'general');
  if (!rate.allowed) {
    return NextResponse.json(
      { error: rate.reason ?? 'Rate limit exceeded' },
      { status: 429, headers: createRateLimitHeaders(rate) }
    );
  }

  const { assessmentId } = await params;

  // Accept either the assessment id (owner-facing) or a public share slug.
  const assessment = await db.assessment.findFirst({
    where: {
      OR: [{ id: assessmentId }, { shareSlug: assessmentId }],
    },
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

  if (!assessment) {
    return new NextResponse('Not found', { status: 404 });
  }

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
    // 404 rather than 4xx-with-detail: an unfinished or flagged result should be
    // indistinguishable from one that does not exist. Saying "this exists but is
    // flagged" leaks a judgement about a person to anyone holding the URL.
    return new NextResponse('Not found', { status: 404 });
  }

  return new ImageResponse(
    <RankCard model={built.model} siteLabel={SITE_LABEL} />,
    {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      headers: {
        // A completed assessment's values never change, so the image is immutable.
        // Long caching also blunts the DoS surface noted above.
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, immutable',
      },
    }
  );
}
