# assessment.empireenglish.online — Audit & Plan to Full CEFR Operation

**Date:** 2026-08-31 · **Repo:** `empire-oracle` @ `0cbe52c` (main) · **Live:** https://assessment.empireenglish.online (HTTP 200)
**Owner directive:** make the assessment fully operational, and **CEFR-aligned no matter what**.

> Every claim below was derived by reading the code and re-deriving the numbers.
> Where a repo document disagreed with the code, the code wins and the discrepancy
> is called out. Nothing here is quoted from `ASSESSMENT-TOEFL-ROADMAP.md`, which
> is 2 months stale and overstates completion.

---

## 1. Verdict in three sentences

The site is **up and every page loads**, so "incomplete" understates it: it is
*live and quietly producing wrong scores*. Writing returns **exactly 18/30 to
every student regardless of what they write**, speaking inflates to a perfect
30/30 for anyone scoring ≥30/100, and no total score or CEFR level is ever
persisted. And on the owner's hard requirement: **the app is not CEFR-aligned at
all** — its real model is the retired 4-level Imperial ladder (L0–L3), with CEFR
present only as a cosmetic label carrying **compound ranges** (`A2-B1`,
`B1-B2`, `C1-C2`), so **A2, B2, C1 and C2 can never be reported as a level**.

