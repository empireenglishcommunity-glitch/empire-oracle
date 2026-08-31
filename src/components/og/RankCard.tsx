// EMPIRE ENGLISH COMMUNITY — Rank card artwork (satori / next-og)
// ═══════════════════════════════════════════════════════════
//
// Pure presentation. Takes a RankCardModel, returns JSX that satori can rasterise.
//
// SATORI IS NOT A BROWSER. Constraints that are easy to forget:
//   · flexbox only — no grid, no float
//   · every element needs an explicit `display`
//   · no CSS variables, no external stylesheet, no Tailwind classes
//   · no shorthand `background` for gradients on text; no background-clip: text
//   · fonts must be supplied as TTF/OTF/WOFF — WOFF2 is NOT supported
//
// WHY THIS CARD IS LATIN-ONLY
// ────────────────────────────
// Arabic is deliberately absent. Satori's complex-script shaping is unreliable, and
// supporting Arabic here would mean committing a TTF/OTF Arabic face to the repo
// (satori cannot read the WOFF2 files `next/font` produces) purely to render one
// line — with a real risk of wrong contextual forms in a PUBLIC image on other
// people's timelines. The card's information carries entirely in Latin and digits:
// the ranks are English words, the scores are numerals.
//
// If an Arabic line is wanted later, the correct route is the existing html2img
// Puppeteer service (real Chromium, correct shaping), not a bundled font here.
//
// Spec: design §4.1, §4.4. Verified by scripts/render-rank-cards.mjs.

import type { RankCardModel } from '@/lib/rank-card';

// Palette — the ecosystem's public brand. Literal hex values, because satori
// resolves no CSS variables.
const OBSIDIAN = '#0a0a0a';
const MIDNIGHT = '#1a1a2e';
const GOLD = '#c9a84c';
const GOLD_BRIGHT = '#e8d48b';
const BRONZE = '#cd7f32';
const PARCHMENT = '#e8e0d0';
// Secondary text: the lightened value. The source app's #8b7355 measures 4.43:1 on
// obsidian, below the WCAG AA floor — and a card is often viewed as a small
// thumbnail, where it is worse.
const MUTED = '#a08a68';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

