# Paid Placement Report & Shareable Rank Cards — Design

> **Status (2026-08-31): DESIGN — nothing built.** Companion to `requirements.md`
> (read that first). Phases are in §7.

---

## 1. Where the value already sits

Nothing here needs a new assessment. Every number the report sells is already
computed and stored on `Assessment` (`prisma/schema.prisma:60-120`). The work is
**presentation, reconciliation and delivery** — which is why it costs no teaching
hours and why the margin is what it is.

| Stored today | Currently shown | Report | Card |
|---|---|---|---|
| `spPronunciation`, `spFluency`, `spWordsPerMinute`, `spPhonemeAcc`, `spGrammarAcc`, `spVocabRange`, `spConfidence`, `spRhythmMatch` | no | **all eight** | top 1–2 |
| `liLiteral`, `liInference`, `liDetail` | no | yes | no |
| `voBand1…voBand5` | no | yes | no |
| `voEstimatedSize` | no | **prominent** | **yes** |
| `grPercentage` | no | yes | no |
| `readingScore`, `listeningScore`, `speakingScore`, `writingScore` (0–30) | partial | yes | yes |
| `totalScore` (0–120) | partial | yes | **yes** |
| `cefrLevel` (band) | yes | yes + placement level | **yes** |
| rank (from `assignedLevel`) | yes | beside the band | **yes** |

`spWordsPerMinute` and `spRhythmMatch` deserve emphasis: speaking pace and rhythm
are things learners feel but cannot measure, and no competitor in this market
reports them. They are the most credible evidence that a real engine ran.

## 2. The band → level mapping (one place, in code)

Resolves Mismatch 1 (`requirements.md` §2.3). The test measures a **band**; the
programme places at the **conservative floor** of that band, deliberately, so a
student is never dropped into a level they cannot survive.

```ts
// src/lib/cefr-mapping.ts — the ONLY band→level mapping in this repo.
//
// The floor is chosen on purpose: starting a student one level low costs them a
// few easy weeks, starting them one level high costs them the whole programme.
// The report must SAY this, or "B1-B2" followed by placement in "B1" reads as a
// downgrade rather than a decision.
export const BAND_TO_PLACEMENT: Record<string, CefrCode> = {
  "A1":    "A1",
  "A2-B1": "A2",
  "B1-B2": "B1",
  "C1-C2": "C1",
};
```

The six-level target vocabulary (`A1`…`C2`, with Arabic names) mirrors
`empire-nexus/.../config.py` `CEFR_LEVELS`, exactly as
`empire-agora/src/curriculum/cefr.ts` already does. **Do not invent a second
copy — import the shape, re-verify against the bot.**

## 3. Report

### 3.1 Route and shape

- `/[locale]/report/[assessmentId]` — server-rendered, gated: the owner of the
  assessment, or a valid paid entitlement.
- Sections, in order:
  1. **Headline** — rank + CEFR band + total /120 + placement level.
  2. **"Your vocabulary is about N words"** — `voEstimatedSize`, given its own band.
  3. **Four sections** — reading / listening / speaking / writing, 0–30 each.
  4. **Speaking, in detail** — the eight sub-metrics, each with a plain-Arabic
     label and a one-line reading of what it means.
  5. **Listening, in detail** — literal vs inference vs detail, which is a genuinely
     diagnostic split (understanding words ≠ understanding meaning).
  6. **Vocabulary by band** — where knowledge stops being reliable.
  7. **Your two weakest areas, and what to do this week** — the action plan (R2.2).
  8. **Where you would start at EEC** — placement level + the one-line floor
     explanation + a link onward.
  9. **What this is and is not** — CEFR-aligned not certified; TOEFL-*style* scale,
     not a TOEFL score, no affiliation; which scores were AI-evaluated (R3.1–R3.4).

Section 9 is not boilerplate to be minimised. It is the section that keeps the
product honest, and it should read as confidence rather than disclaimer.

### 3.2 Delivery

HTML first, since it is responsive, linkable and free. A PDF export is a later
phase, not a launch requirement — and if added, it must reuse this page's markup
rather than forking the layout.

## 4. Rank cards

### 4.1 Rendering: a real decision, not a default

There is no image generation in this repo today. Two viable paths:

| | Next.js `ImageResponse` (Satori) | The existing html2img Puppeteer service |
|---|---|---|
| Infra | none — built into Next | a cross-service dependency; adds load to a 4 GB box already running ~10 containers, and `empire-herald` depends on it |
| Latin text | excellent | excellent |
| **Arabic shaping** | **unreliable** — Satori's complex-script support is partial; contextual forms and RTL runs are exactly where it struggles | **correct** — real Chromium |
| Failure mode | silently wrong glyphs in a *public shareable image* | service down ⇒ no card |

**Decision: start with `ImageResponse`, and make the card Latin-dominant.** The
ranks are already English words, and the numbers are Western digits, so the card's
information carries with at most one short Arabic line. Then **render it and look
at it** (§4.3). If Arabic shaping is wrong, either drop to a zero-Arabic card or
fall back to Puppeteer — decided by the render, not by argument.

This reverses an earlier suggestion to use the html2img service by default: for a
Latin-dominant card, taking on a cross-service dependency and VPS memory buys
nothing.

### 4.2 Route and integrity

```
GET /api/card/[assessmentId]        → PNG, 1200×630
GET /[locale]/rank/[shareSlug]      → landing page whose OG image is the PNG
```

- **Every value is read from the database inside the handler.** No score, rank or
  name is ever accepted as a query parameter (R5.2). A card mintable from a query
  string makes every real card worthless.
- `shareSlug` is a random, non-sequential token stored on the assessment — created
  only when the user opts in to share (R5.7), and revocable. The raw `assessmentId`
  is never the public identifier.
