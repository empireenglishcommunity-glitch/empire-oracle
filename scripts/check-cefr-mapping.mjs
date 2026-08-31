#!/usr/bin/env node
/**
 * CEFR mapping invariants. Exits non-zero on failure.
 *
 * This repo has no test framework, so these are written as a gate script in the
 * same style as the render harness rather than introducing one for a handful of
 * assertions. If a framework is adopted later, move them wholesale.
 *
 * What is protected here is the join between two systems: this app measures a BAND,
 * the learning system teaches six DISCRETE LEVELS, and a mismatch between them puts
 * a real student in the wrong cohort.
 *
 *   npx tsx scripts/check-cefr-mapping.mjs
 *
 * Spec: requirements R4.2; design §2
 */

import { readFileSync } from 'node:fs';
import {
  CEFR_BANDS,
  CEFR_LEVELS,
  CEFR_ORDER,
  BAND_TO_PLACEMENT,
  BAND_TO_IMPERIAL_LEVEL,
  placementLevelForBand,
  rankForBand,
  rankForLevel,
  isCefrBand,
  placementExplanation,
  totalWeeks,
} from '../src/lib/cefr-mapping.ts';
import { IMPERIAL_RANKS } from '../src/lib/types.ts';
import { firstNameOf, buildRankCard, generateShareSlug } from '../src/lib/rank-card.ts';

const failures = [];
const fail = (m) => failures.push(m);
const ok = (cond, m) => { if (!cond) fail(m); };

// ── 1. Every band maps to exactly one level, and that level is real ──
for (const band of CEFR_BANDS) {
  const level = BAND_TO_PLACEMENT[band];
  ok(level !== undefined, `band "${band}" has no placement level`);
  ok(CEFR_LEVELS[level] !== undefined, `band "${band}" maps to unknown level "${level}"`);
  ok(placementLevelForBand(band) === level, `placementLevelForBand("${band}") disagrees with the table`);
}

// ── 2. Placement is the FLOOR of the band, never the ceiling ──
// The whole justification for the mapping. If this ever inverts, students get
// placed above their level and the programme fails them rather than the reverse.
for (const band of CEFR_BANDS) {
  const [low] = band.split('-');
  ok(
    BAND_TO_PLACEMENT[band] === low,
    `band "${band}" places at "${BAND_TO_PLACEMENT[band]}" but its floor is "${low}" — ` +
      `placement must be the conservative floor`
  );
}

// ── 3. The schema comment and the band list agree ──
// The bands exist as a comment on Assessment.cefrLevel. If someone edits the schema
// and not this file, the mapping silently stops covering reality.
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const commentLine = schema.split('\n').find((l) => l.includes('cefrLevel') && l.includes('//'));
ok(Boolean(commentLine), 'could not find the cefrLevel comment in schema.prisma');
if (commentLine) {
  const documented = commentLine
    .slice(commentLine.indexOf('//') + 2)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const band of documented) {
    ok(
      isCefrBand(band),
      `schema documents band "${band}" but cefr-mapping.ts does not know it — ` +
        `add it to CEFR_BANDS and BAND_TO_PLACEMENT`
    );
  }
  for (const band of CEFR_BANDS) {
    ok(
      documented.includes(band),
      `cefr-mapping.ts knows band "${band}" but the schema comment does not list it`
    );
  }
}

// ── 4. Ranks come from types.ts, and there is no second vocabulary ──
for (const band of CEFR_BANDS) {
  const level = BAND_TO_IMPERIAL_LEVEL[band];
  ok(level !== undefined, `band "${band}" has no imperial level`);
  ok(IMPERIAL_RANKS[level] !== undefined, `imperial level ${level} has no rank name`);
  ok(rankForBand(band) === IMPERIAL_RANKS[level], `rankForBand("${band}") disagrees with IMPERIAL_RANKS`);
}
ok(rankForLevel(0) === 'Recruit', 'rankForLevel(0) should be Recruit');
ok(rankForLevel(3) === 'Champion', 'rankForLevel(3) should be Champion');
ok(rankForLevel(4) === null, 'rankForLevel(4) must be null, not a silent fallback');
ok(rankForLevel(-1) === null, 'rankForLevel(-1) must be null');
ok(rankForLevel(1.5) === null, 'rankForLevel(1.5) must be null');
ok(rankForLevel(null) === null, 'rankForLevel(null) must be null');

