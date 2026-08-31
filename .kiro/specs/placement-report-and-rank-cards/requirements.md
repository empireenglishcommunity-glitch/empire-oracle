# Paid Placement Report & Shareable Rank Cards — Requirements

> **Status (2026-08-31): SPEC — nothing built.** Two features, one spec, because
> they read the same data and live on the same page. Phases are at the end of
> `design.md`. Trust this header, not checkboxes.
>
> Owner approved the rank cards ("Approved! Go ahead and implement") and asked how
> to structure the standalone report ("Let me know how we structure that").

---

## 1. Why these two together

This repo already computes far more than it shows. A completed assessment stores
**eight speaking sub-metrics**, listening broken into literal/inference/detail,
vocabulary across five bands plus an estimated vocabulary size, a grammar
percentage, four TOEFL-style section scores, a 0–120 total, and a CEFR band
(`prisma/schema.prisma:60-120`). A test-taker currently sees a rank.

That gap is both products:

- **The rank card** takes the *headline* and makes it shareable. Free. It is the
  cheapest acquisition channel available, because the person who just earned a
  rank is the most motivated they will ever be to tell someone.
- **The paid report** takes the *detail* and makes it useful. It is near-pure
  margin precisely because the data already exists — the buyer is paying for
  analysis and presentation, not for new assessment work.

Neither requires the owner's calendar. That is the point: everything else in the
business is bounded by one person's teaching hours
(`empire-agora/.kiro/specs/eec-commercial-and-sales-page/`), and these two are not.

## 2. Ground truth (verified 2026-08-31)

### 2.1 There are three placement surfaces, not one

This caused a documented ambiguity that took direct investigation to settle. All
three are real and live:

| Surface | Repo | What it is |
|---|---|---|
| `assessment.empireenglish.online` | **this repo** (`empire-oracle`) | Public, cinematic, 6 modules, IRT adaptive, AI-scored, Prisma-persisted, invite codes, admin review. **This spec's subject.** |
| `test.empireenglish.online` | `empire-annex/empire-assessment/` | A genuinely separate second assessment product. Different codebase, different domain. |
| `/placement/` on `practice.empireenglish.online` | `empire-dojo` | The bot-integrated `!placement` test — student-gated, outputs a per-skill CEFR profile on the bot's six-level scale. |

This repo's own steering already warned about the second one. The third is what
`empire-agora`'s spec means by "the free automated placement test in front of the
paid live assessment" — **not** this app. Keep them distinct in copy: a prospect
should never be sent to two different tests.

### 2.2 What already exists here

- Modules: `reading`, `listening`, `speaking`, `vocabulary`, `grammar`, `writing`
  (`src/app/assessment/`).
- Automatic scoring: `api/ai/evaluate-speaking`, `api/assessment/calculate-level`,
  `api/assessment/submit`. Groq for AI evaluation, Kokoro TTS for listening audio.
- Integrity: `AssessmentSession`, `QuestionExposure`, `ReviewFlag`, `AdminNote`,
  and `flagged` / `flagReason` on the assessment itself.
- Auth: NextAuth with register / verify-email / password reset. `InviteCode` model.
- **No image generation of any kind exists** — no `ImageResponse`, no Satori, no OG
  image route. Rank cards are built from zero.

### 2.3 Two data mismatches that must be handled, not ignored

**Mismatch 1 — CEFR granularity.** `Assessment.cefrLevel` is a **band**:
`"A1"`, `"A2-B1"`, `"B1-B2"`, `"C1-C2"`. The learning system uses **six discrete
levels** A1–C2 (`empire-nexus/.../config.py:295-349`). So a buyer can be told
`"B1-B2"` by the test and then placed in `B1` by the bot. Unexplained, that reads
as a contradiction and invites a refund request.

**Mismatch 2 — rank vocabulary.** This app's four ranks (Recruit / Initiate /
Warrior / Champion) are **not** the learning ladder. `empire-agora` uses the bot's
six CEFR levels, and the style guide defines a *third* set of five empire ranks
that stops at C1. Three rank systems, one customer.

## 3. Requirements

### R1 — Product structure: two buyers, not one price ladder

The structural insight: the free test serves **two different people**, and
conflating them is what makes a standalone report look like it competes with the
live assessment.

- **R1.1** **Buyer A — wants to join EEC.** Free test → rank + card → books the
  paid live assessment (already priced at $10 / 300 EGP, credited on join). **The
  written report is included** with that live assessment. Costs owner time; that
  cost is already accepted as acquisition spend.
- **R1.2** **Buyer B — just wants to know their level** for a job application, a
  university form, or curiosity, and will never book a call. Free test → **paid
  report, no call, zero owner time.** This is a *new market*, not a discount on an
  existing one.
- **R1.3** The report SHALL therefore be priced **below** the live assessment, and
  SHALL NOT be presented as an alternative to it. Recommended: **$9 / 200 EGP.**
- **R1.4** The report fee SHALL be **credited toward membership** on join, matching
  the existing assessment-credit policy. A buyer who later joins loses nothing.
- **R1.5** The free tier SHALL remain genuinely useful — rank, band, total score,
  and the card. A free tier that withholds the headline does not get shared, and
  the sharing is the point.

