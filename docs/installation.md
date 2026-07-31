# Installation

How to get Krowe Portal running from a clean clone. Roughly 20 minutes, most of
it spent creating accounts on the services the app talks to.

The app is a Next.js 16 App Router project backed by a **hosted Supabase**
project (Postgres + Auth + RLS). There is no local Postgres or Supabase CLI
setup — even in development you point at a real Supabase project.

---

## 1. Prerequisites

| Requirement | Notes |
| --- | --- |
| **Node.js 20.19+** | Next.js 16 needs ≥20.9, but Vitest 4 loads `vitest.config.ts` through `require(esm)`, which only exists in 20.19+ / 22.12+ / 24+. On 20.18 the app runs but `npm test` won't start. Node 22 LTS is the safe pick. Check with `node -v`. |
| **npm 10+** | Ships with Node 20/22. |
| **A Supabase project** | Free tier is fine. Create one at [supabase.com](https://supabase.com/dashboard). |
| **An OpenAI API key** | Required — the app throws `OPENAI_API_KEY is not set` at import without it. |

Optional, only needed for the features that use them: a GitHub OAuth App
(repo/branch/commit linking), a Resend API key (feedback notification email), a
Google OAuth Client ID (one-tap sign-in), and Granola OAuth credentials.

---

## 2. Clone and install

```bash
git clone https://github.com/kroweinc/KrowePortal.git
cd KrowePortal
npm install
```

---

## 3. Configure the environment

Copy the template and fill it in. `.env.example` is the authoritative list —
every variable is documented inline there, including the ones this page skips.

```bash
cp .env.example .env.local
```

### Required

| Variable | Where it comes from |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → `anon` public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` key. **Server-only** — it bypasses RLS; never expose it to the client. |
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com/api-keys) |
| `ENCRYPTION_KEY` | Generate: `openssl rand -hex 32`. Encrypts GitHub/Granola OAuth tokens at rest. |

### Recommended locally

```bash
APP_ORIGIN=http://localhost:3030
NEXT_PUBLIC_APP_ORIGIN=http://localhost:3030
```

Required in production — without them, OAuth redirects fall back to the incoming
request's `Host` header.

Leave `NEXT_PUBLIC_ASSET_PREFIX` blank in development. It exists only for the
production deployment, which is path-proxied behind the krowehub.com landing
site and must serve its own `/_next` chunks.

---

## 4. Set up the database

Migrations are plain SQL under `supabase/migrations/completed/`. Apply them in
**filename order** — the numeric prefixes sort correctly, and a few numbers are
duplicated across parallel branches (`0008`, `0014`, `0018`, `0066`–`0068`,
`0077`), which is expected; lexicographic order is the intended order.

Easiest path for a fresh project — Supabase Dashboard → **SQL Editor** → paste
and run each file in order, starting with `0001_init.sql`.

To concatenate them into one script instead:

```bash
cat supabase/migrations/completed/*.sql > /tmp/krowe-schema.sql
```

Then paste that single file into the SQL Editor.

**`vector` extension.** The context/semantic-search tables need pgvector. The
migration that needs it runs `create extension if not exists vector;` itself, so
running the files in order is enough — but if your project disallows extension
creation from the SQL editor, enable **vector** under Database → Extensions
first.

### Seed data (optional)

`supabase/seed.sql` creates two dev profiles, one engagement, and sample tasks.
It expects the synthetic dev user IDs from `0004_dev_profiles.sql` — if you skip
that migration, swap `op_id` / `bl_id` in the seed for real `auth.users` IDs.

For a fuller demo dataset against a hosted project:

```bash
# needs SUPABASE_SERVICE_ROLE_KEY + DEMO_ACCOUNT_PASSWORD in .env.local
node scripts/seed-demo-account.mjs
```

It is idempotent — safe to re-run.

---

## 5. Run it

```bash
npm run dev
```

The app serves on **http://localhost:3030** (the port is fixed in the `dev`
script, which also frees 3030 first and raises the max HTTP header size for
large Supabase auth cookies).

---

## 6. Sign in

**With real auth** — visit `/login` and sign up. Supabase sends the confirmation
email; on its built-in mailer that only reliably reaches project members, so for
a solo local setup either confirm the user manually in Supabase → Authentication
→ Users, or wire up Custom SMTP (see [`auth-email-resend-smtp.md`](./auth-email-resend-smtp.md)).

**Without auth (dev only)** — the app ships a synthetic-identity bypass gated on
`NODE_ENV !== "production"`, so it can never grant an identity in a production
build:

```bash
# .env.local
NEXT_PUBLIC_ENABLE_ROLE_SWITCHER=true   # shows the in-app role switcher
DEV_AUTH_ROLE=builder                   # or: operator
```

`DEV_AUTH_ROLE` picks the default identity; the in-app switcher overrides it per
browser via a `dev_role` cookie. Builders land on `/b`, operators on `/o`.

---

## 7. Optional integrations

**GitHub** (repo picker, branch chips, commit linking) — create an OAuth App
with callback `http://localhost:3030/api/github/callback`, then set
`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `GITHUB_REDIRECT_URI`. Use a
separate OAuth App for production.

**Google sign-in** — set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` to a Web application
Client ID, add `http://localhost:3030` and `http://localhost` as authorized
JavaScript origins, and register the same Client ID under Supabase →
Authentication → Providers → Google. Left blank, login falls back to the
redirect OAuth flow.

**Resend** — `RESEND_API_KEY` is only needed for product-feedback notification
email. Auth email is configured in the Supabase dashboard, not here.

**Granola** — OAuth is discovered dynamically; set `GRANOLA_REDIRECT_URI` only
to pin it explicitly.

Model and rate-limit tuning (`OPENAI_MODEL`, `AI_DAILY_TOKEN_CAP`,
`RATE_LIMIT_*`, …) all have working defaults. See `.env.example`.

---

## 8. Verify the install

```bash
npm test        # vitest — unit tests under tests/
npm run lint    # eslint
npm run build   # production build; catches type errors
```

Then load http://localhost:3030 and confirm you land on `/login` (or `/b` with
the dev bypass on).

---

## Troubleshooting

**`OPENAI_API_KEY is not set`, thrown on startup** — the OpenAI client is
constructed at import, so a missing key fails the whole app, not just AI routes.
Set it in `.env.local` and restart.

**`ENCRYPTION_KEY is not set`** — generate one with `openssl rand -hex 32`. Any
flow touching stored GitHub/Granola tokens needs it.

**Port 3030 already in use** — `npm run dev` kills whatever holds 3030 first. If
you want a different port, run `next dev --port <n>` directly.

**Empty pages, or rows that exist in the dashboard but not in the app** — almost
always RLS. Every table has policies; a query made with the anon key as the
wrong role legitimately returns nothing. Confirm you are signed in as the role
that owns the row.

**`relation "..." does not exist`** — a migration was skipped. Re-run the
remaining files from `supabase/migrations/completed/` in filename order; they
are written to be idempotent (`create table if not exists`, etc.).

**`npm test` fails with `ERR_REQUIRE_ESM` loading `vitest.config.ts`** — your
Node is older than 20.19. Switch to Node 22 (`nvm use 22`) and re-run.

**Stale type errors from `tsc`** — the incremental build cache can report
phantom errors. Re-check with `npx tsc --noEmit --incremental false`.