The decisive context: **the ecosystem already has a genuinely CEFR-aligned,
owner-signed-off assessment engine** in `empire-nexus` (Mi'yar Phase 8). This
plan re-points oracle at that engine's rules and content rather than inventing a
second CEFR standard.

---

## 2. Correctness defects (live now, ranked by student harm)

| # | Defect | Evidence | Effect on a student |
|---|---|---|---|
| **D1** | **Writing is a constant 18/30** | `src/app/assessment/writing/page.tsx:233` sends `transcription:`; `src/app/api/ai/evaluate-speaking/route.ts:15` destructures `transcript` | A blank essay and a brilliant essay both score 18/30 |
| **D2** | Speaking clamps to a perfect score | `speaking/page.tsx:196-223` returns 0–100 → written to the 0–30 column (`submit/route.ts:134`) → `results/page.tsx:94` `Math.min(30,…)` | Anyone above 30/100 is reported 30/30 — a perfect band |
| **D3** | No total or CEFR level is stored | `totalScore`/`cefrLevel` exist (`prisma/schema.prisma:106-107`) but grep finds **only reads** | Results are recomputed on every render; admin/email/certificate read columns that are always `NULL` |
| **D4** | Anonymous students lose everything | Only the hub gates auth (`assessment/page.tsx:278`); **no `middleware.ts`**; verified live: `/assessment/reading`, `/writing`, `/vocabulary`, `/grammar` all return **200 logged out** | Full test taken, score shown on screen, silently discarded (`reading:89`, `listening:52`, `writing:169`) |
| **D5** | Submissions can be misattributed | `submit/route.ts:69-75` — *"Method 4: If single user (testing), use them"* | A guest's answers can be written onto a real student's record |
| **D6** | Adaptive reading dies mid-test | Sessions in a module-level `Map` (`adaptive-reading/route.ts:26-40`); the code admits it at `:23-24` | Redeploy or 1h idle → `404 Session expired` partway through |
| **D7** | Answer key is shipped to the browser | `adaptive-reading/route.ts:122,228` return `correctAnswer` | Visible in devtools |
| **D8** | Anti-cheat runs on fabricated data | `listening:68` `timeTaken: 5000` hardcoded; `grammar:210,271` `timeTaken: 0` | Response-time integrity flags are meaningless |
| **D9** | Listening is browser TTS, always | `public/audio/listening/` contains only `.gitkeep`; `ListeningAudioPlayer.tsx:81-86` falls back to `speechSynthesis` | Robotic, varies per browser/OS; no duration → inert timer |

**D1 in detail, because it is the worst and it is a *triple* stacked bug** — each
layer would independently break it, and the third hides the first two:

1. **Wrong key.** The page sends `transcription`; the route reads `transcript`,
   so `!transcript` is true and it early-returns **HTTP 200** with
   `{evaluation:{overallScore:0,…}, source:'none'}`.
2. **Wrong shape.** Even with the key fixed, the route returns criteria **nested**
   under `evaluation` (`route.ts:106`, `:114`), while the page reads them **flat**
   (`data.grammar`, `data.overall`).
3. **Defaults mask both.** `writing/page.tsx:241-246` coalesces every missing
   field to `?? 15`. Because the response is `200`, `if (!res.ok) throw` never
   fires, so `fallbackScore()` is unreachable.

Arithmetic: `(15 + 15) / 2 = 15` → `round(15 / 25 * 30)` = **18/30**, always.
Note also three different scales collide in this one path — the route's
deterministic branch rescales 0–30 → 0–100 with a `* 3.3` magic number
(`route.ts:116-122`), while the page divides by **25**.

---

## 3. Structural gaps

- **Two rival scoring systems, neither authoritative.** A legacy 0–100 → L0–L3
  engine (`src/lib/constants.ts:26-54`, `calculateLevelAssignment`) and a TOEFL
  0–120 engine (`calculateTOEFLScore`). **Neither is ever called** —
  `calculateTOEFLScore`, `percentageToSectionScore`, `calculateAttemptAwareLevel`
  and `POST /api/assessment/calculate-level` have **no callers**. Each page
  computes its own score inline with duplicated ad-hoc formulas.
- **Two of six sections are orphaned.** `vocabulary` and `grammar` hold the
  richest server-side logic (locked question sets, exposure tracking, retake
  cooldown via `/api/assessment/session`) but are **linked from nowhere** —
  `trialCards` (`assessment/page.tsx:44-114`) lists only 4. Worse, `submit`
  marks an assessment `completed` only when **all six** modules have data
  (`submit/route.ts:155-165`), so **no assessment can ever reach `completed`**
  and `latestCompleted` stays null on the dashboard.
- **Dead code shipped to production:** `POST /api/assessment/start`,
  `/api/assessment/calculate-level`, `/api/ai/generate-listening`,
  `GET /api/questions`, `POST /api/email` (no caller anywhere), plus the
  `Recording`, `Question` and `ReviewFlag` models, which are **never written**.
  No audio is persisted; the item bank table is unused (all content is TS files
  in `src/data/`); `Assessment.flagged` never produces a review record.
- **Errors are swallowed as success.** `submit/route.ts:187-200` and
  `session/route.ts:147-149,212-214` catch all DB failures and still return
  `success: true`. A total persistence outage is invisible.

---

## 4. The CEFR problem

### 4.1 What the code actually does

The only CEFR producer is `src/lib/types.ts:259-264`:

```ts
TOEFL_LEVEL_THRESHOLDS = [
  { min:  0, max:  31, level: 0, cefr: 'A1'    },
  { min: 32, max:  59, level: 1, cefr: 'A2-B1' },
  { min: 60, max:  93, level: 2, cefr: 'B1-B2' },
  { min: 94, max: 120, level: 3, cefr: 'C1-C2' },
];
```

- **4 buckets, not 6 levels.** Only `A1` is a single level. **A2, B2, C1 and C2
  are unreportable.** Adjacent buckets *overlap* (`A2-B1` / `B1-B2`), so "B1"
  means two different things.
- **No `CEFRLevel` type exists.** CEFR is a bare `string` (`types.ts:254`). The
  domain type is `ImperialLevel = 0|1|2|3` (`types.ts:11`) —
  Recruit/Initiate/Warrior/Champion — the ladder the Discord server **retired**
  in favour of six CEFR zones.
- **No per-skill CEFR.** `SECTION_LEVEL_THRESHOLDS` (`types.ts:268-273`) has no
  `cefr` field; each skill renders an Imperial rank ("Warrior"), never "B1".
- **No CEFR tag on any item, in any bank.** Difficulty is `easy|medium|hard`
  (reading/listening), a frequency band (vocab), a topic (grammar), or absent
  entirely (speaking/writing).
- **Boundaries are duplicated** in `admin/students/route.ts:50-55`, so the admin
  table drifts from the student result.
- **Any NaN/out-of-range total silently reports `A1`** (`types.ts:286`), and
  `api/email/route.ts:241-242` defaults `cefrLevel = 'A1'`.

### 4.2 Item banks — real counts vs. documented claims

Counted from the source, not from the file headers:

| Bank | Real | Documented | Organised by | CEFR tag |
|---|---|---|---|---|
| Vocabulary | **172** | header says 250, footer says ~228 — **both wrong** | frequency band | ✗ |
| Grammar | **98** | 98 ✓ | topic | ✗ |
| Reading | **33 passages / 165 q** | "27 passages" | easy/medium/hard | ✗ |
| Listening | **6 passages / 30 q** | 6 | easy/medium/hard | ✗ |
| Speaking | **31 prompts** | 31 | task type only | ✗ |
| Writing | **24 prompts** | 24 | task type only | ✗ |

Two are critically thin for six-level discrimination: **listening has 6 passages
→ only 6 unique test combinations in the entire product** (its own comment admits
this), and reading has just 9 medium and 9 hard.

⚠️ **Naming trap for whoever implements this:** the exports `EASY_PASSAGES_B2`,
`MEDIUM_PASSAGES_B3`, `HARD_PASSAGES_B4` mean **batch 2/3/4 — not CEFR B2/B3**.
Do not mistake them for level tags.

### 4.3 The IRT engine implies precision the data cannot support

`src/services/irt-engine.ts` is a real 3PL implementation (EAP over 41 quadrature
points), and it is the only statistically-grounded scoring in the app. But item
parameters are **hand-typed from the 3-value difficulty label**
(`getReadingItemDifficulty:257-277`): `b ∈ {-1.5, 0, 1.5}` plus a fixed 5-value
offset array. That is **15 possible difficulties across 165 questions**, so
hundreds of items share identical parameters and `selectNextItem` breaks ties
arbitrarily. The code says so itself at `:256`: *"they would be calibrated from
real data over time."* They never were.

### 4.4 Truth in labelling — a live overclaim

Students currently receive an email with the subject **"Your TOEFL Score Report
— {n}/120 ({cefr})"** (`api/email/route.ts:306`), and the hub shows a "TOEFL
Score Scale" panel (`assessment/page.tsx:413-430`). Empire English has no ETS
relationship. The certificate (`EmpireCertificate.tsx:330-372`) prints a CEFR
level with only the word "equivalent" as a hedge.

The rest of the ecosystem already settled the permitted wording, and oracle must
adopt it verbatim (`empire-nexus/content/cefr/PHASE8-ASSESSMENT-ALIGNMENT.md` §1):

> **"Built to CEFR methodology and aligned to the CEFR by design; pending
> empirical validation. Not an accredited CEFR examination."**

---

## 5. The thing that changes the plan: a CEFR engine already exists

`empire-nexus/bots/discord-learning-bot` contains **Mi'yar Phase 8** — live,
tested, and covered by the owner's 2026-08-27 content sign-off. It is genuinely
CEFR-aligned where oracle is not:

| Concern | Mi'yar (nexus) | Oracle today |
|---|---|---|
| Levels | **6 discrete** A1–C2 | 4 buckets, 3 of them compound |
| Per-skill profile | **Yes** — vocab_grammar, listening, writing, speaking | No |
| Overall rule | `conservative_overall` = `min(round(mean(idx)), min(idx)+1)` | Sum of 4 sections → bucket |
| Adaptivity | Branching: ≥0.80 up, ≤0.40 down, pass 0.60 | 3PL IRT with uncalibrated parameters |
| Items | Level-tagged: **90 weeks, 2,909 vocab, 90 reading, 90 broadcast** | Untagged |
| Descriptors | `can_do.json` — **112 descriptors** A1–C2, each item tagged to a code | None |
| Rating | Descriptor-anchored AI rater + deterministic fallback, 4 axes × 25 | Broken (D1) / mis-scaled (D2) |
| Cut scores | Expert-set, in one place, documented | None |

Exit-exam cut scores (`assessment.py:2075-2085`) — Part A **65%** at every level;
Part B **60/60/65/65/70/70** for A1→C2; distinction at Part B ≥ **90**; anything
within **±7** of a cut, or AI confidence < **0.55**, routes to **human review**
rather than being auto-decided.

**And Phase 8 explicitly considered oracle and declined it** (§6): oracle's IRT
engine was rejected because its CEFR output is *"four coarse, ambiguous bands
that cannot emit a single level"* and because IRT implies calibration that n≈17
cannot support. That is the same defect this audit found independently.

### 5.1 There are **three** placement surfaces, and two are publicly reachable

This was not in the brief and it changes the scope, so it is stated plainly.
Found via this repo's own steering file, then verified live:

| Surface | Served from | Level model | Public? | Status |
|---|---|---|---|---|
| `assessment.empireenglish.online` | **`empire-oracle`** (this repo) | L0–L3 + 4 compound CEFR buckets | **Yes, 200** | dormant since 2026-07-12 |
| `test.empireenglish.online` | **`empire-annex/empire-assessment/`** | **L0–L3 only — zero CEFR** | **Yes, 200** | dormant since 2026-07-14 |
| dojo `/placement/` | `empire-nexus` Mi'yar | **6 discrete CEFR levels, per-skill** | No — student-gated | live, signed off |

`test.empireenglish.online` titles itself *"Empire English — Placement
Assessment"* and its scoring engine (`lib/scoring-engine.js:251-254`,
`lib/certificate-generator.js:7-10`) knows only Recruit/Initiate/Warrior/Champion
— a grep for `A1|A2|B1|B2|C1|C2` in its source returns **nothing**. It also
issues certificates.

