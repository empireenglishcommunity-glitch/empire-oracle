// EMPIRE ENGLISH COMMUNITY — Public rank card landing page
// ═══════════════════════════════════════════════════════════
//
// /rank/<shareSlug>
//
// The page a shared card links to. Its most important job is not what a human sees
// — it is the OpenGraph metadata, because that is what makes the card UNFURL as a
// picture in WhatsApp, Telegram and X instead of arriving as a bare link.
//
// In this market WhatsApp is the channel. A card that does not unfurl there is not
// a viral loop, it is a download nobody opens. `metadata.openGraph.images` is
// therefore the feature, and the visible page is the landing that converts.
//
// Spec: requirements R5.5, R5.6; design §4.2

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { buildRankCard, type RankCardSource } from '@/lib/rank-card';
import { CEFR_LEVELS, placementExplanation, isCefrBand } from '@/lib/cefr-mapping';

const SELECT = {
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
  user: { select: { displayName: true } },
} as const;

async function load(shareSlug: string) {
  // Keyed on the share slug ONLY. The assessment id is never a public handle, so a
  // revoked card (slug cleared) becomes unreachable here immediately.
  const assessment = await db.assessment.findFirst({
    where: { shareSlug },
    select: SELECT,
  });
  if (!assessment) return null;

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
  return built.ok ? built.model : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shareSlug: string }>;
}): Promise<Metadata> {
  const { shareSlug } = await params;
  const model = await load(shareSlug);

  if (!model) {
    return { title: 'Not found', robots: { index: false, follow: false } };
  }

  const who = model.firstName ? `${model.firstName} — ` : '';
  const title = `${who}${model.rank} · Empire English`;
  const description = model.totalScore
    ? `Scored ${model.totalScore} of 120 on the Empire English placement assessment. ` +
      `CEFR-aligned, not certified.`
    : `Earned the rank of ${model.rank} on the Empire English placement assessment.`;

  const image = `/api/card/${shareSlug}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      images: [{ url: image, width: 1200, height: 630, alt: `${model.rank} rank card` }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
    },
    // A shared result should not accumulate in search results. The owner opted into
    // showing it to the people they sent it to, not to everyone forever.
    robots: { index: false, follow: false },
  };
}

export default async function RankPage({
  params,
}: {
  params: Promise<{ shareSlug: string }>;
}) {
  const { shareSlug } = await params;
  const model = await load(shareSlug);
  if (!model) notFound();

  const band = model.band;
  const explanation = isCefrBand(band) ? placementExplanation(band) : null;
  const placementLevel = model.placement ? CEFR_LEVELS[model.placement] : null;

  return (
    <main
      style={{
        minHeight: '100vh',
        backgroundColor: '#0a0a0a',
        color: '#e8e0d0',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '48px 20px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 780 }}>
        {/* The card itself, as the page's hero. Same image the unfurl uses, so what
            a visitor sees matches what they were shown in the chat. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/card/${shareSlug}`}
          alt={`${model.rank} rank card`}
          width={1200}
          height={630}
          style={{
            width: '100%',
            height: 'auto',
            borderRadius: 4,
            border: '1px solid rgba(201,168,76,0.25)',
          }}
        />

        <h1 style={{ marginTop: 32, fontSize: 28, color: '#e8d48b', letterSpacing: 1 }}>
          {model.firstName ? `${model.firstName} — ${model.rank}` : model.rank}
        </h1>

        {explanation ? (
          <p style={{ marginTop: 12, lineHeight: 1.7, color: '#a08a68' }}>{explanation}</p>
        ) : null}

        {placementLevel ? (
          <p style={{ marginTop: 12, lineHeight: 1.7, color: '#a08a68' }}>
            {placementLevel.code} · {placementLevel.title} — about {placementLevel.weeks} weeks
            at this level.
          </p>
        ) : null}

        <div
          style={{
            marginTop: 32,
            paddingTop: 24,
            borderTop: '1px solid rgba(201,168,76,0.2)',
          }}
        >
          <a
            href="/"
            style={{
              display: 'inline-block',
              padding: '14px 28px',
              borderRadius: 3,
              background: 'linear-gradient(180deg,#e8d48b,#c9a84c)',
              color: '#0a0a0a',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Take the assessment
          </a>
        </div>

        {/* The honesty statement in full. The card carries a compressed version
            because it travels without its page; here there is room to be complete. */}
        <p style={{ marginTop: 40, fontSize: 13, lineHeight: 1.7, color: '#8b7355' }}>
          This result is <strong>CEFR-aligned, not certified</strong>. The 0–120 figure is a
          TOEFL-<em>style</em> scale used internally by Empire English — it is{' '}
          <strong>not a TOEFL score</strong>, and Empire English is not affiliated with ETS or
          any examining body. Speaking and writing are scored with automated evaluation.
        </p>
      </div>
    </main>
  );
}
