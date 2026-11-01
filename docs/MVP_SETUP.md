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
   - `supabase/migrations/202611010001_job_duration_policy.sql`
   - `supabase/migrations/202611010002_upload_reservations.sql`
   - `supabase/migrations/202611010003_worker_and_billing.sql`
   - `supabase/migrations/202611010004_require_reserved_upload.sql`

The Next.js dashboard uses `jobs` as its project list. These migrations create `profiles`, `jobs`, `subscriptions`, RLS policies, private storage buckets, and `claim_next_job()` for the worker. The final migration also retains the earlier Sidecar project, stage, voice-reference, and output tables; it extends the shared profile schema instead of creating a second `profiles` table.

The final hardening migration supersedes the second migration's grants: authenticated users may update only `encrypted_byok_keys`, `display_name`, and `avatar_url` on their own profile. Both `trial_used` and `byok_enabled` are server-owned. Anonymous clients cannot update either flag.

`POST /api/jobs` authenticates the session, derives the upload path, and calls `create_job_with_trial()` using the server-only service role. The RPC locks the profile row, checks the current subscription/BYOK/trial state, inserts the job, and consumes the trial in a single transaction. Concurrent free-trial requests yield at most one job; a failed insert rolls back trial consumption. Direct authenticated job inserts and anon/authenticated RPC execution are disabled. Apply this migration before deploying the updated API; the API needs `SUPABASE_SERVICE_ROLE_KEY` and fails closed without it.

**Server-side duration enforcement:** client durations are ignored. Migration `202611010001_job_duration_policy.sql` snapshots `max_duration_seconds` in the atomic job transaction: 60 for trials, 300 for subscription/BYOK jobs. The worker downloads the input, invokes a bounded `ffprobe` preflight, stores verified `duration_seconds`, and only then loads provider keys and starts processing. The pipeline independently checks duration at entry before extraction, ASR, translation, TTS or lip sync. Invalid, unknown, nonpositive or excessive durations fail closed. Audio extraction is also capped at the policy limit. Historical jobs without a snapshot use 60 seconds; current profile state is not used to guess their original entitlement.

The probe has a 15-second timeout, bounded output and file-only input protocols. This is a metadata-based duration gate, not full media sandboxing or a guarantee against deceptive container metadata; broader parser/resource isolation remains tracked separately. Trial consumption remains at job creation, including when invalid/overlong media later fails. No credit-balance system or provider-funds check is introduced.

**Rollout:** pause any existing worker, inspect live migration history, apply the new migration, then build/deploy and resume the updated worker. The web API payload is unchanged. An old worker does not enforce the limit even after migration. No live migration or worker deployment has been performed for this November 1 patch.

**Validation:** build shared code, then run `node --experimental-vm-modules --test packages/shared/test/*.test.mjs` (requires Node with TypeScript stripping, FFmpeg and ffprobe). Tests include real generated media, invalid media, duration boundaries, worker ordering and failure handling. Run the SQL suites against a disposable migrated database as well.

## Pending security rollout — November 1

All four November migrations and application changes remain local. Do not run a production migration or deploy until the coordinated rollout is authorized. Stop workers and pause uploads/billing checkout for the cutover, verify migration history, apply the four pending migrations in filename order, and deploy the web and worker together. Existing database backups and rollback planning should be prepared for the release; do not revert storage policies to reopen unrestricted uploads.

### Upload trial bypass and quota enforcement

The dashboard first calls authenticated `POST /api/uploads/reserve`, which uses the service-only `reserve_upload` RPC. The RPC serializes reservations on the profile row and checks current trial/subscription/BYOK access. Storage independently checks both current access and a live, owner-scoped reservation at insert time. No bearer upload token is issued. Direct unreserved uploads, expired reservations, wrong owners, spent trials, overwrites, and inserts into legacy source/voice buckets are denied. Owner reads/deletes remain available.

Reservations expire after 15 minutes. Each reserves the full 500 MiB bucket maximum, regardless of browser-declared size. Initial limits: trial accounts have one 500 MiB input slot; subscription/BYOK accounts have four slots (2,000 MiB). Existing legacy input objects count conservatively toward quota. At most 20 reservations are permitted in a rolling 24-hour window. Job creation requires the matching reservation and completed Storage object; it checks entitlement again and atomically consumes a trial. Queues are capped at four pending/running and 20 new jobs per account per rolling day. HTTP 429 indicates capacity/rate limits. These are per-account controls; signup abuse and provider-level traffic controls still require production configuration review.