So today: **the only genuinely CEFR-aligned assessment is the one the public
cannot reach, and both assessments the public *can* reach are not CEFR-aligned** —
one partially, one not at all. Neither public site appears anywhere in
`empire-chronicle/SYSTEM-MAP.md`.

**This needs an owner decision before P1 starts** (see §7.0). Fixing oracle alone
leaves a second non-CEFR test live at a comparable URL, issuing certificates.

### 5.2 So what is oracle *for*?

This is the one question the plan turns on, and it has a clean answer:

- **Existing Discord students** are already served by the dojo `/placement/`
  page, which runs Mi'yar end to end.
- **Prospective students, who have no Discord account,** have no CEFR-aligned
  route in. Mi'yar's API is bound to a `discord_id` and gated behind a Darb
  `empire_session` plus the `itqan_weekly_assessment` flag, so they cannot use it.

**Oracle's distinct job is the public CEFR front door.** It should therefore
share Mi'yar's **rules and content** while keeping its own accounts and database
— *not* proxy Mi'yar's `discord_id`-bound session. Conveniently, both run on the
same Hetzner box (oracle `:3100`, bot API `:8099`, Kokoro TTS `:8880`), so
content and audio can be shared over localhost with no new infrastructure and no
added cost.

---

## 6. The plan

