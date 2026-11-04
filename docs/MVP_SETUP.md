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
   - `supabase/migrations/20261030133236_initial_schema.sql`
   - `supabase/migrations/20261030133246_lock_byok_enabled_column.sql`
   - `supabase/migrations/20261030133300_sidecar_workspace.sql`
   - `supabase/migrations/202610310001_atomic_job_trial.sql`
   - `supabase/migrations/202610310002_lock_job_client_writes.sql`
   - `supabase/migrations/202610310003_lock_definer_functions.sql`
   - `supabase/migrations/202611040001_job_duration_preflight.sql`

The Next.js dashboard uses `jobs` as its project list. These migrations create `profiles`, `jobs`, `subscriptions`, RLS policies, private storage buckets, and `claim_next_job()` for the worker. The final migration also retains the earlier Sidecar project, stage, voice-reference, and output tables; it extends the shared profile schema instead of creating a second `profiles` table.

The final hardening migration supersedes the second migration's grants: authenticated users may update only `encrypted_byok_keys`, `display_name`, and `avatar_url` on their own profile. Both `trial_used` and `byok_enabled` are server-owned. Anonymous clients cannot update either flag.

`POST /api/jobs` authenticates the session, derives the upload path, and calls `create_job_with_trial()` using the server-only service role. The RPC locks the profile row, checks the current subscription/BYOK/trial state, inserts the job with a trusted 60-second trial or 300-second subscription/BYOK limit, and reserves the trial in one transaction. Concurrent free-trial requests yield at most one reservation; a failed insert rolls back the reservation. Direct authenticated job inserts and anon/authenticated RPC execution are disabled. Apply the migrations before deploying the updated API; it needs `SUPABASE_SERVICE_ROLE_KEY` and fails closed without it.

**Duration preflight:** the dashboard's `durationSeconds` field is ignored. After download and before loading provider keys or starting the processing pipeline, the worker measures the source with `ffprobe` (30-second timeout). It submits the measured value to `complete_job_preflight()`, which compares it to the limit saved by the entitlement RPC and records valid duration. Over-limit or unreadable files fail before provider calls; rejected trial uploads release their reservation. The database RPC is authoritative, so a client-supplied duration cannot change the limit or result. The migration gives pre-existing jobs a conservative 60-second limit; drain the current queue before applying it if existing longer paid jobs must finish under the old worker.

