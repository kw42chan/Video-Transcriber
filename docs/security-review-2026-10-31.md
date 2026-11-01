---
type: security-review
date: 2026-10-31
status: active
tags: [video-transcriber, security, abuse-prevention]
---

Review of [[Projects/video-transcriber/README|Video Transcriber]] local commit `217bb1a`. Static code and migration review, live npm advisory lookup, and existing API/path tests. Production database policies, hosting settings, billing configuration, and deployed worker were not independently reverified. This is not a penetration test or evidence of compromise.

## Findings

November 1 implementation update: local fixes now cover upload reservation/current-entitlement policies, duration validation, media sandboxing/credential separation, timeouts and lease recovery, billing consistency, BYOK fallback, and the dependency advisory. Nothing is applied to production. Linux sandbox execution and full deployed flows remain unverified. The findings below describe the original reviewed code; see [[Projects/video-transcriber/docs/MVP_SETUP|setup and rollout guidance]] for current implementation and verification limits.

1. **High: upload storage has no application quota or entitlement gate.** `supabase/migrations/20261030133236_initial_schema.sql:169` permits any authenticated user to insert into their own upload prefix. The 500 MB per-object limit does not cap cumulative bytes, object count, or uploads after trial exhaustion. Legacy source-video and voice-reference buckets also permit owner uploads. Calling Storage directly bypasses dashboard controls. Enforce server-owned upload reservations and per-user aggregate quotas in the storage authorization path; expire unused inputs and disable unused legacy buckets. External provider limits may reduce exposure but were not checked.

2. **High before worker launch: duration limits do not run before processing.** `scripts/run-saas-pipeline.mjs:197` probes duration only after extraction, ASR, translation, TTS and lip sync. The advertised 60-second trial and 300-second absolute limits are absent from the worker/RPC gate. Probe and validate media before extraction or paid calls, reject invalid/nonfinite duration and excessive dimensions, and store the entitlement class at job creation so trial classification survives trial consumption. The TTS script's estimate cap covers only that stage and does not replace early limits.

3. **High impact, conditional exploitability: media subprocesses inherit powerful secrets.** `apps/worker/src/index.ts:28` and `scripts/run-saas-pipeline.mjs:21` pass the whole environment to descendants, including FFmpeg/Python. This exposes service-role, encryption and platform keys if an untrusted-media parser is compromised. The supplied Dockerfile runs as root. Use a minimal environment, non-root execution, resource limits, and separate restricted media execution from database/key access. No parser exploit or remote code execution was demonstrated.

4. **Medium: one stuck job can block the worker.** `apps/worker/src/index.ts:26` waits for a child without an overall deadline; `scripts/run-saas-pipeline.mjs:19` also has no subprocess timeout. Jobs run sequentially. Downloads buffer entire files, and subprocess output accumulates without a cap. A hanging or resource-intensive input can occupy the worker or exhaust memory. Add deadlines, process-tree termination, CPU/memory/output limits, streaming downloads and stale-job recovery.

5. **Medium: Stripe can acknowledge failed entitlement writes.** `apps/web/app/api/stripe/webhook/route.ts:34` ignores Supabase upsert errors and returns success at line 71. A failed cancellation update can leave active access until the stored period expires; failed activation can deny a paying customer. Updates also apply event snapshots without stale-event protection. Check writes, return retryable failures, and reconcile current subscription state with idempotent handling. Checkout also ignores an authenticated subscription upsert that current RLS does not authorize, leading to repeated customer creation before a successful webhook. Signature verification is present. Stripe documents retries, duplicate delivery and unordered events: https://docs.stripe.com/webhooks.

6. **Medium, environment-dependent: incomplete BYOK can use platform fallback credentials.** `apps/worker/src/index.ts:49` clears canonical missing BYOK keys but retains inherited `CANTOGEN_API_KEY` and `SYNC_API_KEY` aliases. Provider helpers accept those aliases (`scripts/tts-canto-gen.mjs:36`, `scripts/lipsync-synclabs.mjs:31`). Root dotenv loading can also introduce aliases. A BYOK-enabled user with incomplete keys can therefore charge the platform when those aliases exist. Require necessary BYOK credentials, clear aliases and prevent dotenv/platform fallback in BYOK jobs. The worker also falls back to platform keys when an enabled BYOK profile has no encrypted payload.

