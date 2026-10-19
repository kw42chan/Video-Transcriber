# Vendor API notes (TTS verified 2026-10-18; lip sync verified 2026-10-19)

> Day 1 outcome: **Canto-Gen won**; ElevenLabs and MiniMax are dropped (notes kept for reference).

Offline harness summary of auth, clone upload, TTS request shape, free-tier limits, and Cantonese confirmation. Sources fetched from official docs.

---

## 1. Canto-Gen (港嘢) — `https://canto-gen.com`

**Cantonese confirmed:** Yes — product is Cantonese-native TTS (nine tones, particles). Gallery voices are all Cantonese.

### Auth
| Item | Value |
| --- | --- |
| Header | `Authorization: Bearer $CANTO_GEN_API_KEY` (docs name: `CANTOGEN_API_KEY`) |
| Key format | `sk_live_…` |
| Scopes | `tts:generate` (default); **`tts:clone` required for clone mode**; `tts:design`; `voices:manage` |
| Catalog | `GET /v1/voices` (anonymous OK) |

### Clone upload
- **No separate upload endpoint.** Embed reference in the job body.
- Field: `clone.reference_audio` = data URL or raw base64 (`audio/mpeg`, `wav`, `webm`, `mp4/m4a`, `ogg`).
- Cap: ≤4.4 MB request (≈3 MB audio after base64).
- Duration: **≥8 s** (shorter rejected); auto-trim ~15–20 s (30 s cap).
- Clone is **per-request** (not saved as a reusable voice asset).
- Clone **requires async** `POST /v1/audio/jobs` (sync speech endpoint does not support clone).

### TTS request shape
```http
POST https://canto-gen.com/v1/audio/jobs
Authorization: Bearer sk_live_…
Content-Type: application/json

{
  "model": "cantogen-tts",
  "clone": { "reference_audio": "data:audio/wav;base64,…" },
  "text": "用我把聲講呢句嘢。",
  "response_format": "mp3"
}
```
- Mutually exclusive modes: exactly one of `voice` | `design` | `clone`.
- Text cap async: **500 characters** (`400 text_too_long` if over).
- Sync shortcut: `POST /v1/audio/speech` ≤300 chars, voice/design only → raw audio bytes.
- Poll: `GET /v1/audio/jobs/{job_id}` until `status=completed`, then download `audio_url` (pre-signed; no auth).

### Free / limits
- Free API key: **50 generation requests/day** (polling/downloads free).
- Paid: no daily cap; account character pool + optional per-key monthly cap.
- Rate: default **60 req/min** (`X-RateLimit-*`).
- Concurrent pending jobs plan-tiered (free starts low).

### Harness mapping
- Env: `CANTO_GEN_API_KEY` (or `CANTOGEN_API_KEY`).
- Script: `scripts/tts-canto-gen.mjs`.

---

## 2. ElevenLabs — `https://api.elevenlabs.io` (DROPPED after Day 1)

**Cantonese confirmed:** Yes on **Eleven v4** — language list includes **Cantonese (`yue`)**. Use `language_code: "yue"` (ISO 639-3; not supported on `eleven_multilingual_v2`).

### Auth
| Item | Value |
| --- | --- |
| Header | **`xi-api-key: $ELEVENLABS_API_KEY`** (not Bearer) |
| TTS | `POST /v1/text-to-speech/{voice_id}` |
| Response | Raw audio bytes (e.g. `mp3_44100_128` via query `output_format`) |

### Clone upload (Instant Voice Clone)
```http
POST https://api.elevenlabs.io/v1/voices/add
xi-api-key: …
Content-Type: multipart/form-data

name=phase0-clone
files=@ref.wav
```
- Returns `{ "voice_id": "…", "requires_verification": false }`.
- IVC: short clean sample (product docs: as little as ~10s–2 min; more samples help).
- Reuse `voice_id` via `ELEVENLABS_VOICE_ID` to avoid re-creating IVC every run.

### TTS request shape (v4 + yue)
```http
POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128
xi-api-key: …
Content-Type: application/json

{
  "text": "今日天氣幾好。",
  "model_id": "eleven_v4",
  "language_code": "yue",
  "voice_settings": { "stability": 0.5, "similarity_boost": 0.8 }
}
```
- Models: `eleven_v4` (quality) / `eleven_v4_turbo` (low latency).
- Cross-language note (v4): if generate language ≠ reference language, v4 aims for **fluent target language** rather than carrying source accent — test EN-ref → yue carefully for this A/B.