- Cards are only generated for `status: "completed"` and never for `flagged` (R3.5).
- `Cache-Control: public, immutable` on the PNG — the values cannot change once the
  assessment is complete.

### 4.3 Verification, because this is the part that silently breaks

A rank card is a **public image on other people's timelines**. A rendering bug is
not a private defect. Before shipping:

1. Render cards for all four ranks and for edge values (`totalScore` 0 and 120,
   missing `voEstimatedSize`, a very long display name, a one-character name).
2. **Look at every PNG.** Do not infer correctness from a 200 response — this
   project's history includes a PDF shipped visibly broken twice because the
   generator was re-run and the output was never viewed.
3. Verify the Arabic line glyph by glyph, or remove it.
4. Verify unfurling **in WhatsApp specifically** (R5.5), not just by checking that
   the meta tags exist.

### 4.4 Card content

Rank name + emblem · CEFR band · placement level · total /120 · estimated
vocabulary · one standout sub-metric · first name · date · short URL. Palette is
this app's own obsidian and antique gold, now the ecosystem's public brand
(`EEC-MATERIAL/materials/_style/empire-style-guide.md` §3, amended 2026-08-31).

## 5. Security and privacy

- Report and card routes fail **closed** on authorisation.
- `shareSlug` is opt-in, revocable, and unguessable; revoking it 404s the card.
- No PII on the card beyond a first name (R5.3).
- Recordings are never exposed by either feature.
- Both routes are rate-limited; the PNG route is a rendering endpoint and is
  therefore a cheap denial-of-service target if left open.

## 6. Risks

| Risk | Mitigation |
|---|---|
| A buyer believes they bought a TOEFL score | R3.2 — stated plainly on report, card and checkout. The 0–120 scale is the hazard; treat it as one |
| Forged cards destroy credibility | R5.2 — server-derived values only, no parameters |
| Broken Arabic on a public image | §4.3 — render and inspect; drop Arabic rather than ship it wrong |
| Band vs level reads as a downgrade | R4.1 — show both, explain the floor as a deliberate choice |
| The free tier withholds too much and nothing gets shared | R1.5 / open question 2 — show the headline free |
| AI-derived scores sold as fact | R3.4 disclosure + R3.5 never sell a flagged result |
| A prospect is sent to two different tests | `requirements.md` §2.1 — three surfaces exist; copy must pick one per audience |

## 7. Phases

Each phase is independently shippable. Cards come first: they are free, they need
no payment rail, and they start compounding while the report is built.

### Phase 1 — Reconciliation (no user-visible change)
- [ ] 1.1 `src/lib/cefr-mapping.ts` — the single band→level mapping. `Req: R4.2`
- [ ] 1.2 Mirror the bot's six-level CEFR data, matching `empire-agora`'s module.
      Re-verify against `config.py`, do not hand-copy. `Req: R4.1`
- [ ] 1.3 A unit test asserting every `cefrLevel` band the schema comment lists maps
      to exactly one level. `Req: R4.2`

### Phase 2 — Rank cards (free, the viral loop)
- [ ] 2.1 `shareSlug` on `Assessment` — nullable, random, unique, opt-in. `Req: R5.4, R5.7`
- [ ] 2.2 `GET /api/card/[assessmentId]` via `ImageResponse`, **all values read
      server-side**. `Req: R5.1, R5.2`
- [ ] 2.3 Refuse non-completed and `flagged` assessments. `Req: R3.5`
- [ ] 2.4 `/[locale]/rank/[shareSlug]` landing page with OG + Twitter meta. `Req: R5.5`
- [ ] 2.5 Opt-in share control, with revoke. `Req: R5.7`
- [ ] 2.6 Rate limiting on both routes. `Req: §5`
- [ ] 2.7 **Render every rank and every edge case and look at the PNGs.** Verify the
      Arabic glyph by glyph or remove it. Verify unfurl in WhatsApp. `Req: R5.8`

### Phase 3 — The report (paid)
- [ ] 3.1 `/[locale]/report/[assessmentId]`, sections 1–9 of §3.1. `Req: R2.1`
- [ ] 3.2 The action plan: pick the two weakest sub-metrics, map each to a concrete
      next step. `Req: R2.2`
- [ ] 3.3 Section 9 — CEFR-aligned not certified; TOEFL-style not TOEFL, no
      affiliation; AI-evaluation disclosure. `Req: R3.1–R3.4`
- [ ] 3.4 Entitlement gating, failing closed. `Req: R6.1, §5`
- [ ] 3.5 Report copy in Arabic, obeying the bidi rules — every Latin token and
      every number isolated. `Req: R3.3`

### Phase 4 — Commerce
- [ ] 4.1 Reuse `empire-agora`'s checkout and reference-code scheme. Do **not** build
      a second one. `Req: R6.1`
- [ ] 4.2 Credit the report fee toward membership on join. `Req: R1.4`
- [ ] 4.3 Free tier vs paid boundary per open question 2. `Req: R1.5`

### Phase 5 — Later
- [ ] 5.1 PDF export reusing the report markup.
- [ ] 5.2 Institutional / bulk testing — the natural sequel, since it also consumes
      no teaching hours.
- [ ] 5.3 Retake policy enforcement (open question 3).

## 8. Housekeeping found while writing this

`.kiro/steering/project-rules.md` in this repo still uses the **pre-rename**
names throughout: `zai-placement-test`, `Kiro-Master-Index`, `EEC-REPO`, `Claude`.
Every repo was renamed on 2026-07-12. Updated in the same pull request as this
spec — a steering file that points at a retired repo name sends the next session
to the wrong place, and the session protocol explicitly asks that retired names be
grepped for.
