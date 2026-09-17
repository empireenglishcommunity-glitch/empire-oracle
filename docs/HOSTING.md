# Where assessment.empireenglish.online actually runs

**Verified 2026-08-31 against the live site.** Written because a stale
`netlify.toml` in the repo root made this app look like a Netlify deployment. It
never was one. That file has been deleted.

## Current architecture

```
Browser
  └─ Cloudflare (proxied DNS, zone empireenglish.online)
       └─ Cloudflare Named Tunnel          ← the single public entry point
            └─ Hetzner CX23 (Helsinki)
                 └─ Docker container `empire-assessment`
                      host 127.0.0.1:3100 → container :3000
                      Next.js standalone server + SQLite on a Docker volume
```

| | |
|---|---|
| **Hosting** | Cloudflare Tunnel → self-hosted Docker on the Hetzner box |
| **Server path** | `/opt/empire-assessment` |
| **Port** | `3100` on the host, `3000` in the container |
| **Build mode** | `output: "standalone"` (`next.config.ts`) — a self-hosted Node server |
| **Database** | **SQLite file** on the `assessment-data` Docker volume (`file:/app/db/assessment.db`) |
| **Resources** | `mem_limit: 512m`, `cpus: 0.5` |
| **Deploy** | `deploy.sh` on the server: `git pull` → `docker compose up -d --build` |
| **Netlify** | **Not used.** No Netlify dependency in `package.json`; no Netlify header on any live response |

## It is already served through Cloudflare

Evidence from the live response headers:

```
server: cloudflare
cf-ray: a33e6971fa457c7a-IAD
cf-cache-status: DYNAMIC
x-powered-by: Next.js
x-nextjs-cache: HIT
x-nextjs-prerender: 1
```

`server: cloudflare` + `cf-ray` confirm Cloudflare is in front. `x-powered-by`
and `x-nextjs-cache` confirm the origin is a real Next.js server, not static
hosting. **Zero Netlify markers** — Netlify always emits `x-nf-request-id`, and
it is absent.

## Why this is NOT hosted like empire-dojo and empire-crown

Those are on **Cloudflare Pages**, which serves *static* output. This app cannot
be, as currently written:

| Blocker | Why Pages/Workers can't run it |
|---|---|
| **SQLite file database** | Workers have no persistent filesystem. This is the hard blocker — the student records live in a file on a Docker volume. Needs Cloudflare **D1** or an external Postgres. |
| **Prisma with the sqlite provider** | `prisma-client-js` + sqlite does not run on Workers. Needs a Prisma driver adapter (D1) or an HTTP-proxied database. |
| **bcrypt** | Native module; no native addons on Workers. Password hashing must move to WebCrypto/PBKDF2 or Argon2-WASM — and that means **re-migrating every existing password hash** (this repo already did one such migration, PR #21). |
| **Nodemailer / SMTP** | Workers cannot open raw TCP. Email must go through an HTTP API (`RESEND_API_KEY` is already wired in `docker-compose.yml`). |
| **`output: "standalone"`** | Purpose-built for self-hosting. Pages needs `@cloudflare/next-on-pages` or a static export. |
| **Long AI calls** | Speaking/writing evaluation calls an LLM; Workers CPU limits apply per request. |

So "put it on Cloudflare Pages" is a **migration project with a data migration
at its centre**, not a configuration change. It is not comparable to the dojo or
crown deploys, which have no database and no accounts.

## Both options, honestly

**Option A — stay on the tunnel (recommended, and already true).** It is already
behind Cloudflare, already free, already inside the one-tunnel security model
(containers bind `127.0.0.1`, so localhost-binding is the firewall). Nothing to
do. If the goal was "reach it through Cloudflare", that goal is met.

**Option B — move to Cloudflare Pages + D1.** Real benefits: no dependency on
the single Hetzner box, no container to keep alive, no 512 MB ceiling. Real
costs: port SQLite→D1 and migrate live student records, replace bcrypt and
re-migrate hashes, swap SMTP for an HTTP email API, and re-verify every one of
the 20-odd API routes on the Workers runtime. Do **not** attempt this until the
correctness defects in
[`CEFR-ALIGNMENT-AUDIT-AND-PLAN-2026-08-31.md`](./CEFR-ALIGNMENT-AUDIT-AND-PLAN-2026-08-31.md)
(P0) are fixed — migrating a system that is scoring incorrectly just relocates
the bug and adds a second suspect when results look wrong.

## Why the stale `netlify.toml` was worth deleting

It was not merely untidy. It declared `publish = ".next"` and the
`@netlify/plugin-nextjs` plugin, so **if anyone had ever connected this repo to
Netlify, it would have built and served a second live copy of the assessment** —
against a different (empty) database, on a different URL, with its own
certificates and student records. Removing it closes that path.

## ⚠️ A live Netlify duplicate EXISTS and is NOT hypothetical — owner action required

**Verified live 2026-09-17.** The "if anyone had ever connected this repo to
Netlify" above is not hypothetical: a Netlify project **`eecassessment`** IS
connected to this repo and is serving a full, public copy of the assessment at
**`https://eecassessment.netlify.app`** (`/` → 200, `/login` → 200,
`/assessment/reading` → 307). It also publishes a **deploy preview per PR**.

Two reasons this must be shut down, not just noted:

1. **Split student data.** Its database is a separate, non-production one. Anyone
   who registers or takes the test there is **invisible to the admin panel** and
   their results are silently discarded — a student could believe they were
   placed when nothing was recorded.
2. **It runs OLD, vulnerable code.** Confirmed 2026-09-17: the Netlify copy still
   **leaks `correctAnswer`** and still trusts a client-supplied `correct` — i.e.
   the score-forgery hole fixed on the production box (server-side grading,
   PR #27) is **still open on the Netlify duplicate**, because Netlify builds
   from its own project settings and never saw that deploy.

**Deleting `netlify.toml` did NOT stop it** (and cannot): Netlify builds from the
project's own settings, not from a file in the repo.

### Shutdown — must be done from the owner's Netlify dashboard (not doable from CI/SSH)

1. Log in to Netlify → **Sites** → open the **`eecassessment`** site.
2. Either **disconnect the repository** (Site configuration → Build & deploy →
   Continuous deployment → **Unlink/Manage repository**) to stop all future
   builds and PR previews, **or** delete the site entirely (Site configuration →
   **Danger zone → Delete this site**). Deleting is the cleaner choice — nothing
   in the Empire English architecture depends on it (see the architecture diagram
   above; the only public entry point is the Cloudflare Tunnel to the Hetzner box).
3. If the custom sub-project was only reachable via `*.netlify.app`, deletion also
   frees the `eecassessment` subdomain. There is no Cloudflare DNS record to
   remove (the duplicate lives entirely on Netlify's domain).
4. **Verify afterwards:** `curl -s -o /dev/null -w "%{http_code}"
   https://eecassessment.netlify.app/` should return a Netlify 404/unavailable
   page, not 200.

Until this is done, the fixed production app at `assessment.empireenglish.online`
is correct, but the Netlify copy remains a live, forgeable, data-splitting
duplicate.
