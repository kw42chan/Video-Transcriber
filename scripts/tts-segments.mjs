#!/usr/bin/env node
/**
 * Per-segment TTS for one clip across vendors (for timeline alignment).
 * Usage: node scripts/tts-segments.mjs <clipDir> <refPath> [--vendors canto-gen,elevenlabs,minimax] [--keep-el-voice]
 * Writes <clipDir>/segments/<vendor>/seg_XX.mp3 and <clipDir>/tts_manifest_<vendor>.json
 * Never logs key values.
 */
import fs from 'node:fs';
import path from 'node:path';
import { charCount, ensureDir, log, warn, OUT_DIR } from './lib/common.mjs';
import { synthesizeCantoGen } from './tts-canto-gen.mjs';
import { synthesizeElevenLabs, deleteElevenLabsVoice } from './tts-elevenlabs.mjs';
import { synthesizeMinimax } from './tts-minimax.mjs';

const [clipDir, refPath] = process.argv.slice(2);
const vIdx = process.argv.indexOf('--vendors');
const vendors = vIdx > 0 ? process.argv[vIdx + 1].split(',') : ['canto-gen', 'elevenlabs', 'minimax'];
const keepEl = process.argv.includes('--keep-el-voice');
const clipId = path.basename(clipDir);
const yue = JSON.parse(fs.readFileSync(path.join(clipDir, 'yue_segments.json'), 'utf8')).segments;

// Published pricing (USD), checked 2026-10-18 — see report
const PRICE = {
  'canto-gen': { perChar: 0.97 / 1000 / 7.8, fixed: 0, note: 'Lite plan HK$0.97/1K chars (≈US$0.124/1K); free plan 5K chars/mo = US$0' },
  elevenlabs: { perChar: 0.08 / 1000, fixed: 0, note: 'eleven_v4 API US$0.08/1K chars; IVC creation free' },
  minimax: { perChar: 100 / 1e6, fixed: 1.5, note: 'speech-2.8-hd US$100/M chars + US$1.50 per cloned voice (on first use)' },
};
const totalChars = yue.reduce((a, s) => a + charCount(s.yue), 0);
let est = 0;
for (const v of vendors) est += totalChars * PRICE[v].perChar + PRICE[v].fixed;
log(`Pre-flight: ${yue.length} segments, ${totalChars} chars/vendor, est total US$${est.toFixed(3)} across ${vendors.join(',')}`);
if (est > 15) { console.error(`ABORT: estimate US$${est.toFixed(2)} > US$15 clip cap`); process.exit(2); }

const cacheDir = path.join(OUT_DIR, '_cache');
for (const f of ['elevenlabs-voice-id.txt', 'minimax-voice-id.txt']) {
  const p = path.join(cacheDir, f);
  if (fs.existsSync(p)) fs.unlinkSync(p); // fresh clone from this clip's ref
}