`node scripts/cleanup-uploads.mjs` previews cleanup of expired reservation inputs older than seven days; `--apply` performs it in batches of 100. Schedule only after reviewing the dry run and retention policy during deployment. Pending/running jobs and completed outputs are preserved. `UPLOAD_RETENTION_DAYS` may change the input-retention window (minimum one day). Legacy inputs not associated with reservations require a separate reviewed inventory; the script does not delete them.

### Worker and BYOK

Use a Linux host with working unprivileged user namespaces and Bubblewrap. SaaS processing fails closed on unsupported platforms or root execution. Media subprocesses receive only runtime variables, isolated PID/network namespaces, read-only system/script mounts, and the current job directory. They cannot see database/encryption/provider credentials. Node provider stages receive only the provider keys required by that stage; dotenv reload and inherited key aliases are disabled for SaaS. BYOK requires a decryptable bundle with OpenRouter and Canto-Gen keys. Missing optional Sync/Fal keys skip lip sync; missing mandatory keys never fall back to platform credentials.

The Dockerfile runs as non-root and excludes env files from its build context. `apps/worker/compose.security.yaml` supplies read-only root filesystem, dropped capabilities, 4 GiB memory, 2 CPUs, 256 PIDs, and a bounded 2 GiB temporary filesystem. Preserve those limits in alternative hosting. Provision the existing Python ASR dependencies and pre-download the chosen Whisper model into `/opt/whisper-models` before enabling jobs: isolated media has no network. The existing Dockerfile ASR installation is still optional and must be enabled for a complete pipeline.

Run `node scripts/test-media-sandbox.mjs` as the worker user inside the target Linux image. It checks filesystem isolation, non-root identity, hidden credentials, distinct network/PID namespaces, and job writes. Docker was not running locally and WSL lacked Node/FFmpeg/Bubblewrap, so actual Linux isolation and the final image have not been verified in this Windows session. Do not disable the sandbox to work around host incompatibility.

Stages have ten-minute deadlines and bounded captured output; a pipeline has at most 45 minutes and a shorter deadline if necessary to preserve ten minutes for uploads/status writes before lease expiry. Process-group cleanup also handles descendants holding pipes after their leader exits. Input and provider-media downloads stream with a 500 MiB bound and two-minute deadline; Storage/DB requests have one-minute deadlines. Outputs stream to Storage, stay within a fresh private job directory, and are capped at eight files of 500 MiB each with a 1 MiB manifest. The worker grants a 60-minute lease; progress/completion updates require the exact current unexpired lease and a matching running row. Lost/expired leases fail before paid processing; expired running jobs fail on the next poll and are never automatically recharged/retried. Operators must reconcile interrupted provider work before retrying.

### Billing and dependency validation

Stripe signatures remain mandatory. Webhooks resolve a unique server-owned customer mapping, allocate a database fencing version, read current Stripe subscriptions for the configured price, and atomically commit the result and user-bound processed event ID. Active access requires a subscription ID and expiry; known deleted customers reconcile to inactive. Duplicate events are harmless; stale handlers and failed writes return 503 for retry. Stripe requests are bounded to ten seconds with one network retry.

Checkout saves mapping with service access and preserves existing entitlement status. The service-only `reserve_checkout` RPC locks the profile, rejects active local entitlement, and allocates/reuses a durable one-hour attempt. The exact attempt ID and expiry also determine the Stripe idempotency key and session expiry, preventing two payable sessions across an application clock boundary. If the first provider creation never succeeded and a retry has less than Stripe's minimum expiry remaining, the retry may fail temporarily until that hour expires. Do not rotate a potentially live session just to avoid this safe failure.

Before applying the new unique customer index, inspect `subscriptions` for duplicate non-null `stripe_customer_id` values and reconcile their actual ownership. The migration intentionally fails rather than silently assigning ambiguous customer access. Client subscription writes and all billing RPCs remain forbidden to anon/authenticated roles.

