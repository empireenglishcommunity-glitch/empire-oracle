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

## 🔴 A live duplicate of the assessment IS on Netlify (found 2026-08-31)

This is not hypothetical and it is not merely stale config. **A Netlify project
named `eecassessment` is connected to this repository and is serving a
fully-functional public copy of the assessment right now:**

```
https://eecassessment.netlify.app/          → HTTP 200, server: Netlify
https://eecassessment.netlify.app/assessment/writing → HTTP 200  (the test is takeable)
https://eecassessment.netlify.app/api/questions      → HTTP 400 {"error":"Module parameter required"}
```

That last response matters: a 400 from the application means the **API routes are
executing**, not 404-ing as static files. It is a running app, not a broken
build. It also builds a **deploy preview on every pull request** — the check
`netlify/eecassessment/deploy-preview` appeared on PR #24 with a public URL
(`deploy-preview-24--eecassessment.netlify.app`).

**Why this matters**

- It is a **fourth assessment surface**, after `assessment.empireenglish.online`,
  `test.empireenglish.online` and the dojo `/placement/` page.
- Its database is **not** production's. Any student who registers or completes a
  test there creates records the admin panel cannot see — the work is silently
  lost, exactly like the guest-mode defect in the P0 audit.
- Every PR publishes another public copy at a predictable URL.
- It serves the same defective scoring (writing constant 18/30), under an
  Empire-English-branded page, at a URL nobody is monitoring.

**Deleting `netlify.toml` does NOT switch this off.** Netlify builds from its own
project settings, not from the presence of that file — removing it may simply
change *how* it builds. Shutting it down is **owner-gated** and must be done in
the Netlify dashboard:

1. Netlify → project `eecassessment` → **Site configuration → Danger zone** →
   either **unlink the GitHub repository** (stops all future builds and previews)
   or **delete the site** (also removes `eecassessment.netlify.app`).
2. Confirm the check `netlify/eecassessment/deploy-preview` no longer appears on
   a new PR.
3. If the site is kept for any reason, at minimum set password protection and
   add `X-Robots-Tag: noindex` so it cannot be found or indexed.

Removing `netlify.toml` is still correct — it stops the repo *declaring* a
Netlify build — but it closes only half the path. The other half is the Netlify
project itself.