7. **Dependency finding: npm reports one high and one moderate affected package.** Lockfile has Next.js 15.5.28 with nested PostCSS 8.4.31. `npm audit --omit=dev --json` reports PostCSS advisories and the parent Next.js dependency. These are two affected packages in one dependency chain, not two demonstrated application exploits. No user-controlled CSS compilation route was found; practical remote exposure is unproven. Upgrade using a compatible patched dependency resolution and validate the build; do not blindly force a major upgrade. Advisory details: https://github.com/advisories/GHSA-6g55-p6wh-862q and https://github.com/advisories/GHSA-fxqj-rqcc-2cmp.

## Existing protections and validation

- API authentication uses Supabase `getUser`; job paths derive from authenticated identity and worker paths reject foreign prefixes/traversal.
- Atomic trial RPC serializes per-user entitlement checks. Later migrations revoke direct client job writes and privileged RPC execution. Current production application of those migrations was not retested here.
- Private buckets and owner policies exist. BYOK uses AES-GCM with random IVs; API responses expose presence booleans.
- `node --experimental-vm-modules --test packages/shared/test/*.test.mjs`: all 8 passed. Initial invocation without the required VM flag failed at harness setup, then passed with the flag.
- npm audit completed using system CA trust; no dependencies were modified. SQL tests were inspected but not rerun against production.

Prioritize storage quotas immediately, then duration enforcement and worker isolation before public processing. Track remediation in [[Context/todo|open tasks]].

## Practical examples and implementation plan — 2026-11-01

These are illustrative scenarios based on the reviewed code, not incidents or demonstrated exploits. The dependency audit results above are from October 31 and need refreshing when selecting a patch.

| Finding | Practical example | Implementation |
| --- | --- | --- |
| Storage abuse | An exhausted-trial account uploads 100 separate 500 MB files, consuming about 50 GB without creating another job. Hiding the upload button cannot stop direct Storage requests. | Add a server endpoint that checks entitlement and atomically reserves an object slot and byte allowance. Remove unrestricted direct inserts; allow only reserved owner paths through a database-enforced storage policy or a tightly scoped upload flow. Validate actual size, prevent reusable-path overwrites, expire reservations, reconcile actual usage, and clean abandoned media. Apply controls to every writable bucket. |
| Missing duration gate | A free account submits a 30-minute compressed video within the byte limit; processing starts although the trial promises 60 seconds. | Persist server-selected trial/paid/BYOK class in the atomic job transaction. Download into restricted staging; run time-limited probing before decoding/ASR/provider calls. Reject unknown/nonfinite duration, duration above the applicable limit, excessive resolution and unsupported streams. Bound actual decoding too because metadata alone can be misleading. Record verified metadata and failure status. |
| Secret inheritance and root execution | If a crafted media file exploits a parser, that process could read the inherited Supabase service key and BYOK encryption key. No such exploit was demonstrated. | Keep privileged orchestration outside the media sandbox. Give FFmpeg/Whisper only allowlisted runtime variables and the specific job files, without service/encryption keys, network access or broad mounts. Run non-root with a read-only base filesystem and resource limits. Give provider stages only the provider credentials they need. Container root is an increased impact factor, not proof of host compromise. |
| Worker denial of service | A corrupted video hangs FFmpeg; the sequential worker never moves on to the next user's job. A large download or noisy child can exhaust memory. | Add per-stage and whole-job deadlines, terminate the entire process tree, cap captured output, stream bounded downloads, and impose memory/CPU/disk limits. Use leases/heartbeats for running jobs, recover expired leases with bounded retries, and avoid duplicate provider charges during recovery. |
| Stripe state drift | A cancellation webhook arrives while the database write fails. Returning success prevents a normal failure retry; the old active row can remain usable until its stored expiry. Conversely, a paying user can lose access if activation is not stored. | Check every database result. Verify the signature, track event IDs, reconcile authoritative current Stripe state, and transactionally persist the subscription plus event completion. Return retryable errors for processing failures; acknowledge only durable handling or a durable queue entry. Serialize per subscription to prevent concurrent stale writes. Save customer mapping through server-only access and protect concurrent checkout creation. |
| BYOK fallback | A BYOK-enabled user has no saved key bundle, or omits Sync while the worker has a platform SYNC_API_KEY alias. The current code can select platform credentials. | Make BYOK mode explicit and fail closed on missing required keys or decryption failure. Build a fresh environment without inherited provider aliases; disable dotenv loading for SaaS jobs. Skip optional stages only by explicit policy, and never silently switch the billing credential source. Test both absent bundles and partial bundles with platform aliases present. |
| Vulnerable dependency | If attacker-controlled CSS ever reaches the affected PostCSS processing, source-map handling can expose local file content. No such route was found in this app. | Refresh the audit, select a patched framework/dependency combination, regenerate the lockfile, verify the resolved nested PostCSS version, and run a clean install, production build, tests and route smoke checks. Test any override for compatibility. Avoid an automatic forced major upgrade. |