PostCSS is pinned/overridden to 8.5.32 while retaining Next.js 15.5.28. Use the declared npm 11.21.1 (`npx --yes npm@11.21.1 ci`) for reliable workspace override handling; the older local npm incorrectly reports override validity. A clean install resolves the patched version. Recheck `npm ls postcss`, audit and production build at release time. A successful audit is not evidence of application security or deployed state.

The subagent review added BYOK payload/environment/real-dotenv regressions, billing event ownership and durable-checkout regressions, provider-download tests, and worker lease/directory/output checks. The POSIX descendant-process regression is skipped on Windows and must run on Linux with the sandbox smoke test.

Integrated result: 33 application tests passed and one POSIX-only test was skipped; all five SQL suites passed in the isolated PostgreSQL runner. Workspace TypeScript checks and web/worker production builds passed. The refreshed production dependency audit reports zero known vulnerabilities; Next.js resolves PostCSS 8.5.32.

Run all SQL suites against a disposable migrated Supabase database with `psql -v ON_ERROR_STOP=1 -f <suite.sql>`, or use `node scripts/test-security-sql.mjs` with `@electric-sql/pglite` available. The runner also accepts `--pglite-module /absolute/path/to/pglite/dist/index.js` and builds an isolated in-memory database; it never connects to production. Its Auth/Storage fixtures do not exercise the live Storage HTTP service or multi-session contention. Production upload, quota, billing retry, and full media smoke tests remain required after the coordinated rollout.

**RLS note:** End users only see their own rows. The **service role** key bypasses RLS — use it only server-side (worker, Stripe webhook, and the jobs API's atomic RPC).

**`byok_enabled`:** Never exposed to client-side updates. Flip it only in the Supabase SQL editor (as postgres) or with the **service role** — e.g. owner onboarding SQL below. The web app gates the BYOK Settings page on `byok_enabled = true` but does not write that column.

---

The job-write hardening migration additionally revokes all client INSERT/UPDATE table and column grants on `jobs`. `jobs_select_own` remains in place for authenticated reads; worker claiming and status/output updates retain service-role access. The web app creates jobs only through `POST /api/jobs` and its service-role entitlement RPC.

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
3. Pause uploads/job creation for the cutover: the hardening migration removes writes required by the old API, so applying it before the new API can temporarily block job creation.
4. Apply only verified pending migrations in order: 202610310001_atomic_job_trial.sql, 202610310002_lock_job_client_writes.sql, 202610310003_lock_definer_functions.sql, after confirming prerequisites.
5. Merge the SaaS branch into main and deploy the updated web app and worker promptly. If merging automatically deploys production, keep that merge until the database step succeeds.
6. Verify signup, first trial, repeat-trial denial, owner-only storage access, and worker processing before reopening uploads. GitHub merging alone does not apply database migrations without configured automation.

### Verified production migration baseline (2026-10-31)

The linked project records `20261030133236_initial_schema` and `20261030133246_lock_byok_enabled_column` as applied. The repository retains those exact fetched migration definitions instead of duplicate bootstrap files under different timestamps. The workspace extension is ordered after them as `20261030133300_sidecar_workspace.sql`; it adds the profile display fields and trigger helpers required by the later hardening migrations. No remote history repair or bootstrap replay was needed. The workspace extension and all three security migrations have now been applied; a linked dry run reports the database is up to date.

## Production release status (2026-10-31)

- PR #1 was merged into `main` as `462f1be`.
- The web app is deployed at https://video-transcriber-sigma-pearl.vercel.app. The public domain is the canonical `NEXT_PUBLIC_APP_URL`; team-scoped Vercel aliases require deployment authentication.
- The server-only Supabase service-role secret is configured in Vercel production and preview. No credentials are stored in the repository.
- All three SQL regression suites passed on the live database with fixtures rolled back. Real Auth signup and metadata triggers passed; direct client job writes and worker RPC calls were denied.
- The live API rejected foreign upload paths with 400. Two concurrent free-trial requests returned 200 and 403, creating exactly one job. All temporary test users, jobs, and uploads were removed.
- Darwin confirmed no VPS deployment has been made. The worker still needs a production host and a complete media-processing verification. Its build and service-role claim/update SQL checks pass, but those checks do not establish a deployed worker.
- Trusted server-side media-duration enforcement remains a separate follow-up.
