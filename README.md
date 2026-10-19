# Phase 0 Day 1 — Offline TTS A/B (EN → HK 口語 voice clone)

**Scope:** offline harness only. **No lip sync. No product UI.**

Path: `/workspace/phase0-cantonese-tts/`

Goal: once Darwin drops **3 clips + voice refs + API keys**, one command runs EN→口語 translation and three Cantonese-capable TTS vendors, then writes audio samples + a human scorecard.

## Box status

| Secret | Status on this box |
| --- | --- |
| `OPENROUTER_API_KEY` | **Present** (injected) — translation can run |
| `CANTO_GEN_API_KEY` / `CANTOGEN_API_KEY` | Not set — add to `.env` |
| `ELEVENLABS_API_KEY` | Not set — add to `.env` |
| `MINIMAX_API_KEY` / `MINIMAX_GROUP_ID` | Not set — add to `.env` |

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

## Vendor quick links

| Vendor | Docs | Notes file |
| --- | --- | --- |
| Canto-Gen | https://canto-gen.com/v1/docs/en | `docs/vendor-notes.md` §1 |
| ElevenLabs v4 | https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4 | §2 |
| MiniMax T2A | https://platform.minimax.io/docs/api-reference/speech-t2a-http | §3 |
| MiniMax clone | https://platform.minimax.io/docs/api-reference/voice-cloning-clone | §3 |

## Success definition

Harness ready: after Darwin adds 3× `clips/*/en.txt`, `refs/default.wav` (8–15s), and vendor keys in `.env`, running:

```bash
node scripts/run-ab.mjs
```

produces `out/<clip-id>/*.mp3` for every keyed vendor and a filled latency/`chars` scorecard with blank human score columns.
