#!/usr/bin/env node
/**
 * Render rank cards to PNG for VISUAL INSPECTION.
 *
 * WHY THIS SCRIPT EXISTS
 * ──────────────────────
 * A rank card is a public image that lands on other people's timelines. A rendering
 * bug in it is not a private defect — it is a defect other people see and screenshot.
 * So the spec requires rendering every rank plus the edge cases and LOOKING at the
 * output, rather than inferring correctness from a 200 response.
 *
 * This runs with no database, no auth and no network, because `buildRankCard` and
 * `RankCard` are pure. That is the whole reason they were kept separate from the
 * route: verification has to be cheap enough to actually do on every change.
 *
 *   npx tsx scripts/render-rank-cards.mjs [outDir]
 *
 * Spec: .kiro/specs/placement-report-and-rank-cards/design.md §4.3
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { buildRankCard } from '../src/lib/rank-card.ts';
import { RankCard, CARD_WIDTH, CARD_HEIGHT } from '../src/components/og/RankCard.tsx';

const OUT = process.argv[2] ?? '/projects/sandbox/.kiro/artifacts/screenshots';
mkdirSync(OUT, { recursive: true });

/** A complete, plausible assessment. Cases below vary from this. */
const base = {
  status: 'completed',
  flagged: false,
  cefrLevel: 'B1-B2',
  assignedLevel: 2,
  totalScore: 78,
  readingScore: 21,
  listeningScore: 19,
  speakingScore: 20,
  writingScore: 18,
  voEstimatedSize: 3400,
  spWordsPerMinute: 112,
  completedAt: new Date('2026-08-31T12:00:00Z'),
  displayName: 'Mahmoud Ashri',
};

const cases = [
  // Every rank, because each has a different word length and the largest type on
  // the card is the rank name.
  ['rank-0-recruit', { ...base, cefrLevel: 'A1', assignedLevel: 0, totalScore: 24, voEstimatedSize: 610, spWordsPerMinute: 58, readingScore: 7, listeningScore: 5, speakingScore: 6, writingScore: 6, displayName: 'Nour' }],
  ['rank-1-initiate', { ...base, cefrLevel: 'A2-B1', assignedLevel: 1, totalScore: 52, voEstimatedSize: 1750 }],
  ['rank-2-warrior', { ...base }],
  ['rank-3-champion', { ...base, cefrLevel: 'C1-C2', assignedLevel: 3, totalScore: 118, voEstimatedSize: 9800, spWordsPerMinute: 168, readingScore: 30, listeningScore: 29, speakingScore: 30, writingScore: 29, displayName: 'Mariam Abbas' }],

  // Edge values. Each of these has broken a layout somewhere before.
  ['edge-score-0', { ...base, cefrLevel: 'A1', assignedLevel: 0, totalScore: 0, voEstimatedSize: 0, spWordsPerMinute: 0, readingScore: 0, listeningScore: 0, speakingScore: 0, writingScore: 0 }],
  ['edge-score-120', { ...base, cefrLevel: 'C1-C2', assignedLevel: 3, totalScore: 120, voEstimatedSize: 12000, spWordsPerMinute: 175 }],
  ['edge-no-vocab', { ...base, voEstimatedSize: null, spWordsPerMinute: null }],
  ['edge-no-name', { ...base, displayName: null }],
  ['edge-one-char-name', { ...base, displayName: 'A' }],
  ['edge-very-long-name', { ...base, displayName: 'Abdurrahmanalmuhammadi Ashri-Elsayed' }],
  ['edge-no-sections', { ...base, readingScore: null, listeningScore: null, speakingScore: null, writingScore: null }],
  ['edge-no-total', { ...base, totalScore: null }],
  ['edge-no-date', { ...base, completedAt: null }],
];

/** Cases that MUST be refused. A card that renders for these is a defect. */
const refusals = [
  ['refuse-in-progress', { ...base, status: 'in_progress' }, 'not_completed'],
  ['refuse-not-started', { ...base, status: 'not_started' }, 'not_completed'],
  ['refuse-flagged', { ...base, flagged: true }, 'flagged'],
  ['refuse-no-band', { ...base, cefrLevel: null }, 'no_band'],
  ['refuse-bogus-band', { ...base, cefrLevel: 'B2-C1' }, 'no_band'],
];

let rendered = 0;
let failed = 0;

console.log(`\nRendering rank cards → ${OUT}\n`);

for (const [name, source] of cases) {
  const result = buildRankCard(source);
  if (!result.ok) {
    console.error(`  ✗ ${name}: unexpectedly refused (${result.reason})`);
    failed++;
    continue;
  }
  try {
    const response = new ImageResponse(
      RankCard({ model: result.model, siteLabel: 'assessment.empireenglish.online' }),
      { width: CARD_WIDTH, height: CARD_HEIGHT }
    );
    const buf = Buffer.from(await response.arrayBuffer());
    const file = join(OUT, `rankcard-${name}.png`);
    writeFileSync(file, buf);
    console.log(`  ✓ ${name.padEnd(22)} ${(buf.length / 1024).toFixed(0).padStart(4)} KB  ${result.model.rank}`);
    rendered++;
  } catch (err) {
    console.error(`  ✗ ${name}: render threw — ${err.message}`);
    failed++;
  }
}

console.log('');
for (const [name, source, expected] of refusals) {
  const result = buildRankCard(source);
  if (result.ok) {
    console.error(`  ✗ ${name}: SHOULD have been refused but produced a card`);
    failed++;
  } else if (result.reason !== expected) {
    console.error(`  ✗ ${name}: refused for "${result.reason}", expected "${expected}"`);
    failed++;
  } else {
    console.log(`  ✓ ${name.padEnd(22)} refused: ${result.reason}`);
  }
}

console.log(`\n${rendered} card(s) rendered, ${failed} failure(s).`);
if (failed) {
  process.exit(1);
}
console.log(
  `\nNOW LOOK AT THE PNGs. A pass here means they rendered, not that they are right:\n` +
    `  · is any text clipped or overflowing at 1200×630?\n` +
    `  · does the long-name case still fit?\n` +
    `  · is the score dial legible as a small thumbnail?\n` +
    `  · does the honesty line ("not a TOEFL score") actually appear?\n`
);