**RLS note:** End users only see their own rows. The **service role** key bypasses RLS — use it only server-side (worker, Stripe webhook, and the jobs API's atomic RPC).

**`byok_enabled`:** Never exposed to client-side updates. Flip it only in the Supabase SQL editor (as postgres) or with the **service role** — e.g. owner onboarding SQL below. The web app gates the BYOK Settings page on `byok_enabled = true` but does not write that column.

---

The job-write hardening migration additionally revokes all client INSERT/UPDATE table and column grants on `jobs`. `jobs_select_own` remains in place for authenticated reads; worker claiming and status/output updates retain service-role access. The web app creates jobs only through `POST /api/jobs` and its service-role entitlement RPC.

## 2. Supabase Auth

In the dashboard → **Authentication → Providers**, enable **Email** with password (or adjust to magic link if you prefer later).

In **Authentication → URL configuration**:

| Setting | Value |
| --- | --- |
| **Site URL** | Production app URL, e.g. `https://video-transcriber-sigma-pearl.vercel.app` (not `/auth/callback` — the app forwards `?code=` from `/` when needed) |
| **Redirect URLs** | Production callback: `https://video-transcriber-sigma-pearl.vercel.app/auth/callback` |
| | Local dev: `http://localhost:3000/auth/callback` |

Signup sets `emailRedirectTo` to `${NEXT_PUBLIC_APP_URL}/auth/callback`. The `/auth/callback` route exchanges the PKCE `code` (or `token_hash` OTP links) for a session cookie and redirects to `/dashboard`.

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

1. Import the repository with its root as the Vercel project directory so the shared workspace builds before the web app.
2. Add the same env vars as `apps/web/.env.local`.
3. `NEXT_PUBLIC_APP_URL` = your production URL.
4. Use `npm run build` as the build command. The root script builds `packages/shared` before `apps/web`.

---

## 5. Worker (Fly / Railway / VPS)

```bash
cd apps/worker
npm install
npm run build
npm start
```

Or build from repo root with `apps/worker/Dockerfile` (needs `ffmpeg`; optional Python + `faster-whisper` for ASR).

The worker polls `claim_next_job()` using only `SUPABASE_SERVICE_ROLE_KEY` and runs `scripts/run-saas-pipeline.mjs` against Supabase Storage paths. The definer-function hardening migration explicitly denies PUBLIC, anon, and authenticated execution of the worker RPC, the atomic job RPC, and signup/project trigger helpers. All have a fixed empty `search_path` and schema-qualified table references. Existing auth signup/metadata and project-stage triggers continue to invoke their helpers; no public Next.js route exposes the worker RPC.

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

Then open **Settings → BYOK** in the app (after login). Saving keys calls **`POST /api/settings/byok`** (server route). That handler updates **`encrypted_byok_keys` only** using the user’s Supabase session, which remains allowed after `202610310001_atomic_job_trial.sql`. It never sends or writes `byok_enabled`. Keys are encrypted with `BYOK_ENCRYPTION_KEY` (AES-GCM); plaintext is never returned to the browser after save.

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
- [x] Initial schema on `gtwbeqhdsjcpavquengm` (Darwin) — ensure `20261030133246_lock_byok_enabled_column.sql` is applied if not already
- [ ] Fill Vercel + worker env (OpenRouter, Canto-Gen, Sync/Fal, `BYOK_ENCRYPTION_KEY`)
- [ ] Stripe account: Product/Price, webhook, env vars
- [ ] Set `byok_enabled = true` on owner profile via SQL
- [ ] Deploy worker with `ffmpeg` (+ ASR deps if using full pipeline)

## Branch consolidation review (2026-10-31)

Freshly fetched origin/main and origin/feature/ui-enhancement both point to 34def28. origin/cursor/video-transcriber-saas-mvp-d42e points to ddf4018 and contains main plus six commits. Recommend merging the SaaS branch into main after a production build and deployment review; main can fast-forward with no divergent commits. This includes the Next.js SaaS conversion as well as security hardening, so apply the pending migrations before deploying the updated API and verify server environment variables. The identical UI branch is redundant and can be removed after consolidation. No merge or branch deletion was performed during this review.

## Production release order

1. Build and test the SaaS branch and verify server-only service-role environment configuration for the web app and worker.
2. Inspect the linked database migration history and preview pending migrations. If earlier schema changes were applied manually, reconcile history against the actual schema before applying anything; do not replay initial schema files blindly.
3. Pause uploads/job creation and worker processing for the cutover: the hardening migrations change the job write path, and the new duration check requires the updated worker and database RPC to be deployed together.
4. Apply only verified pending migrations in order: 202610310001_atomic_job_trial.sql, 202610310002_lock_job_client_writes.sql, 202610310003_lock_definer_functions.sql, then 202611040001_job_duration_preflight.sql, after confirming prerequisites. Apply the duration migration before deploying code that calls `complete_job_preflight()`.
5. Merge the SaaS branch into main and deploy the updated web app and worker promptly. If merging automatically deploys production, keep that merge until the database step succeeds.
6. Run `supabase/tests/job_duration_preflight.sql` against a disposable migrated database, then verify a valid short upload, an over-limit upload, an unreadable upload, trial release, and that rejected jobs make no provider calls before reopening uploads. GitHub merging alone does not apply database migrations without configured automation.

### Verified production migration baseline (2026-10-31)

The linked project records `20261030133236_initial_schema` and `20261030133246_lock_byok_enabled_column` as applied. The repository retains those exact fetched migration definitions instead of duplicate bootstrap files under different timestamps. The workspace extension is ordered after them as `20261030133300_sidecar_workspace.sql`; it adds the profile display fields and trigger helpers required by the later hardening migrations. No remote history repair or bootstrap replay was needed. The workspace extension and all three security migrations have now been applied; a linked dry run reports the database is up to date.

## Production release status (2026-10-31)

- PR #1 was merged into `main` as `462f1be`.
- The web app is deployed at https://video-transcriber-sigma-pearl.vercel.app. The public domain is the canonical `NEXT_PUBLIC_APP_URL`; team-scoped Vercel aliases require deployment authentication.
- The server-only Supabase service-role secret is configured in Vercel production and preview. No credentials are stored in the repository.
- All three SQL regression suites passed on the live database with fixtures rolled back. Real Auth signup and metadata triggers passed; direct client job writes and worker RPC calls were denied.
- The live API rejected foreign upload paths with 400. Two concurrent free-trial requests returned 200 and 403, creating exactly one job. All temporary test users, jobs, and uploads were removed.
- Darwin confirmed no VPS deployment has been made. The worker still needs a production host and a complete media-processing verification. Its build and service-role claim/update SQL checks pass, but those checks do not establish a deployed worker.
- The duration preflight implementation is in the branch; apply its new migration and verify short, over-limit, and unreadable uploads before deploying the updated worker.