export function RankCard({ model, siteLabel }: { model: RankCardModel; siteLabel: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: OBSIDIAN,
        // A flat radial suggestion of the site's vignette. Satori supports
        // radial-gradient in backgroundImage.
        backgroundImage: `radial-gradient(900px 400px at 50% -8%, rgba(201,168,76,0.16), rgba(10,10,10,0))`,
        padding: '56px 64px',
        fontFamily: 'sans-serif',
        color: PARCHMENT,
      }}
    >
      {/* ── Header: wordmark + date ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Emblem />
          <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 18 }}>
            <div style={{ display: 'flex', fontSize: 22, letterSpacing: 4, color: GOLD }}>
              EMPIRE ENGLISH
            </div>
            <div style={{ display: 'flex', fontSize: 14, letterSpacing: 6, color: MUTED }}>
              COMMUNITY
            </div>
          </div>
        </div>
        {model.dateLabel ? (
          <div style={{ display: 'flex', fontSize: 18, color: MUTED, letterSpacing: 2 }}>
            {model.dateLabel.toUpperCase()}
          </div>
        ) : null}
      </div>

      {/* ── Hairline ── */}
      <div
        style={{
          display: 'flex',
          height: 1,
          width: '100%',
          marginTop: 28,
          backgroundColor: 'rgba(201,168,76,0.28)',
        }}
      />

      {/* ── Body: rank + the numbers ── */}
      <div
        style={{
          display: 'flex',
          flex: 1,
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 8,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {model.firstName ? (
            <div style={{ display: 'flex', fontSize: 26, color: MUTED, marginBottom: 6 }}>
              {model.firstName}
            </div>
          ) : null}

          <div
            style={{
              display: 'flex',
              fontSize: 92,
              lineHeight: 1.05,
              color: GOLD_BRIGHT,
              letterSpacing: 2,
            }}
          >
            {model.rank.toUpperCase()}
          </div>

          {/* The placement pill appears only when it says something the band does
              not. For a single-level band like "A1" the two are identical, and
              "CEFR A1 · STARTS AT A1" just spends the card's most valuable space
              repeating itself. */}
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 18 }}>
            {model.band ? <Pill label="CEFR" value={model.band} /> : null}
            {model.placement && model.placement !== model.band ? (
              <Pill label="STARTS AT" value={model.placement} />
            ) : null}
          </div>
        </div>

        {/* Score dial — the headline number, free to see and easy to share. */}
        {model.totalScore !== null ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              width: 216,
              height: 216,
              borderRadius: 108,
              border: `2px solid ${GOLD}`,
              backgroundColor: MIDNIGHT,
            }}
          >
            <div style={{ display: 'flex', fontSize: 76, color: GOLD_BRIGHT, lineHeight: 1 }}>
              {model.totalScore}
            </div>
            <div style={{ display: 'flex', fontSize: 16, color: MUTED, letterSpacing: 3, marginTop: 8 }}>
              OF 120
            </div>
          </div>
        ) : null}
      </div>

      {/* ── Footer: the two numbers nobody else reports, sections, and the URL ── */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {model.vocabulary !== null ? (
            <Stat label="VOCABULARY" value={`~${model.vocabulary.toLocaleString('en-US')}`} unit="words" />
          ) : null}
          {model.wordsPerMinute !== null ? (
            <Stat label="SPEAKING PACE" value={String(model.wordsPerMinute)} unit="wpm" />
          ) : null}
          {model.sections.map((s) => (
            <Stat key={s.label} label={s.label.toUpperCase()} value={String(s.score)} unit="/30" />
          ))}
        </div>

        <div
          style={{
            display: 'flex',
            height: 1,
            width: '100%',
            marginTop: 24,
            backgroundColor: 'rgba(201,168,76,0.18)',
          }}
        />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 18,
          }}
        >
          <div style={{ display: 'flex', fontSize: 20, color: GOLD, letterSpacing: 2 }}>
            {siteLabel}
          </div>
          {/* Honesty, on the artefact itself and not only on the page around it.
              The 0–120 scale invites a TOEFL assumption, so it is denied here —
              where the image travels without its page. */}
          <div style={{ display: 'flex', fontSize: 15, color: MUTED }}>
            CEFR-aligned, not certified · TOEFL-style scale, not a TOEFL score
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Pieces ────────────────────────────────────────────────

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        marginRight: 14,
        paddingTop: 8,
        paddingBottom: 8,
        paddingLeft: 16,
        paddingRight: 16,
        borderRadius: 999,
        border: `1px solid rgba(201,168,76,0.45)`,
        backgroundColor: 'rgba(201,168,76,0.10)',
      }}
    >
      <span style={{ fontSize: 13, color: MUTED, letterSpacing: 2, marginRight: 10 }}>{label}</span>
      <span style={{ fontSize: 24, color: GOLD_BRIGHT }}>{value}</span>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', marginRight: 44 }}>
      <div style={{ display: 'flex', fontSize: 13, color: MUTED, letterSpacing: 2 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', marginTop: 4 }}>
        <span style={{ fontSize: 34, color: PARCHMENT, lineHeight: 1 }}>{value}</span>
        <span style={{ fontSize: 15, color: MUTED, marginLeft: 6 }}>{unit}</span>
      </div>
    </div>
  );
}

/**
 * The crest, reduced for satori: concentric rings, a crown, and the E monogram.
 * The laurel from the site's SVG is dropped — at 72px in a card that is often seen
 * as a thumbnail it collapses into noise, and satori has no stroke-linejoin.
 */
function Emblem() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 72,
        height: 72,
        borderRadius: 36,
        border: `2px solid ${GOLD}`,
        backgroundColor: 'rgba(201,168,76,0.08)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 56,
          height: 56,
          borderRadius: 28,
          border: `1px solid ${BRONZE}`,
        }}
      >
        <span style={{ fontSize: 30, color: GOLD_BRIGHT, lineHeight: 1 }}>E</span>
      </div>
    </div>
  );
}