const runVendor = async (vendor) => {
  const dir = path.join(clipDir, 'segments', vendor);
  ensureDir(dir);
  const manifest = { vendor, clipId, refPath, startedAt: new Date().toISOString(), segments: [], flags: [], price: PRICE[vendor] };
  let voiceId = null;
  for (const s of yue) {
    const outPath = path.join(dir, `seg_${String(s.id).padStart(2, '0')}.mp3`);
    const rec = { id: s.id, chars: charCount(s.yue), outPath, ok: false };
    const t0 = Date.now();
    try {
      let meta;
      if (vendor === 'canto-gen') {
        meta = await synthesizeCantoGen({ text: s.yue, refPath, outPath });
      } else if (vendor === 'elevenlabs') {
        meta = await synthesizeElevenLabs({ text: s.yue, clipId, outPath, refPath });
      } else {
        try {
          meta = await synthesizeMinimax({ text: s.yue, clipId, outPath, refPath });
        } catch (e) {
          if (!process.env.MINIMAX_VOICE_ID && /upload|voice_clone/i.test(e.message)) {
            const msg = `MiniMax CLONE FAILED → fallback Cantonese_GentleLady (NOT CLONED): ${e.message.slice(0, 300)}`;
            warn(msg);
            manifest.flags.push(msg);
            process.env.MINIMAX_VOICE_ID = 'Cantonese_GentleLady';
            manifest.notCloned = true;
            meta = await synthesizeMinimax({ text: s.yue, clipId, outPath, refPath });
          } else throw e;
        }
      }
      Object.assign(rec, { ok: true, apiLatencyMs: meta.latencyMs, latencyMs: Date.now() - t0, wallMs: Date.now() - t0, voiceId: meta.voiceId, voiceSource: meta.voiceSource || meta.mode, usage_characters: meta.usage_characters ?? null, jobId: meta.jobId ?? null });
      voiceId = meta.voiceId || voiceId;
      log(`${vendor} seg${s.id} ok ${rec.wallMs}ms (${rec.chars} chars) via ${rec.voiceSource}`);
    } catch (e) {
      rec.error = String(e.message || e).slice(0, 600);
      rec.wallMs = Date.now() - t0;
      warn(`${vendor} seg${s.id} FAILED: ${rec.error.slice(0, 200)}`);
      if (/401|403|insufficient_scope|invalid_api_key|authentication|1004|1008|2049|2038|quota|402|character_limit|payment_required|paid_plan_required|insufficient balance/i.test(rec.error)) {
        manifest.segments.push(rec);
        manifest.flags.push(`Stopped ${vendor} after fatal error on seg${s.id}`);
        break;
      }
    }
    manifest.segments.push(rec);
  }
  if (vendor === 'elevenlabs' && voiceId && !keepEl && !process.env.ELEVENLABS_VOICE_ID) {
    try {
      const st = await deleteElevenLabsVoice(voiceId);
      manifest.elVoiceDeleted = { voiceId, httpStatus: st };
      log(`ElevenLabs IVC ${voiceId} delete → HTTP ${st}`);
    } catch (e) { manifest.flags.push(`EL voice delete failed: ${e.message}`); }
  }
  if (vendor === 'minimax') manifest.minimaxVoiceId = voiceId;
  if (vendor === 'elevenlabs' && process.env.EL_BASELINE_NOT_CLONED) { manifest.notCloned = true; manifest.flags.push(`NOT CLONED: premade voice ${process.env.ELEVENLABS_VOICE_ID} (IVC unavailable on plan)`); }
  manifest.finishedAt = new Date().toISOString();
  const okSegs = manifest.segments.filter((r) => r.ok);
  manifest.summary = {
    ok: okSegs.length, total: yue.length,
    chars: okSegs.reduce((a, r) => a + r.chars, 0),
    reportedUsageChars: okSegs.some((r) => r.usage_characters != null) ? okSegs.reduce((a, r) => a + (r.usage_characters || 0), 0) : null,
    sumLatencyMs: okSegs.reduce((a, r) => a + (r.latencyMs || 0), 0),
    meanLatencyMs: okSegs.length ? Math.round(okSegs.reduce((a, r) => a + (r.latencyMs || 0), 0) / okSegs.length) : null,
  };
  const billedChars = manifest.summary.reportedUsageChars ?? manifest.summary.chars;
  const cloneFee = vendor === 'minimax' && okSegs.length ? (manifest.notCloned ? 0 : PRICE.minimax.fixed) : 0;
  manifest.summary.estCostUsd = +(billedChars * PRICE[vendor].perChar + cloneFee).toFixed(4);
  fs.writeFileSync(path.join(clipDir, `tts_manifest_${vendor}.json`), JSON.stringify(manifest, null, 2));
  return manifest;
};

const results = await Promise.allSettled(vendors.map(runVendor));
for (const [i, r] of results.entries()) {
  if (r.status === 'fulfilled') log(`${vendors[i]}: ${JSON.stringify(r.value.summary)} flags=${r.value.flags.length}`);
  else warn(`${vendors[i]} crashed: ${r.reason?.message || r.reason}`);
}