Four phases. **P0 and P1 are the owner's requirement**; P2 is what makes the
CEFR claim survive scrutiny; P3 is housekeeping. Each phase ships as its own PR.

### P0 — Stop reporting wrong scores (no CEFR work; smallest possible diff)

1. **Fix D1.** Rename the key to `transcript`, read the response from
   `data.evaluation.*`, and **delete every `?? 15` default** — a missing score
   must fail loudly, not silently become average. Route the writing text through
   the route's existing `writing_summary`/`writing_essay` branch (`route.ts:44-67`),
   which is real code that no UI currently reaches.
2. **Fix D2.** Pick **one** scale per skill and assert it at the boundary.
   Convert speaking to 0–30 before submit; add a server-side range check in
   `submit` that **rejects** out-of-range values instead of clamping.
3. **Fix D3.** Compute the total and level **on the server** in `submit`, and
   persist `totalScore` + `cefrLevel`. Remove client-side recomputation in
   `results/page.tsx` and `dashboard/page.tsx`; delete the duplicated mapping in
   `admin/students/route.ts:50-55`.
4. **Fix D4/D5.** Add `middleware.ts` covering `/assessment/*` and `/results`;
   **delete the "single user" fallback** (`submit/route.ts:69-75`) and resolve
   the user only from the verified session. Decide guest policy explicitly
   (recommend: allow the test, store against a pending record, attach on
   registration — never show a score that is being thrown away).
5. **Fix D6/D7.** Move adaptive-reading sessions into the DB (a table, or
   `AssessmentSession` which already exists); **stop returning `correctAnswer`**.