// ── 5. Unknown bands return null rather than guessing ──
// A guess here would place a student in a cohort based on nothing.
ok(placementLevelForBand('B2-C1') === null, 'an unrecognised band must not map to a level');
ok(placementLevelForBand(null) === null, 'null band must map to null');
ok(placementLevelForBand('') === null, 'empty band must map to null');
ok(rankForBand('nonsense') === null, 'an unrecognised band must not map to a rank');

// ── 6. Six levels, in order, mirroring the bot ──
ok(CEFR_ORDER.length === 6, `expected 6 CEFR levels, found ${CEFR_ORDER.length}`);
CEFR_ORDER.forEach((code, i) => {
  ok(CEFR_LEVELS[code]?.order === i, `level ${code} has order ${CEFR_LEVELS[code]?.order}, expected ${i}`);
  ok(Boolean(CEFR_LEVELS[code]?.nameAr), `level ${code} is missing nameAr`);
});
// Weeks per level from the bot's config.py: 10/12/14/16/18/20 → 90.
ok(totalWeeks() === 90, `total weeks is ${totalWeeks()}, expected 90 (A1..C2 = 10+12+14+16+18+20)`);

// ── 7. The explanation appears exactly when a band spans two levels ──
for (const band of CEFR_BANDS) {
  const spans = band.includes('-');
  const text = placementExplanation(band);
  ok(
    spans ? typeof text === 'string' : text === null,
    `placementExplanation("${band}") should ${spans ? 'explain the floor' : 'be null'}`
  );
}

// ── 8. Card refusals are structural ──
const complete = {
  status: 'completed', flagged: false, cefrLevel: 'B1-B2', assignedLevel: 2,
  totalScore: 78, readingScore: 21, listeningScore: 19, speakingScore: 20, writingScore: 18,
  voEstimatedSize: 3400, spWordsPerMinute: 112, completedAt: new Date('2026-08-31'),
  displayName: 'Test User',
};
ok(buildRankCard(complete).ok, 'a complete assessment should produce a card');
ok(buildRankCard({ ...complete, status: 'in_progress' }).ok === false, 'in_progress must be refused');
ok(buildRankCard({ ...complete, flagged: true }).ok === false, 'a flagged result must be refused');
ok(buildRankCard({ ...complete, cefrLevel: null }).ok === false, 'a missing band must be refused');

// ── 9. Only a first name is ever published ──
ok(firstNameOf('Mahmoud Ashri') === 'Mahmoud', 'only the first name should be used');
ok(firstNameOf('  Nour   Ibrahim ') === 'Nour', 'first name should be trimmed');
ok(firstNameOf(null) === null, 'a missing display name yields null');
ok(firstNameOf('   ') === null, 'a whitespace-only name yields null');
ok((firstNameOf('Abdurrahmanalmuhammadi') ?? '').length <= 18, 'a long single token must be truncated');

// ── 10. Share slugs are unguessable and unambiguous ──
const slugs = new Set(Array.from({ length: 2000 }, () => generateShareSlug()));
ok(slugs.size === 2000, `slug collision in 2000 draws (${slugs.size} unique) — entropy too low`);
for (const s of Array.from(slugs).slice(0, 50)) {
  ok(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{16}$/.test(s), `slug "${s}" uses an ambiguous or unexpected character`);
}

// ── Report ──
if (failures.length) {
  console.error(`\n✗ ${failures.length} CEFR mapping failure(s):\n`);
  for (const f of failures) console.error(`  • ${f}`);
  console.error('');
  process.exit(1);
}
console.log(
  `✓ CEFR mapping: ${CEFR_BANDS.length} bands → 6 levels, placement is the floor of every band, ` +
    `ranks match types.ts, unknown input returns null.`
);