## Verification targets for remediation

- Exhausted-trial and over-quota accounts cannot upload by calling Storage directly; simultaneous reservations cannot exceed aggregate quota, and expired reservations do not remain usable.
- Over-limit and invalid media fail before any paid provider call; valid short media proceeds. Test misleading metadata and decoding limits.
- Media subprocesses cannot read privileged environment variables, other jobs' files or the network; timeout tests confirm descendants terminate and the next job runs.
- Simulated database failure causes a retryable webhook response; duplicate, concurrent and out-of-order events converge on correct billing state.
- BYOK jobs cannot use platform credentials for absent, partial or invalid key bundles, including alias and dotenv cases.
- Resolved dependencies clear the applicable advisories and the production build and smoke checks pass.

Implementation order: storage authorization/quota; early duration validation; worker isolation/deadlines; BYOK credential separation; billing consistency; compatible dependency patching in parallel with the other work. No application fixes were made in this explanatory follow-up.

## Subagent implementation review — November 1

The later implementation pass used three subagents at the user's request, covering findings 3/4, finding 5, and findings 6/7. This supplements the historical findings above; production changes remain deferred.

| Finding | Implemented behavior | Verification boundary |
| --- | --- | --- |
| 3: inherited credentials | Media sandbox exposes only job files and read-only runtime/scripts/model mounts, with isolated PID/network namespaces and a minimal environment. Provider stages receive specific keys; worker master secrets are excluded. | Credential and environment tests pass. Actual Bubblewrap/image isolation requires the target non-root Linux runtime. |
| 4: stalled worker | Bounded stages/pipeline, process-group cleanup, bounded streamed downloads/uploads, private per-attempt directories, strict job identity, output caps, and exact live-lease updates prevent silent stale-worker progress. | Windows deadline/output and worker flow tests pass; POSIX descendant test remains platform-skipped. |
| 5: incorrect billing access | Unique customer mappings, versioned current-state reconciliation, event/user binding, active-expiry validation, durable one-hour checkout attempts, client-write restrictions, and retryable failures. | Route simulations and isolated PostgreSQL suites pass. Live Stripe event delivery/concurrency is not exercised. |
| 6: platform charges for BYOK | Missing/malformed/decryption-failed bundles reject; only canonical provider keys enter pipeline environments; actual dotenv secrets and legacy aliases cannot reactivate platform billing. | Dedicated malformed-bundle, environment injection, real-dotenv and CLI compatibility tests pass. |
| 7: dependency advisories | Next.js 15.5.28 resolves the pinned PostCSS 8.5.32. | Fresh registry audit reports zero known production vulnerabilities; this does not certify all application behavior. |

See [[Projects/video-transcriber/docs/MVP_SETUP|the setup guide]] for rollout, Linux verification, customer-uniqueness preflight and the safe temporary checkout failure near an uncreated attempt's expiry.
