# Video-Transcriber SaaS MVP — setup

Darwin’s dedicated Supabase project is already provisioned. Use it for migrations, Auth, Storage, and Postgres.

| Field | Value |
| --- | --- |
| Project name | `video-transcriber` |
| Project ref / ID | `gtwbeqhdsjcpavquengm` |
| API URL | `https://gtwbeqhdsjcpavquengm.supabase.co` |
| Region | `ap-southeast-1` (Singapore) |
| Dashboard | https://supabase.com/dashboard/project/gtwbeqhdsjcpavquengm |

Secret keys (`anon`, `service_role`) stay in the Supabase dashboard → **Project Settings → API**. Never commit them.

---

## 1. Apply database migrations

Migrations live in `supabase/migrations/`.

**Option A — Supabase CLI (recommended)**

```bash
# Install CLI: https://supabase.com/docs/guides/cli
supabase login
cd /path/to/repo
supabase link --project-ref gtwbeqhdsjcpavquengm
supabase db push
```

**Option B — SQL editor**

1. Open https://supabase.com/dashboard/project/gtwbeqhdsjcpavquengm/sql/new  
2. Run each file in order:
   - `supabase/migrations/20251030120000_initial_schema.sql`
   - `supabase/migrations/20251030120001_lock_byok_enabled_column.sql`

This creates `profiles`, `jobs`, `subscriptions`, RLS policies, storage buckets (`user-uploads`, `job-outputs`), and `claim_next_job()` for the worker.

The second migration matches production hardening: authenticated users may **select** their profile and **update only** `trial_used` and `encrypted_byok_keys`. They cannot update `byok_enabled` (or other columns) via the anon/authenticated API.

**RLS note:** End users only see their own rows. The **service role** key bypasses RLS — use it only on the worker and Stripe webhook route (server-side).

**`byok_enabled`:** Never exposed to client-side updates. Flip it only in the Supabase SQL editor (as postgres) or with the **service role** — e.g. owner onboarding SQL below. The web app gates the BYOK Settings page on `byok_enabled = true` but does not write that column.

---

## 2. Supabase Auth

In the dashboard → **Authentication → Providers**, enable **Email** with password (or adjust to magic link if you prefer later).

For local web dev, add **http://localhost:3000** to **Authentication → URL configuration → Redirect URLs**.

---

## 3. Environment variables

### Web (`apps/web/.env.local`)

Copy from `apps/web/.env.example`. Minimum for local dev:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://gtwbeqhdsjcpavquengm.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=          # Dashboard → API → anon public
SUPABASE_SERVICE_ROLE_KEY=              # Dashboard → API → service_role (server routes only)
NEXT_PUBLIC_APP_URL=http://localhost:3000
BYOK_ENCRYPTION_KEY=                    # openssl rand -base64 32
```

Stripe (optional until billing is wired; for testing you can set `subscriptions.status = 'active'` manually):

```bash
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_ID=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
```

### Worker (`apps/worker/.env` or host env)

Same Supabase URL + **service role** key. Platform pipeline keys (or rely on BYOK users):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://gtwbeqhdsjcpavquengm.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
BYOK_ENCRYPTION_KEY=                    # must match web app

OPENROUTER_API_KEY=
CANTO_GEN_API_KEY=
SYNCLABS_API_KEY=
FAL_KEY=
```

### CLI / Phase 0 (repo root `.env`)

Unchanged for `scripts/run-ab.mjs` etc. See root `.env.example`. SaaS worker uses the keys above, not necessarily the root `.env`.

---

## 4. Vercel (web app)

1. Import repo; set **Root Directory** to `apps/web` (or monorepo build command — see `apps/web/package.json`).
2. Add the same env vars as `apps/web/.env.local`.
3. `NEXT_PUBLIC_APP_URL` = your production URL.

---

## 5. Worker (Fly / Railway / VPS)

```bash
cd apps/worker
npm install
npm run build
npm start
```

Or build from repo root with `apps/worker/Dockerfile` (needs `ffmpeg`; optional Python + `faster-whisper` for ASR).

The worker polls `claim_next_job()` and runs `scripts/run-saas-pipeline.mjs` against Supabase Storage paths.

---

## 6. Stripe

1. Create a **Product** + recurring **Price** in Stripe Dashboard.
2. Set `STRIPE_PRICE_ID` to the Price id (`price_…`).
3. Webhook endpoint: `https://<your-app>/api/stripe/webhook`  
   Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.
4. Copy signing secret → `STRIPE_WEBHOOK_SECRET`.

**Without Stripe keys:** the app should still build. For testing, activate a user manually:

```sql
-- In Supabase SQL editor (project gtwbeqhdsjcpavquengm)
update public.subscriptions
set status = 'active', current_period_end = now() + interval '30 days'
where user_id = '<uuid-from-auth-users>';
```

---

## 7. Owner BYOK (Darwin)

Normal users never see API key UI. Enable BYOK only for the owner account (SQL editor or service role — **not** the logged-in user session):

```sql
update public.profiles
set byok_enabled = true
where id = '<darwin-user-uuid>';
```

Then open **Settings → BYOK** in the app (after login). Saving keys calls **`POST /api/settings/byok`** (server route). That handler updates **`encrypted_byok_keys` only** using the user’s Supabase session, which is allowed by column grants after `20251030120001_lock_byok_enabled_column.sql`. It never sends or writes `byok_enabled`. Keys are encrypted with `BYOK_ENCRYPTION_KEY` (AES-GCM); plaintext is never returned to the browser after save.

---

## 8. Smoke test

1. Register a test user → confirm a `profiles` row exists (trigger).  
2. Upload a short MP4 (≤60s for free trial) on **Dashboard** → job becomes `pending`.  
3. Start worker → job → `running` → `succeeded`; download outputs from Storage.  
4. Second job without subscription should hit paywall (unless BYOK/sub active).  
5. Optional: Stripe checkout → webhook → `subscriptions.status = active`.

---

## Darwin’s remaining checklist

- [ ] Paste `anon` + `service_role` from https://supabase.com/dashboard/project/gtwbeqhdsjcpavquengm/settings/api  
- [ ] Apply migrations (CLI `db push` or SQL editor)  
- [ ] Fill Vercel + worker env (OpenRouter, Canto-Gen, Sync/Fal, `BYOK_ENCRYPTION_KEY`)  
- [ ] Stripe account: Product/Price, webhook, env vars  
- [ ] Set `byok_enabled = true` on owner profile via SQL  
- [ ] Deploy worker with `ffmpeg` (+ ASR deps if using full pipeline)