### R2 — Report contents

- **R2.1** The report SHALL surface the detail already computed and currently
  unseen: the eight speaking sub-metrics, listening literal/inference/detail,
  vocabulary bands 1–5, **estimated vocabulary size**, grammar percentage, four
  section scores and the 0–120 total.
- **R2.2** It SHALL include a **prioritised action plan** — the two or three
  weakest sub-metrics, named in plain Arabic, each with a concrete next step.
  Numbers without a next step are trivia.
- **R2.3** It SHALL state **which EEC level the buyer would join**, resolving
  Mismatch 1 explicitly (R4.1).
- **R2.4** It SHALL be deliverable **without any human step.**
- **R2.5** `voEstimatedSize` SHALL be shown prominently. "Your vocabulary is about
  3,400 words" is the single most concrete, memorable line the system can produce.

### R3 — Honesty and legal boundaries (hard constraints)

- **R3.1** The report SHALL NOT be called a certificate, and SHALL NOT imply
  accreditation. Wording is always **"CEFR-aligned, not certified"**
  (`empire-chronicle/STATUS.md:143`).
- **R3.2** **The 0–120 scale is TOEFL-*style*, not a TOEFL score.** Any surface
  showing it SHALL say so plainly and SHALL NOT reference or imply affiliation with
  ETS or any examining body. *A paying customer who believes they bought a TOEFL
  score has been mis-sold, regardless of intent — and this is the single largest
  reputational risk in the whole product.*
- **R3.3** Copy SHALL obey the inherited style guide: no hype, never "native",
  never "fluent in X days".
- **R3.4** Where a score derives from **AI evaluation**, the report SHALL say so.
  Standing project rule: no AI on critical paths — selling an AI-derived score
  makes it a critical path, so the mitigation is disclosure plus R3.5.
- **R3.5** A `flagged` assessment SHALL NOT be sold as a report until reviewed.
  Taking money for a result the system itself distrusts is indefensible.

### R4 — Reconciling the three rank systems

- **R4.1** The report and the card SHALL show the **band** (what the test measured)
  *and* the **placement level** (where the buyer would start), with a one-line
  explanation that placement is deliberately the conservative floor of the band.
  This turns Mismatch 1 from an apparent contradiction into evidence of rigour.
- **R4.2** A single documented mapping band → CEFR level SHALL live in code, not in
  prose, and SHALL be the only such mapping.
- **R4.3** The four ranks MAY remain as this app's flavour, but SHALL always appear
  beside the CEFR band. A rank alone is not portable information.
- **R4.4** This spec SHALL NOT introduce a fourth rank vocabulary.

### R5 — Rank cards

- **R5.1** A card SHALL be generated from a **completed** assessment.
- **R5.2** **Every value SHALL be derived server-side from the stored assessment.**
  The endpoint SHALL NOT accept scores, ranks or names as parameters.
  *If a card can be minted from a query string, anyone can forge a Champion card,
  and the credibility of every real card is gone.*
- **R5.3** Cards SHALL carry no PII beyond a first name or chosen display name. No
  email, no full name unless the user opts in.
- **R5.4** Card URLs SHALL NOT be enumerable in a way that exposes other people's
  results.
- **R5.5** Cards SHALL be wired as **OpenGraph and Twitter images** so they unfurl
  in WhatsApp, Telegram and X. *WhatsApp is the dominant channel in this market; a
  card that does not unfurl there is not a viral loop, it is a download.*
- **R5.6** The card SHALL include a short route back to the free test.
- **R5.7** Sharing SHALL be **opt-in**. A result is personal.
- **R5.8** Arabic on the card SHALL be verified by **rendering and visual
  inspection**, never assumed — see `design.md` §4. This project has a documented
  history of Arabic rendering bugs that passed every automated check.

### R6 — Payment

- **R6.1** Report payment SHALL reuse whatever `empire-agora` establishes rather
  than inventing a second checkout. Until that exists, the manual rails apply
  (Vodafone Cash / InstaPay / PayPal) with human verification.
- **R6.2** No card data or raw payment credential SHALL be stored here.
- **R6.3** A paid report SHALL remain accessible to its buyer indefinitely, or the
  retention limit SHALL be stated at purchase.

### R7 — Out of scope

Institutional/bulk testing (schools, employers — a real opportunity, and the
natural sequel since it also costs no calendar); printed certificates; any change
to the IRT engine or the question bank; retheming this app; reconciling
`empire-annex/empire-assessment`.

## 4. Open questions

1. **Report price** — $9 / 200 EGP proposed. Owner to confirm.
2. **Does the free tier show the 0–120 total, or is that part of the paid report?**
   Recommendation: show it free. It is the most shareable number, and withholding
   it suppresses the loop that makes the product work.
3. **Retake policy** — how often may someone retest for free? `QuestionExposure`
   protects the bank, but an unlimited free retest lets someone grind for a better
   card. Recommendation: one free retake after 30 days.
4. **Does the paid report get a stable public URL** (shareable, e.g. for a job
   application) or is it login-only? A shareable report is far more valuable to
   Buyer B, but leaks more if the URL escapes.