### Free / limits
- Free / Starter tiers have character quotas and concurrent limits (check dashboard).
- MP3 192kbps and some PCM/WAV rates need higher tiers.
- Harness does not invent keys; without `ELEVENLABS_API_KEY` the vendor is skipped.

### Harness mapping
- Env: `ELEVENLABS_API_KEY`, optional `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL=eleven_v4`.
- Script: `scripts/tts-elevenlabs.mjs`.

---

## 3. MiniMax Speech T2A — `https://api.minimax.io` (DROPPED after Day 1)

**Cantonese confirmed:** Yes — set `language_boost: "Chinese,Yue"`. System Cantonese voices include:
- `Cantonese_GentleLady`
- `Cantonese_podacast_host_1` (spelling as in docs)

### Mandarin trap (DO NOT USE)
- **`Chinese (Mandarin)_HK_Flight_Attendant`** — listed under **Chinese (Mandarin)** system voices. Name says HK; speech is **Mandarin**, not 粵語口語. Harness hard-refuses any `*HK_Flight_Attendant*` voice id.

### Auth
| Item | Value |
| --- | --- |
| Header | `Authorization: Bearer $MINIMAX_API_KEY` |
| Optional | `GroupId: $MINIMAX_GROUP_ID` — **not required** on international `api.minimax.io` per current OpenAPI; keep for CN-style accounts that still show a GroupId in the dashboard. |
| Content-Type | `application/json` (T2A / clone); multipart for file upload |

### Clone upload
1. Upload audio:
```http
POST https://api.minimax.io/v1/files/upload
Authorization: Bearer …
Content-Type: multipart/form-data

purpose=voice_clone
file=@ref.wav
```
- Formats: mp3 / m4a / wav; **duration 10 s – 5 min**; ≤20 MB.
- Response: `file.file_id`.

2. Clone:
```http
POST https://api.minimax.io/v1/voice_clone
Authorization: Bearer …
Content-Type: application/json

{
  "file_id": 123456789,
  "voice_id": "Phase0CantoAbcd1234",
  "language_boost": "Chinese,Yue",
  "model": "speech-2.8-hd"
}
```
- Custom `voice_id`: length 8–256, starts with letter, `[A-Za-z0-9_-]`, not ending in `-`/`_`.
- Unused clones may be deleted after **7 days** — synthesize within that window.
- Optional preview `text` is billed as T2A.

### TTS request shape
```http
POST https://api.minimax.io/v1/t2a_v2
Authorization: Bearer …
Content-Type: application/json

{
  "model": "speech-2.8-hd",
  "text": "你好，我係廣東話。",
  "stream": false,
  "language_boost": "Chinese,Yue",
  "output_format": "hex",
  "voice_setting": { "voice_id": "Cantonese_GentleLady", "speed": 1, "vol": 1, "pitch": 0 },
  "audio_setting": { "sample_rate": 32000, "bitrate": 128000, "format": "mp3", "channel": 1 }
}
```
- Non-stream success: `data.audio` = **hex-encoded** MP3 (harness decodes to file).
- Text &lt; 10 000 chars; Jyutping override supported in parentheses e.g. `(sung3)`.
- Always set `language_boost` to **`Chinese,Yue`** for this A/B (never bare `Chinese` alone for 口語).

### Free / limits
- Account balance / TPM rate limits (`1002`, `1039`). Auth failures `1004` / `2049`.
- Exact free-tier characters vary by plan — check MiniMax billing console.
- Without `MINIMAX_API_KEY`, harness skips this vendor.

### Harness mapping
- Env: `MINIMAX_API_KEY`, optional `MINIMAX_GROUP_ID`, `MINIMAX_VOICE_ID`, `MINIMAX_FALLBACK_VOICE_ID=Cantonese_GentleLady`, `MINIMAX_MODEL=speech-2.8-hd`.
- Script: `scripts/tts-minimax.mjs` (banned-voice guard included).

---

## 4. OpenRouter (translation only)

| Item | Value |
| --- | --- |
| Auth | `Authorization: Bearer $OPENROUTER_API_KEY` |
| Endpoint | `POST https://openrouter.ai/api/v1/chat/completions` |
| Default model | `google/gemini-2.5-flash` (`OPENROUTER_MODEL`) |
| Role | EN → Traditional **HK 口語** text only (not TTS) |

**Box status (Day 1 harness build):** `OPENROUTER_API_KEY` is **present** in the agent box environment. TTS vendor keys are **not** present unless Darwin adds them to `.env`.

---

## Quick comparison

