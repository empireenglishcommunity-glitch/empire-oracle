// EMPIRE ENGLISH COMMUNITY — Rank card view model
// ═══════════════════════════════════════════════════════════
//
// A PURE function from an assessment row to the values a card shows.
//
// Kept separate from the route on purpose: the route needs a database, this does
// not. That means the card's pixels can be rendered and LOOKED AT in a script with
// no DB, no auth and no network — which is the only way the "render it and inspect
// it" requirement is actually affordable to satisfy on every change.
//
// Spec: .kiro/specs/placement-report-and-rank-cards/ (requirements R5, design §4)

import {
  placementLevelForBand,
  rankForBand,
  rankForLevel,
  isCefrBand,
  type CefrCode,
} from './cefr-mapping';

/** The subset of `Assessment` (+ user) a card needs. Nothing more is read. */
export interface RankCardSource {
  status: string;
  flagged: boolean;
  cefrLevel: string | null;
  assignedLevel: number | null;
  totalScore: number | null;
  readingScore: number | null;
  listeningScore: number | null;
  speakingScore: number | null;
  writingScore: number | null;
  voEstimatedSize: number | null;
  spWordsPerMinute: number | null;
  completedAt: Date | null;
  displayName: string | null;
}

export interface RankCardModel {
  rank: string;
  band: string | null;
  placement: CefrCode | null;
  /** 0–120, TOEFL-STYLE. Never labelled as a TOEFL score. */
  totalScore: number | null;
  /** The single most memorable number the system can produce. */
  vocabulary: number | null;
  /** One standout metric, because no competitor reports it. */
  wordsPerMinute: number | null;
  sections: { label: string; score: number }[];
  /** FIRST NAME ONLY — a card is public (R5.3). */
  firstName: string | null;
  dateLabel: string | null;
}

/**
 * Why a card cannot be produced. Returned rather than thrown so the route can map
 * each case to the right status code and the harness can enumerate them.
 */
export type RankCardRefusal =
  | 'not_completed'   // an unfinished result is not a result
  | 'flagged'         // the system distrusts this score; never publish it
  | 'no_band';        // scoring did not produce a band

/**
 * FIRST NAME ONLY.
 *
 * A rank card is a public image on other people's timelines. Publishing a full
 * name — which for many users is their real legal name — is a privacy leak the
 * user did not ask for when they took an English test.
 */
export function firstNameOf(displayName: string | null): string | null {
  if (!displayName) return null;
  const first = displayName.trim().split(/\s+/)[0] ?? '';
  if (!first) return null;
  // Guard the layout: a very long single token would otherwise overflow the card.
  return first.length > 18 ? `${first.slice(0, 17)}…` : first;
}

export function buildRankCard(
  source: RankCardSource
): { ok: true; model: RankCardModel } | { ok: false; reason: RankCardRefusal } {
  // An unfinished assessment has no result to publish.
  if (source.status !== 'completed') {
    return { ok: false, reason: 'not_completed' };
  }

  // The system itself distrusts this score. Publishing it — or selling it — is
  // indefensible, so the refusal is structural rather than a caller's choice.
  if (source.flagged) {
    return { ok: false, reason: 'flagged' };
  }

  if (!isCefrBand(source.cefrLevel)) {
    return { ok: false, reason: 'no_band' };
  }

  // Prefer the band for the rank, since the band is what was measured. Fall back
  // to the stored level so an older row still renders.
  const rank = rankForBand(source.cefrLevel) ?? rankForLevel(source.assignedLevel);
  if (!rank) return { ok: false, reason: 'no_band' };

  // Sections are included only where a score exists. A missing section is omitted
  // rather than shown as 0 — "0 /30" reads as a failure, absence reads as
  // "not measured", and those are very different things to publish about someone.
  const sectionCandidates: { label: string; score: number | null }[] = [
    { label: 'Reading', score: source.readingScore },
    { label: 'Listening', score: source.listeningScore },
    { label: 'Speaking', score: source.speakingScore },
    { label: 'Writing', score: source.writingScore },
  ];

  const sections = sectionCandidates
    .filter((entry): entry is { label: string; score: number } => typeof entry.score === 'number')
    .map((entry) => ({ label: entry.label, score: Math.round(entry.score) }));

  return {
    ok: true,
    model: {
      rank,
      band: source.cefrLevel,
      placement: placementLevelForBand(source.cefrLevel),
      totalScore: source.totalScore === null ? null : Math.round(source.totalScore),
      vocabulary: source.voEstimatedSize === null ? null : Math.round(source.voEstimatedSize),
      wordsPerMinute:
        source.spWordsPerMinute === null ? null : Math.round(source.spWordsPerMinute),
      sections,
      firstName: firstNameOf(source.displayName),
      dateLabel: source.completedAt
        ? source.completedAt.toLocaleDateString('en-GB', {
            month: 'short',
            year: 'numeric',
          })
        : null,
    },
  };
}

// ─── Share slugs ───────────────────────────────────────────

/**
 * Unguessable share slug.
 *
 * NOT the assessment id. The id is a cuid that appears in authenticated URLs, and
 * making it the public handle would mean anyone holding a link to their own result
 * could enumerate toward someone else's. A separate random token also makes
 * revocation possible: clearing it 404s the card without touching the assessment.
 */
export function generateShareSlug(): string {
  // Unambiguous alphabet — no 0/O/1/I/l — because these get read aloud and retyped.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}
