# empire-oracle — AI Agent Steering Rules

> This file is automatically loaded by Kiro and any AI agent working on
> this repository.
>
> *Renamed 2026-08-31: this file previously used the pre-rename names
> throughout (`zai-placement-test`, `Kiro-Master-Index`, `EEC-REPO`,
> `Claude`). Every repo in the org was renamed on 2026-07-12; GitHub still
> redirects the old names, but a steering file pointing at a retired name
> sends the next session to the wrong place.*

## Session Protocol

Full session commands (`/start`, `/status`, `/sync`, `/sync dry`,
`/checkpoint`) and standing ecosystem-wide rules live in
`empireenglishcommunity-glitch/empire-chronicle/.kiro/steering/AI-AGENT-PROTOCOL.md`.
Read that file at the start of every session, before anything below. Then
`empire-chronicle/STATUS.md` in full, then `SYSTEM-MAP.md`.

## Project Identity

- **Project:** a six-module (Reading / Listening / Speaking / Vocabulary /
  Grammar / Writing) English placement assessment. TOEFL-**style** 0–120
  scoring with a CEFR band mapping. IRT adaptive engine.
- **Parent project:** Empire English Community — a sibling system to the
  Discord learning bot and the practice platform, deliberately standalone
  rather than part of the `empire-nexus` monorepo.
- **Repository:** `empireenglishcommunity-glitch/empire-oracle`
- **Live at:** https://assessment.empireenglish.online

## There are THREE placement surfaces in this ecosystem. Keep them straight.

| Surface | Repo | Note |
|---|---|---|
| `assessment.empireenglish.online` | **this repo** | The cinematic public app. Six modules, IRT, AI-scored, Prisma-persisted, invite codes. |
| `test.empireenglish.online` | `empire-annex/empire-assessment/` | A genuinely separate second assessment product. Different codebase, different domain, **both real.** |
| `/placement/` on `practice.empireenglish.online` | `empire-dojo` | The bot-integrated `!placement` test, student-gated, reporting on the bot's six discrete CEFR levels. |

A prospect must never be sent to two of these. When writing copy or docs,
name which one you mean.

## Repo-Specific Notes

- Next.js, Prisma, Supabase/PostgreSQL, **Groq** for AI evaluation,
  **Kokoro TTS** for listening audio.
- `FIXES_REGISTRY.md` and `worklog.md` track fix history — read before
  assuming a known bug is still open.
- The IRT adaptive engine and 27+ reading passages are live on `main`. Do not
  merge any branch that predates them without diffing carefully; a stale
  PR #12 attempting exactly that was closed on 2026-07-12.
- Legacy SHA-256 password hashes were force-migrated to bcrypt (PR #21). If
  working on auth, confirm the migration actually ran **against production**,
  not just that the code merged.
- See `empire-chronicle/README.md`'s "Active Decision: Voice Strategy" before
  making voice-related changes.

## Rank vocabulary — this app is the odd one out

This app's four bands (**Recruit / Initiate / Warrior / Champion**) are
*placement-test outcomes*, not the learning ladder. Two other systems exist:
the bot's six CEFR levels A1–C2 (canonical for teaching, `config.py`
`CEFR_LEVELS`), and five "empire ranks" in
`EEC-MATERIAL/materials/_style/empire-style-guide.md` §2 that stop at C1 and
appear in no code.

**Always show a CEFR band or level beside a rank.** A rank on its own is not
portable information, and the owner confirmed on 2026-08-31 that CEFR is the
canonical system.

## Honesty rules (inherited, non-negotiable)

- **The 0–120 scale is TOEFL-*style*. It is not a TOEFL score**, and nothing
  may imply affiliation with ETS or any examining body. This matters most on
  anything a user can share or a buyer can pay for.
- Levels are always described as **"CEFR-aligned, not certified."**
- Never "native", never "fluent in X days", no hype. See the style guide §1.
- Where a score comes from AI evaluation, say so. Never present a `flagged`
  result as a finished one.

## Git

Never push to `main`. Branch (`component/description`), commit
(`type(scope): description`), then a PR. `gh pr create` fails in the sandbox —
use `gh api repos/{owner}/{repo}/pulls`.