6. **Stop swallowing failures.** A DB write error must return an error.
7. **Fix D8.** Send real elapsed time, or delete the integrity feature — a check
   fed fabricated data is worse than no check.

*Verification gate for P0:* submit a blank essay and a strong essay and show two
different stored scores; submit a speaking response and show the stored value is
0–30; confirm `totalScore`/`cefrLevel` are non-null in the DB; confirm a logged-out
request to `/assessment/reading` redirects.

### P1 — Make it CEFR, structurally

8. **Introduce a real type.** `type CEFRLevel = 'A1'|'A2'|'B1'|'B2'|'C1'|'C2'`.
   Retire `ImperialLevel` from the assessment path (keep the rank *names* as
   cosmetic flavour if the owner wants them, mapped 1:1 onto the six levels —
   never as the domain model).
9. **Delete `TOEFL_LEVEL_THRESHOLDS`** and the compound bands with it. No
   student is ever shown `A2-B1` again.
10. **Port Mi'yar's rules verbatim** into one TypeScript module — they are ~120
    lines of pure, deterministic logic, deliberately centralised so they cannot
    drift: `band_index`, `index_to_band`, `step_band` (0.80 up / 0.40 down),
    `resolve_skill_band` (**highest band actually passed**, ≥0.60 — never highest
    attempted), and `conservative_overall`.
    ⚠️ **Porting trap:** Python's `round()` is banker's rounding — mean index
    2.5 → **2**, whereas JS `Math.round` gives 3. Reproduce the Python behaviour
    or the two systems will place the same student differently. Pin it with a test.
11. **Emit a per-skill CEFR profile** (reading, listening, speaking, writing),
    plus the conservative overall. The four sub-scores already exist end to end,
    so this is a mapping layer, not a data-model rewrite. Persist per-skill
    levels and the measured-skills list, so a partial sitting is reported
    honestly instead of as a confident total.
12. **Adopt the cut scores** from `assessment.py:2075-2085` by reference, in a
    single constant with a comment pointing at the nexus source of truth. Adopt
    the **±7 boundary review band** and route those results to a review queue —
    the `ReviewFlag` model already exists and is currently unused.
13. **Truth in labelling.** Remove "TOEFL" from every student-facing surface
    (starting with the email subject at `api/email/route.ts:306` and the hub panel
    at `assessment/page.tsx:413-430`) and print the approved §1 claim on the
    results page, the certificate and the email.

*Verification gate for P1:* a table of synthetic profiles → expected level,
including the two worked cases from the nexus engine
(`{B1,B2,A2,B1}` → **B1**; `{C1,C1,A1,B2}` → **A2**), proving oracle and Mi'yar
agree. Plus a test asserting no compound band string can be produced.

### P2 — Make the CEFR claim defensible (the real work)

14. **Tag every item with a CEFR level.** This is unavoidable: without it, "CEFR
    aligned" is a label on the output of an untagged bank.
    **Recommended: import from the nexus CEFR curriculum rather than re-authoring.**
    It is already level-tagged, descriptor-linked and owner-approved — 2,909 vocab
    items across 90 weeks, 90 reading texts, 90 broadcasts, and `can_do.json`
    (112 descriptors). Re-authoring in oracle would create a *second* CEFR
    standard for one product, which is exactly the drift this ecosystem keeps
    getting bitten by.
15. **Fix the listening bank.** 6 passages / 6 unique combinations cannot support
    six-level discrimination. Mi'yar's `build_listening_pool` already selects
    level-appropriate single-segment broadcasts rendered at each level's verified
    delivery pace (A1 124 wpm … C2 199 wpm) — reuse that content and the audio
    that already exists on the box.
16. **Replace browser TTS with real audio.** `scripts/generate-listening-audio.ts`
    is already written and wired (`npm run generate:audio`); it needs the Kokoro
    server, which is **already running on `:8880`** on the same host. This is
    configuration, not development.
17. **Attach descriptors to results.** Report *which can-do statements the
    student evidenced*, not just a number. This is what makes the certificate a
    CEFR artefact rather than a score slip.
18. **Retire or re-anchor the IRT engine.** Either (a) park it behind a flag
    until a calibrated bank and enough attempts exist — the explicit revisit
    trigger in Phase 8 §6 — or (b) keep it for routing only and stop deriving a
    reported level from θ. **Do not present θ-derived precision to students.**

