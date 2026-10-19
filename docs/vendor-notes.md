# Vendor API notes (verified 2026-10-18)

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

## 2. ElevenLabs — `https://api.elevenlabs.io`

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

## 3. MiniMax Speech T2A — `https://api.minimax.io`

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