| | Canto-Gen | ElevenLabs v4 | MiniMax T2A |
| --- | --- | --- | --- |
| Cantonese-first | Yes | Via `yue` on v4 | Via `Chinese,Yue` + Cantonese_* |
| Clone min duration | ≥8 s | Short IVC (~10s+) | ≥10 s |
| Clone persistence | Per-request | Saved `voice_id` | Saved `voice_id` (~7d idle purge) |
| Text cap (harness) | 500 async | Large | &lt;10k |
| Auth style | Bearer | `xi-api-key` | Bearer (+ optional GroupId) |
| Mandarin trap | Low (Canto-native) | Possible if wrong model/lang | **High if HK Flight Attendant** |

---

# Day 2 — lip sync

## 5. Sync Labs (sync.so) — primary

Sources: https://sync.so/docs, https://sync.so/docs/openapi.json, /docs/free-trial, /docs/api-reference/api/generate-api/*.

| Item | Value |
| --- | --- |
| Base URL | `https://api.sync.so` |
| Auth | **`x-api-key: $SYNCLABS_API_KEY`** (docs/SDK name: `SYNC_API_KEY`; harness accepts either) |
| Models | `sync-3` (API default, 4K, ~US$0.133/s), `lipsync-2` (harness default, 512² face, ≈US$0.05/s), `lipsync-2-pro`, `lipsync-1.9.0-beta` (from ~US$0.02/s), `react-1` |
| Inputs | MP4 video + WAV/MP3 audio, via **direct multipart upload**, **public URL**, or **assetId** |
| Free tier | **3 lip-sync gens/month, ≤20 s each** (sync-3: 1 of the 3, ≤15 s). No card. **Watermarked output.** Doesn't roll over. |
| Paid | Hobbyist (no duration cap, still watermarked), Creator+ removes watermark. Harness assumes ~US$5 plan for the 72.5 s full run. |

### Upload: no public URL needed
1. **Multipart (harness default):** `POST /v2/generate` as `multipart/form-data` with file fields `video`, `audio`, plus `model`, and nested `options` as a **JSON string**. Files are saved as assets automatically. Parser up to 5 GiB/file, but plan and proxy limits are lower (`413` / `422 file_size_exceeds_plan_limit`).
2. **Assets (`--upload assets`):** `POST /v2/assets/upload {fileName,contentType,size}` → `{uploadUrl,url,expiresIn}` → `PUT uploadUrl` (same Content-Type) → `POST /v2/assets {url,type:"VIDEO"|"AUDIO"}` → `id` → `POST /v2/generate` JSON with `input:[{type:"video",assetId},{type:"audio",assetId}]`. Use this for large files and retries.
3. **URLs (`--video-url/--audio-url`):** JSON `POST /v2/generate {model, input:[{type:"video",url},{type:"audio",url}], options}`.

### Job lifecycle
- Create → `201 { id, status }`. Optional `Idempotency-Key` header for safe retries.
- Poll `GET /v2/generate/{id}` → `status` ∈ `PENDING|PROCESSING|COMPLETED|FAILED|REJECTED`; on success `outputUrl`, `outputDuration`; on failure `error`, `errorCode`.
- Download `outputUrl`, or `GET /v2/generations/{id}/download` → **text/plain** signed URL (fetch it **without** the API key). Free plans get the watermarked file.
- `webhookUrl` is supported. The harness polls instead, every 10 s with a 30 min timeout.
- Cost pre-check: `POST /v2/generations/estimate {model,duration,fps}` → `estimatedGenerationCost` (USD). The harness calls it before a paid submit, never in `--dry-run`.

### Options worth knowing
- `options.sync_mode`: `bounce` (API default) | `loop` | `cut_off` (harness default; pair is the same length) | `silence` | `remap`.
- `options.temperature` 0–1 (expressiveness, default 0.5), `active_speaker_detection`, `occlusion_detection_enabled`.

### Harness mapping
- Env `SYNCLABS_API_KEY` (or `SYNC_API_KEY`), optional `SYNCLABS_MODEL`, `SYNCLABS_USD_PER_SEC`, `SYNCLABS_PLAN_USD`.
- Script `scripts/lipsync-synclabs.mjs` (writes `<out>.json` with generation id, latency and estimate).

## 6. MuseTalk on Fal — fallback

Sources: https://fal.ai/models/fal-ai/musetalk/api, https://docs.fal.ai/model-apis/model-endpoints/queue, `@fal-ai/client` 1.10.1 storage source.

