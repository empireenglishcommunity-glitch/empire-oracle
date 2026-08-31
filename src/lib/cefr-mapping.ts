// EMPIRE ENGLISH COMMUNITY — CEFR band ↔ placement level mapping
// ═══════════════════════════════════════════════════════════
//
// THE PROBLEM THIS FILE SOLVES
// ─────────────────────────────
// This app measures a BAND (`Assessment.cefrLevel` is "A1" | "A2-B1" | "B1-B2" |
// "C1-C2"). The learning system — the Discord bot and the practice platform —
// teaches SIX DISCRETE LEVELS (A1…C2). So a test-taker can be told "B1-B2" here
// and then placed in "B1" over there.
//
// Left unexplained, that reads as a downgrade and invites a refund request. It is
// not a downgrade: placement deliberately takes the CONSERVATIVE FLOOR of the
// band, because starting a student one level low costs them a few easy weeks,
// while starting them one level high costs them the whole programme.
//
// Any surface that shows a band MUST also show the placement level and say why.
//
// THIS IS THE ONLY BAND→LEVEL MAPPING IN THIS REPO. Do not add a second one.
//
// Spec: .kiro/specs/placement-report-and-rank-cards/ (requirements R4, design §2)

import { IMPERIAL_RANKS, type ImperialLevel } from './types';

// ─── The six CEFR levels ───────────────────────────────────
//
// MIRRORED from the canonical source: the learning bot's
// `empire-nexus/bots/discord-learning-bot/src/config.py` → `CEFR_LEVELS`
// (verified 2026-08-31 at config.py:295-349). `empire-agora/src/curriculum/cefr.ts`
// mirrors the same table.
//
// Re-verify against the bot rather than editing these values freely — if they
// drift, a buyer is told one thing here and placed by another there.

export type CefrCode = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export interface CefrLevel {
  code: CefrCode;
  /** Official Council of Europe descriptor. */
  title: string;
  nameEn: string;
  /** Arabic name — as the bot uses it, so both systems agree. */
  nameAr: string;
  /** Expected weeks to complete this level. */
  weeks: number;
  order: number;
}

export const CEFR_LEVELS: Record<CefrCode, CefrLevel> = {
  A1: { code: 'A1', title: 'Breakthrough', nameEn: 'Beginner', nameAr: 'مبتدئ', weeks: 10, order: 0 },
  A2: { code: 'A2', title: 'Waystage', nameEn: 'Elementary', nameAr: 'أساسي', weeks: 12, order: 1 },
  B1: { code: 'B1', title: 'Threshold', nameEn: 'Intermediate', nameAr: 'متوسط', weeks: 14, order: 2 },
  B2: { code: 'B2', title: 'Vantage', nameEn: 'Upper-Intermediate', nameAr: 'فوق المتوسط', weeks: 16, order: 3 },
  C1: { code: 'C1', title: 'Effective Operational Proficiency', nameEn: 'Advanced', nameAr: 'متقدّم', weeks: 18, order: 4 },
  C2: { code: 'C2', title: 'Mastery', nameEn: 'Proficiency', nameAr: 'إتقان', weeks: 20, order: 5 },
};

export const CEFR_ORDER: readonly CefrCode[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

// ─── Bands ─────────────────────────────────────────────────
//
// The exact strings `Assessment.cefrLevel` can hold, per the schema comment on
// that column. Keep this list in sync with the schema; the test asserts it.

export type CefrBand = 'A1' | 'A2-B1' | 'B1-B2' | 'C1-C2';

export const CEFR_BANDS: readonly CefrBand[] = ['A1', 'A2-B1', 'B1-B2', 'C1-C2'] as const;

/**
 * Band → the level a student is actually placed into.
 *
 * Always the FLOOR of the band. See the note at the top of this file: this is a
 * deliberate, explainable choice, not a rounding accident.
 */
export const BAND_TO_PLACEMENT: Record<CefrBand, CefrCode> = {
  'A1': 'A1',
  'A2-B1': 'A2',
  'B1-B2': 'B1',
  'C1-C2': 'C1',
};

/** Band → the imperial rank this app awards. Ranks are test outcomes, not a ladder. */
export const BAND_TO_IMPERIAL_LEVEL: Record<CefrBand, ImperialLevel> = {
  'A1': 0,
  'A2-B1': 1,
  'B1-B2': 2,
  'C1-C2': 3,
};

// ─── Lookups ───────────────────────────────────────────────

export function isCefrBand(value: unknown): value is CefrBand {
  return typeof value === 'string' && (CEFR_BANDS as readonly string[]).includes(value);
}

/**
 * The level a band places into, or null for an unrecognised/absent band.
 *
 * Returns null rather than guessing. An unknown band means the assessment did not
 * finish scoring, and inventing a level for it would put a real student in the
 * wrong cohort.
 */
export function placementLevelForBand(band: string | null | undefined): CefrCode | null {
  if (!isCefrBand(band)) return null;
  return BAND_TO_PLACEMENT[band];
}

/** The rank name for a band, using the ranks already defined in `types.ts`. */
export function rankForBand(band: string | null | undefined): string | null {
  if (!isCefrBand(band)) return null;
  return IMPERIAL_RANKS[BAND_TO_IMPERIAL_LEVEL[band]];
}

/** The rank name for a stored `assignedLevel`, tolerating out-of-range values. */
export function rankForLevel(level: number | null | undefined): string | null {
  if (level === null || level === undefined) return null;
  if (level < 0 || level > 3 || !Number.isInteger(level)) return null;
  return IMPERIAL_RANKS[level as ImperialLevel];
}

/**
 * The one-line explanation that turns an apparent contradiction into evidence of
 * rigour. Any surface showing both a band and a placement level should show this.
 */
export function placementExplanation(band: CefrBand): string | null {
  const placement = BAND_TO_PLACEMENT[band];
  if (band === placement) return null; // single-level band, nothing to explain
  return (
    `Your test places you in the ${band} range. You would start at ${placement} — ` +
    `deliberately the lower end, so the first weeks build confidence instead of ` +
    `exposing gaps.`
  );
}

/** Total weeks from A1 to C2. Derived, so it cannot go stale in prose. */
export function totalWeeks(): number {
  return CEFR_ORDER.reduce((sum, code) => sum + CEFR_LEVELS[code].weeks, 0);
}
