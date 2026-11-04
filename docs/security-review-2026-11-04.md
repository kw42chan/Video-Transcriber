---
type: analysis-note
date: 2026-11-04
status: active
tags: [video-transcriber, security-review, code-review]
---

## Scope

Reviewed the `feature/saas-single-dashboard` changes against `origin/main` for security issues, focusing on the Next.js job API, Supabase RLS policies, and worker file handling. The review was read-only; no tests were run.

## Findings

### High: Authenticated users can bypass job entitlements

The `jobs_insert_own` policy in `supabase/migrations/20251030120000_initial_schema.sql` allows an authenticated user to insert any job row whose `user_id` is their own. The API's subscription/trial check in `apps/web/app/api/jobs/route.ts` is therefore bypassable by inserting a pending job directly through the Supabase API. The worker polls and processes pending jobs. This can create unmetered jobs and provider cost.

**Fix:** Remove direct authenticated job inserts and route creation through a trusted server transaction or RPC that atomically enforces entitlement and consumes trial access.

### High: Users can reset their trial flag

`supabase/migrations/20251030120001_lock_byok_enabled_column.sql` grants `authenticated` users update access to `profiles.trial_used`. The own-profile update policy allows a user to change their own flag back to `false`, then use the API's trial allowance again.

**Fix:** Make `trial_used` server-controlled. Consume trial access in the same trusted transaction that creates the job.

### High: Trial and absolute duration limits trust client input

`apps/web/app/(app)/dashboard/dashboard-workspace.tsx` submits `durationSeconds: null`. `apps/web/app/api/jobs/route.ts` turns null into zero for `canCreateJob`, and the worker does not enforce a maximum against media duration before processing. A free user can queue a video longer than the 60-second trial limit, up to the storage upload limit. The absolute 300-second limit is vulnerable to the same client-controlled value.

**Fix:** Measure media duration in a trusted service before accepting or processing a job, then enforce the plan limits server-side.

### Medium: Worker can process another user's private upload

`apps/web/app/api/jobs/route.ts` checks only that `inputPath` starts with `user-uploads/`; it does not verify the path's user ID. `apps/worker/src/index.ts` downloads that path using its service-role Supabase client, which bypasses storage RLS, and uploads outputs under the job owner's ID. If an attacker obtains another user's complete object path, they can cause the worker to read that private video and return derived output to the attacker's job.

**Fix:** Require the storage path to begin with the authenticated user's ID and validate that the object exists in that user's upload area before queueing.

## Hardening note

The worker processes user-supplied media through ffmpeg without visible subprocess timeouts or resource limits, while it holds service-role and provider keys. This creates a denial-of-service and media-parser exposure worth mitigating, but the code review did not establish a separate exploitable vulnerability.

## Follow-up after pull to `5782f17`

Reviewed the branch again against `origin/main` after the GitHub pull. Three earlier findings appear fixed in the current source and migrations: authenticated job inserts and trial flag updates are revoked; job creation now uses a service-role-only transaction that locks and consumes the trial; the API derives the upload path from the signed-in user's ID, and the worker validates ownership before using service-role storage access. I did not verify the live database during this follow-up.

### Resolved: Authentication callback external redirect bypass

The review found that `apps/web/app/auth/callback/route.ts` accepted a `next` value such as `/%5Cevil.example`, which Node's WHATWG URL parser resolves to `https://evil.example/`. The callback now resolves the requested destination against the configured app origin and only keeps it when the parsed destination has the same origin. Otherwise it redirects to `/dashboard`. Both the auth-code and OTP success paths use this validated URL.

The fix was reviewed in source; no tests were run.

### Still open: trusted media-duration enforcement

The job API and atomic RPC deliberately ignore client-supplied duration, but no trusted server-side probe enforces the documented 60-second trial or 300-second absolute limit before the worker processes the media. A user can submit a longer video within the upload size limit, increasing worker load and provider cost. `docs/MVP_SETUP.md` documents this limitation.

**Fix:** Probe duration in a trusted stage before paid processing and reject jobs that exceed the applicable plan limit.

The worker's ffmpeg path still has no visible subprocess timeout or resource limits. This remains a hardening risk for untrusted media, not a separately confirmed exploit in this review. The security re-review itself made no code changes and ran no tests.

## Remaining risk review and fix plan

### Enforce duration before processing

The gap remains in the current branch: `scripts/run-saas-pipeline.mjs` probes duration only after ASR, translation, TTS, and optional lip-sync work, and it never compares the result with a plan limit. `apps/web/app/api/jobs/route.ts` correctly ignores client-provided duration, but the worker still processes the submitted file. This leaves the advertised 60-second trial and 300-second absolute limits unenforced and allows oversized work to consume compute and provider credits.

Recommended flow:

1. Add a trusted validation stage before the pipeline; use `ffprobe` to measure the downloaded media and reject invalid, zero, or over-limit durations before any paid processing.
2. Have the server record the applicable limit for that job (60 seconds for trial, 300 seconds for subscription/BYOK) as trusted job data. Do not derive the limit from request fields.
3. Move trial consumption to an atomic server-side step after duration validation, or reserve the trial at enqueue and release the reservation when validation rejects the media. This prevents concurrent trial jobs while avoiding charging a trial for an invalid overlength upload.
4. Persist the measured duration and mark the job failed with a user-safe error when it exceeds the recorded limit.

### Limit parser blast radius

The worker passes all of `process.env` to the pipeline child (`apps/worker/src/index.ts`), and the pipeline passes its environment to every subprocess (`scripts/run-saas-pipeline.mjs`). That can expose the worker's Supabase service-role and BYOK encryption secrets to ffmpeg/Python processes. This does not prove a media-parser exploit, but it increases impact if one occurs.

Recommended hardening: pass an allowlisted environment to each child and keep Supabase service-role and BYOK encryption secrets only in the worker process. Run ffmpeg as a non-root user with CPU, memory, disk, and wall-clock limits, and kill subprocesses when a job exceeds its timeout.

## QA after redirect fix

Added `packages/shared/test/auth-callback.test.mjs` with coverage for the encoded-backslash external redirect and a valid same-origin OTP redirect. Ran:

```text
node --experimental-vm-modules --test packages/shared/test/*.test.mjs
```

All 10 tests passed. These tests exercise the route with mocked Supabase auth; they do not verify a live Supabase or production deployment.

## Duration-preflight implementation

The worker now probes each downloaded video with `ffprobe` (30-second timeout) before retrieving provider keys or starting transcription, TTS, or lip-sync. The entitlement RPC stores a server-selected 60-second trial or 300-second subscription/BYOK limit on the job. A service-role-only RPC records valid duration, fails over-limit or unreadable media, and releases a reserved trial when preflight rejects it. The worker and pipeline now pass an allowlisted environment to subprocesses so ffprobe and ffmpeg do not directly inherit Supabase or BYOK encryption credentials; provider keys are passed only to the pipeline/vendor steps that need them.

QA: the shared and worker builds passed, and all 18 Node tests passed, including duration boundaries, over-limit rejection, unreadable media, trial-preflight behavior, the auth redirect regression, and child-environment scoping. `git diff --check` passed. The SQL regression script `supabase/tests/job_duration_preflight.sql` was added but not executed because no `psql`, Supabase CLI, or `DATABASE_URL` is available. The migration must be applied before deploying the updated worker; production behavior was not verified.

The worker still has no general wall-clock, CPU, or memory cap for the full pipeline. That separate media-processing hardening risk remains.