| Item | Value |
| --- | --- |
| Model id | `fal-ai/musetalk` |
| Auth | **`Authorization: Key $FAL_KEY`** |
| Input | `{ "source_video_url": "...", "audio_url": "..." }`, both required. Public URL or base64 **data URI**. |
| Output | `{ "video": { "url", "content_type", "file_name", "file_size" } }` (`fal.media` URLs expire, so download right away) |
| Submit | `POST https://queue.fal.run/fal-ai/musetalk` → `{request_id, status_url, response_url, cancel_url}` |
| Poll | `GET status_url` → `IN_QUEUE` / `IN_PROGRESS` / `COMPLETED` (`error`, `error_type` if failed; `metrics.inference_time`) |
| Result | `GET response_url` |
| Upload | `POST https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3 {content_type,file_name}` → `{upload_url,file_url}` → `PUT upload_url`. This is the same flow `fal.storage.upload` uses; >90 MB uses multipart, which the harness doesn't need. |
| Price | Billed per GPU compute-second. The model page shows no fixed per-video rate, so the harness uses a conservative **US$0.05/s of output** placeholder (`FAL_MUSETALK_USD_PER_SEC`). |
| Free tier | None specific to MuseTalk. Fal sometimes gives new accounts small credits. |
| Quality | Open-source, 256² face region, real-time. Weaker than lipsync-2 on mouth detail and teeth. Use it only if Sync is blocked. |

### Harness mapping
- Env `FAL_KEY`. Script `scripts/lipsync-musetalk.mjs`.

## Lip-sync caveat for clip_A
clip_A is an illustrated explainer with voice-over, not a talking head. The only face is a small cartoon character at ~0–6 s. Both vendors need a detectable face, so faceless frames are passed through or the job is rejected. Use a talking-head clip to actually judge lip-sync quality.

## 7. LatentSync on Fal — Day 2c comparison

Sources: live queue OpenAPI `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/latentsync`, model page https://fal.ai/models/fal-ai/latentsync (both read 2026-10-19).

| Item | Value |
| --- | --- |
| Model id | `fal-ai/latentsync` (ByteDance LatentSync, audio-conditioned latent diffusion) |
| Auth / upload / queue | Same as MuseTalk (§6): `Authorization: Key $FAL_KEY`, fal storage upload, `queue.fal.run` submit → poll → result |
| Input | `{ video_url, audio_url }` required; optional `guidance_scale` (1–2, default 1), `seed`, `loop_mode` (`pingpong`/`loop`, used when audio is longer than video), `enable_safety_checker` |
| Output | `{ video: File }` |
| Price | **US$0.20 flat per video ≤40 s**, then US$0.005 per output second |
| Script | `scripts/lipsync-latentsync.mjs` (wrapper) = `scripts/lipsync-musetalk.mjs --model latentsync`. `--max-usd` sets a per-run hard cap |
| Gotcha | **Needs a detectable face in every frame.** The clip_B 0–20 s pair (with faceless B-roll at 6.2–8.3 s and 14.4–16.5 s) came back `422 face_detection_error` after about 4.5 min (request `01a15468-e1da-7302-9eb9-252fc83cc0d9`). Fal FAQ: 422 input errors *may* be billed if GPU time was spent. Feed face-only spans (or split at cuts and lip-sync only the face shots), unlike Sync Labs, which passes faceless frames through |

`FAL_KEY` is read from `process.env` first, then `.env`. It is never printed.

### LatentSync face-only workflow (clip_B, Day 2c retry)
1. Join only the face shots. Cut at the exact scene-cut frames with a 3-frame safety trim at each side, both video (`select=between(n,…)`) and the matching dubbed-audio sample ranges.
2. `node scripts/lipsync-latentsync.mjs --video faceonly/video.mp4 --audio faceonly/audio.wav --out faceonly/latentsync_faceonly.mp4 --max-usd 0.5`
3. `python scripts/latentsync_faceonly_reassemble.py <pair_dir> faceonly/latentsync_faceonly.mp4 0-371,498-863,990-1199 <pair_dir>/latentsync.mp4` puts the faceless shots back from the original and muxes the dubbed audio.

Observed output: always **25 fps**; **truncated to a multiple of 16 frames** (15.8 s in → 15.36 s out, so the last ~0.44 s is unsynced); about **58 ms content lag** vs its own audio (it shows a pre-cut frame for ~3 source frames after hard cuts; the reassembler substitutes originals there). Billing came back in the result header `x-fal-billable-units: 40` (= US$0.20). Request `01a1546e-a721-7812-9c7f-db123be8f7ce`.
