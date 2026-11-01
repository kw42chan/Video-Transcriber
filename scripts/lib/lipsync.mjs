/**
 * Shared helpers for Day 2 lip-sync clients (Sync Labs + Fal MuseTalk).
 * - CLI arg parsing (same shape for every vendor)
 * - ffmpeg trim / probe
 * - cost estimate + cumulative spend guard (out/spend.json)
 * Never prints key values — only "present"/"missing".
 */
import fs from 'node:fs';
import path from 'node:path';
import { mediaExecSync } from './media-sandbox.mjs';
import { ROOT, OUT_DIR, ensureDir, log } from './common.mjs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const SPEND_FILE = path.join(OUT_DIR, 'spend.json');
export const SPEND_CAP_USD = 20;
export const DAY1_SPEND_USD = 0.12;

/** Minimal --flag value / --bool parser. */
export function parseArgs(argv, booleans = []) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    let key = a.slice(2);
    let val;
    const eq = key.indexOf('=');
    if (eq >= 0) {
      val = key.slice(eq + 1);
      key = key.slice(0, eq);
    } else if (booleans.includes(key)) {
      val = true;
    } else {
      val = argv[i + 1];
      if (val === undefined || val.startsWith('--')) throw new Error(`--${key} needs a value`);
      i++;
    }
    out[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = val;
  }
  return out;
}

export function resolvePath(p) {
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

export function rel(p) {
  return path.relative(ROOT, p) || '.';
}

export function probeDuration(file) {
  const s = mediaExecSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
    path.dirname(path.resolve(file))
  ).trim();
  const d = Number(s);
  if (!Number.isFinite(d)) throw new Error(`ffprobe: no duration for ${file}`);
  return d;
}

export function probeVideo(file) {
  const s = mediaExecSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'json', file],
    path.dirname(path.resolve(file))
  );
  const st = JSON.parse(s).streams?.[0] || {};
  const [n, d] = String(st.r_frame_rate || '30/1').split('/').map(Number);
  return { width: st.width, height: st.height, fps: d ? n / d : 30 };
}

/**
 * Cut a matched pair from the same start time.
 * Video: re-encoded H.264 (frame-accurate), audio track stripped (lip-sync vendors take audio separately).
 * Audio: PCM WAV, same start/duration.
 */
export function cutPair({ video, audio, start = 0, duration, outDir }) {
  ensureDir(outDir);
  const vOut = path.join(outDir, 'video.mp4');
  const aOut = path.join(outDir, 'audio.wav');
  const t = ['-ss', String(start), ...(duration ? ['-t', String(duration)] : [])];
  mediaExecSync('ffmpeg', ['-v', 'error', '-y', ...t, '-i', video, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', vOut], path.dirname(path.resolve(video)));
  mediaExecSync('ffmpeg', ['-v', 'error', '-y', ...t, '-i', audio, '-vn', '-c:a', 'pcm_s16le', aOut], path.dirname(path.resolve(audio)));
  return { video: vOut, audio: aOut };
}

/** If --start/--duration given, trim into a scratch dir next to --out; else return inputs. */
export function maybeTrim({ video, audio, start, duration, out }) {
  if (start === undefined && duration === undefined) return { video, audio, trimmed: false };
  const dir = path.join(path.dirname(out), `_trim_${Number(start || 0)}_${duration ?? 'end'}`);
  return { ...cutPair({ video, audio, start: Number(start || 0), duration: duration && Number(duration), outDir: dir }), trimmed: true, dir };
}

export function readSpend() {
  if (!fs.existsSync(SPEND_FILE)) {
    return {
      cap_usd: SPEND_CAP_USD,
      total_usd: DAY1_SPEND_USD,
      plans: {},
      entries: [
        { ts: '2026-10-18', vendor: 'day1-tts', note: 'Day 1 TTS A/B (Canto-Gen + trials), approx', usd: DAY1_SPEND_USD },
      ],
    };
  }
  return JSON.parse(fs.readFileSync(SPEND_FILE, 'utf8'));
}

export function writeSpend(s) {
  ensureDir(path.dirname(SPEND_FILE));
  fs.writeFileSync(SPEND_FILE, JSON.stringify(s, null, 2) + '\n');
}

export function recordSpend(entry) {
  const s = readSpend();
  s.entries.push({ ts: new Date().toISOString(), ...entry });
  s.total_usd = Math.round((s.total_usd + (entry.usd || 0)) * 10000) / 10000;
  if (entry.plan) s.plans[entry.plan] = true;
  writeSpend(s);
  return s;
}

/** Print estimate + cap verdict. Returns { ok, projected }. */
export function checkBudget(estimateUsd, label) {
  const s = readSpend();
  const cap = s.cap_usd ?? SPEND_CAP_USD;
  const projected = Math.round((s.total_usd + estimateUsd) * 10000) / 10000;
  const ok = projected <= cap;
  log(`cost estimate (${label}): US$${estimateUsd.toFixed(2)}`);
  log(`cumulative spend: US$${s.total_usd.toFixed(2)} → projected US$${projected.toFixed(2)} / cap US$${cap.toFixed(2)} (${rel(SPEND_FILE)}${fs.existsSync(SPEND_FILE) ? '' : ', not yet created'})`);
  log(ok ? 'budget: OK' : 'budget: REFUSED — would exceed cap');
  return { ok, projected, spend: s };
}

/** Redacted header view for dry-run printing. */
export function redactHeaders(h) {
  const out = {};
  for (const [k, v] of Object.entries(h)) {
    out[k] = /key|auth/i.test(k) ? '<redacted>' : v;
  }
  return out;
}

export async function downloadTo(url, file) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`download ${res.status} ${url.split('?')[0]}`);
  if (!res.body) throw new Error('Provider returned no media');
  const maxBytes = 500 * 1024 ** 2;
  if (Number(res.headers.get('content-length')) > maxBytes) throw new Error('Provider media exceeds size limit');
  ensureDir(path.dirname(file));
  let bytes = 0;
  await pipeline(Readable.fromWeb(res.body), new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    callback(bytes > maxBytes ? new Error('Provider media exceeds size limit') : null, chunk);
  } }), fs.createWriteStream(file));
  return file;
}

export function mimeFor(file) {
  const ext = path.extname(file).toLowerCase();
  return (
    { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4' }[ext] ||
    'application/octet-stream'
  );
}

export function fileSizeMB(f) {
  return (fs.statSync(f).size / 1024 / 1024).toFixed(2);
}