### P3 — Operational hygiene

19. **Resolve the orphaned sections.** Either link vocabulary/grammar from the
    hub or remove them — and either way **fix the completion condition**
    (`submit:155-165`) so an assessment can actually reach `completed`.
20. **Delete the dead code** listed in §3, or wire it. Unused `Recording`,
    `Question` and `ReviewFlag` models invite a future session to assume
    features exist.
21. **Correct the false counts** in the `src/data/*.ts` comments, and add a
    script that derives them, so the numbers can never drift again.
22. **Untrack `.env`.** It is committed (`git ls-files` shows it) and `.gitignore`
    already lists it. It currently holds only
    `DATABASE_URL=file:/home/z/my-project/db/custom.db` — **a dead scaffolding
    path, not a secret and not the live database**, so this is hygiene rather
    than an incident. Worth confirming what the deployed container actually uses.
23. **Add CI.** There is none. At minimum: typecheck, plus the P1 placement-rule
    tests. Note the repo has been **dormant since 2026-07-12** while the rest of
    the ecosystem shipped the entire CEFR programme — that gap is how this drift
    happened.
24. **Record both public assessments in `empire-chronicle/SYSTEM-MAP.md`.**
    Oracle has **no section** (only two passing mentions) and
    `test.empireenglish.online` / `empire-annex` appear **nowhere at all**. Two
    undocumented live public services is the exact failure mode that file exists
    to prevent.
25. **Refresh this repo's steering.** `.kiro/steering/project-rules.md` still
    calls the repo `zai-placement-test` and points at `Kiro-Master-Index` and
    `EEC-REPO` — all renamed on 2026-07-12. It also defines the project as
    "TOEFL-style, 0-120 scoring with CEFR mapping", which is precisely the model
    P1 replaces; leaving it will steer the next session straight back into the
    drift.

---

## 7. Decisions only the owner can make

0. **What happens to `test.empireenglish.online`?** (§5.1) It is live, public,
   has **no CEFR at all**, and issues certificates. Recommend **retiring it** and
   redirecting to whichever surface wins — running two public placement tests
   with different level models is the bigger reputational risk, and it makes the
   CEFR directive unenforceable. If it must stay, it needs its own P0/P1.
1. **Is oracle the public CEFR front door?** (§5.2) Everything else follows from
   this. The alternative — retiring oracle and pointing prospects at a gated
   dojo page — is cheaper but closes the public funnel.
2. **Import nexus content, or author a separate oracle bank?** Importing is
   strongly recommended (one CEFR standard). Authoring is defensible only if the
   public test must be kept disjoint from the taught curriculum so prospects
   cannot pre-study it — a real testing-security argument that would justify the
   cost.
3. **Keep the Imperial ranks (Recruit/Initiate/Warrior/Champion)?** They can
   survive as branding over six CEFR levels, but not as the domain model.
4. **Guest policy** (P0.4): block the test until registration, or store and
   attach later?
5. **Certificates already issued** carry compound bands and, for writing, a
   score that was always 18/30. Reissue, annotate, or leave? Note the precedent
   in the ecosystem is **never retroactively revoking** what a student earned.

---

## 8. Sequencing

P0 first and alone — it is small, it is pure bug-fixing, it needs **no owner
decision**, and it stops the site misreporting today. P1 next, because it is
mostly deletion plus ~120 lines of ported rules; it needs decisions #0 and #1.
P2 is the largest and needs decision #2 resolved before it starts. P3 can
interleave, except item 25 (steering), which should land **with P1** so the next
session is not steered back to the TOEFL model.

**Do not do P1 before P0:** re-pointing the level model while writing still
returns a constant and speaking still clamps would produce CEFR levels that are
wrong in a *new* way, and the CEFR change would get the blame.

One standing rule from this ecosystem applies with force here: **a green test
suite is not evidence of correctness.** Every defect in §2 would pass a
type-check and most would pass a unit test — D1 returns HTTP 200, and D2 stores a
number in the right column. They were found by tracing values end to end and
doing the arithmetic. Verify each fix against real stored data, not against a
passing build.
