# Phase 0 — EN → HK 口語 Cantonese video dubbing spike

> **Day 1 result:** Canto-Gen won the TTS A/B. **ElevenLabs and MiniMax are dropped** from the pipeline — their scripts (`tts-elevenlabs.mjs`, `tts-minimax.mjs`) stay in the repo for reference only; don't put keys in for them.
>
> **Day 2:** lip sync — see [Day 2 — lip sync](#day-2--lip-sync) below.

## Day 1 — Offline TTS A/B (EN → HK 口語 voice clone)

**Scope:** offline harness only. **No lip sync. No product UI.**

Path: `/workspace/phase0-cantonese-tts/`

Goal: once Darwin drops **3 clips + voice refs + API keys**, one command runs EN→口語 translation and three Cantonese-capable TTS vendors, then writes audio samples + a human scorecard.

## Box status

| Secret | Status on this box |
| --- | --- |
| `OPENROUTER_API_KEY` | **Present** (injected) — translation can run |
| `CANTO_GEN_API_KEY` / `CANTOGEN_API_KEY` | Not set — add to `.env` |
| `ELEVENLABS_API_KEY` | Dropped after Day 1 — not needed |
| `MINIMAX_API_KEY` / `MINIMAX_GROUP_ID` | Dropped after Day 1 — not needed |
| `SYNCLABS_API_KEY` (Day 2) | Not set — add to `.env` |
| `FAL_KEY` (Day 2, fallback) | Not set — optional |

Do **not** invent keys. Paid TTS APIs are only called when the corresponding key is present; missing vendors are skipped and noted in the scorecard.

## Layout

```
phase0-cantonese-tts/
  README.md
  .env.example          → copy to .env
  docs/vendor-notes.md  → auth / clone / TTS shapes (verified)
  clips/<clip-id>/en.txt (+ optional video.mp4, yue.txt)
  refs/default.wav      (≥8–15 s clean speaker sample)
  out/<clip-id>/{canto-gen,elevenlabs,minimax}.mp3
  out/scorecard.md
  scripts/
    translate-to-hk-kouyu.mjs
    tts-canto-gen.mjs
    tts-elevenlabs.mjs
    tts-minimax.mjs
    run-ab.mjs
    lib/common.mjs
```

Requires **Node ≥20** (box has v20). No npm install required (native `fetch` / `FormData`).

## Day 1 steps

1. **Copy env**
   ```bash
   cd /workspace/phase0-cantonese-tts
   cp .env.example .env
   # fill CANTO_GEN_API_KEY, ELEVENLABS_API_KEY, MINIMAX_API_KEY (+ GROUP_ID if needed)
   # OPENROUTER_API_KEY may already be in the process env; still fine to paste into .env
   ```

2. **Drop assets**
   - `clips/clip-01/en.txt`, `clips/clip-02/en.txt`, `clips/clip-03/en.txt` (English transcripts)
   - Optional: `clips/clip-0N/video.mp4`
   - `refs/default.wav` (or `.mp3`) — **≥8 s** for Canto-Gen clone, **≥10 s** for MiniMax clone; 8–15 s clean speech is the Day 1 target

3. **Canto-Gen key scopes**  
   Create a key with **`tts:generate` + `tts:clone`**. Without `tts:clone`, clone jobs return `403 insufficient_scope`.

4. **Run A/B (one command)**
   ```bash
   cd /workspace/phase0-cantonese-tts
   node scripts/run-ab.mjs
   ```

5. **Listen & score**  
   Open `out/scorecard.md`, play `out/<clip-id>/*.mp3`, fill blank human columns.

### Useful one-offs

```bash
node scripts/translate-to-hk-kouyu.mjs              # all clips
node scripts/translate-to-hk-kouyu.mjs clip-01 --force
node scripts/tts-canto-gen.mjs clip-01
node scripts/tts-elevenlabs.mjs --all
node scripts/tts-minimax.mjs clip-01
node scripts/run-ab.mjs --skip-translate
node scripts/run-ab.mjs --vendors canto-gen,minimax
```

## Scorecard dimensions

| Dimension | Meaning |
| --- | --- |
| **Voice similarity** | Does the clone sound like the EN reference speaker? |
| **口語 naturalness** | Real HK spoken Cantonese — particles, rhythm, not 書面語 / not Mandarin |
| **Latency / cost** | Wall-clock filled by harness; cost from your plan / headers |
| **API ease** | Auth friction, clone UX, docs, error clarity |

## PASS criteria (Day 1)

- [ ] ≥1 vendor produces listenably natural **HK 口語** (not Mandarin, not stiff written Chinese).
- [ ] Best vendor clone **similarity ≥ 3/5** on ≥2 of 3 clips (same speaker refs).
- [ ] **No Mandarin-trap voice** used — especially MiniMax `Chinese (Mandarin)_HK_Flight_Attendant`.
- [ ] Harness is end-to-end offline: translate → TTS×3 → `out/` audio + scorecard.
- [ ] Latency recorded. Lip sync / product UI explicitly **out of scope** for Day 1 PASS.

## Mandarin traps to avoid

1. **MiniMax `Chinese (Mandarin)_HK_Flight_Attendant`**  
   Name contains “HK” but it is a **Mandarin** system voice. Harness **refuses** any `*HK_Flight_Attendant*` id. Use `Cantonese_GentleLady` / `Cantonese_podacast_host_1` or a clone with `language_boost: "Chinese,Yue"`.

2. **`language_boost: "Chinese"` alone on MiniMax**  
   Boosts Mandarin recognition. Always use **`Chinese,Yue`** for this A/B.

3. **ElevenLabs without `language_code: "yue"` / wrong model**  
   Use **`eleven_v4`** (or turbo) + **`language_code: "yue"`**. `eleven_multilingual_v2` ignores `language_code`.

4. **Translation drift to 書面語 / 普通話**  
   `translate-to-hk-kouyu.mjs` prompts for Traditional **口語** (係／唔係／嘅／咗／啦…). Spot-check `yue.txt` before scoring TTS — bad text makes every vendor sound wrong.

5. **EN reference → Cantonese accent expectations (Eleven v4)**  
   v4 may produce fluent target-language speech rather than carrying the EN accent into Yue. Score similarity vs naturalness separately.

6. **Canto-Gen text &gt; 500 chars**  
   Async jobs reject over-limit (`text_too_long`). Keep each clip’s `yue.txt` ≤500 characters or split.

## Day 2 — lip sync

Primary: **Sync Labs** (`lipsync-2`, `scripts/lipsync-synclabs.mjs`). Fallback: **MuseTalk on Fal** (`scripts/lipsync-musetalk.mjs`). Both are plain Node 20 `fetch` — no npm install. API details: `docs/vendor-notes.md` §5–6.

**Env (`.env`, chmod 600):** `SYNCLABS_API_KEY` (alias `SYNC_API_KEY`), `FAL_KEY`. Placeholders are in `.env.example`.

> ⚠️ **clip_A is a poor lip-sync subject:** it is an illustrated explainer with voice-over. The only face is a small illustrated character at ~0–6 s; the rest is faceless (corridor figure, diagrams, feet). Expect Sync Labs to pass most frames through unchanged or reject the job. A real talking-head clip is needed to judge lip-sync quality — the 20 s test on clip_A mainly proves the pipeline end to end.

### 1. Cut a ≤20 s test pair (already done for clip_A)

```bash
node scripts/cut-lipsync-test.mjs --clip clip_A --vendor canto-gen --start 0 --duration 20
# → out/clip_A/lipsync_test20/{video.mp4 (no audio), audio.wav, pair.json}
```

### 2. Free-tier 20 s test (Sync Labs, US$0)

```bash
node scripts/lipsync-synclabs.mjs --video out/clip_A/lipsync_test20/video.mp4 \
  --audio out/clip_A/lipsync_test20/audio.wav \
  --out out/clip_A/lipsync_test20/synclabs_lipsync-2.mp4 --free-tier --dry-run   # drop --dry-run to submit
```

### 3. Full run (72.5 s, needs the ~US$5 Sync plan)

```bash
node scripts/lipsync-synclabs.mjs --video inputs/clip_A.mp4 --audio out/clip_A/canto-gen_yue.wav \
  --out out/clip_A/clip_A_yue_canto-gen_lipsync-2.mp4 --dry-run                   # drop --dry-run to submit
```

Fallback (Fal MuseTalk) uses the same flags:

```bash
node scripts/lipsync-musetalk.mjs --video out/clip_A/lipsync_test20/video.mp4 \
  --audio out/clip_A/lipsync_test20/audio.wav --out out/clip_A/lipsync_test20/musetalk.mp4 --dry-run
```

### Flags (both scripts)

| Flag | Meaning |
| --- | --- |
| `--video` / `--audio` | Local inputs (uploaded by the script) |
| `--out` | Output mp4 (a `.json` with job id / latency / estimate goes next to it) |
| `--start` / `--duration` | Trim both inputs from the same start time before upload |
| `--video-url` / `--audio-url` | Use public URLs instead of uploading (pass `--duration` so cost can be estimated) |
| `--dry-run` | Print estimate + planned request; **no key needed, no network, no spend** |
| `--model` (Sync) | `lipsync-2` (default), `lipsync-2-pro`, `sync-3`, `lipsync-1.9.0-beta`, `react-1` |
| `--sync-mode` (Sync) | `cut_off` (default), `bounce`, `loop`, `silence`, `remap` |
| `--upload` | Sync: `multipart` (default, direct file upload) / `assets` (presigned upload → assetId). Fal: `storage` (default, Fal CDN) / `datauri` |
| `--free-tier` (Sync) | Account is on the free plan: requires ≤20 s (≤15 s sync-3), counted as US$0 |

### Spend guard

Every run prints a cost estimate first (Sync ≈ US$0.05/s + US$5 plan the first time a paid run happens; Fal placeholder US$0.05/s). Both scripts **refuse to submit** if the estimate would push cumulative spend in `out/spend.json` over **US$20** (cap is `cap_usd` in that file; seeded with Day 1 ≈ US$0.12). Each submission is appended to `out/spend.json`. Before a paid Sync submit, the script also asks Sync's free estimate endpoint and uses the higher number.

## Vendor quick links

| Vendor | Docs | Notes file |
| --- | --- | --- |
| Canto-Gen | https://canto-gen.com/v1/docs/en | `docs/vendor-notes.md` §1 |
| ElevenLabs v4 | https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4 | §2 |
| MiniMax T2A | https://platform.minimax.io/docs/api-reference/speech-t2a-http | §3 |
| MiniMax clone | https://platform.minimax.io/docs/api-reference/voice-cloning-clone | §3 |
| Sync Labs (lip sync) | https://sync.so/docs | §5 |
| Fal MuseTalk (lip sync fallback) | https://fal.ai/models/fal-ai/musetalk/api | §6 |

## Success definition

Harness ready: after Darwin adds 3× `clips/*/en.txt`, `refs/default.wav` (8–15s), and vendor keys in `.env`, running:

```bash
node scripts/run-ab.mjs
```

produces `out/<clip-id>/*.mp3` for every keyed vendor and a filled latency/`chars` scorecard with blank human score columns.
