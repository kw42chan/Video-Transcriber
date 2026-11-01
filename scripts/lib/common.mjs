import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '../..');

/** Load KEY=VALUE from .env without adding a dependency. Does not override existing process.env. */
export function loadDotEnv(file = path.join(ROOT, '.env')) {
  if (process.env.SAAS_MODE === '1') return;
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadDotEnv();

export function env(name, fallback = undefined) {
  // SaaS jobs use canonical credentials explicitly selected by the worker.
  // A legacy CLI alias must never revive platform billing for a BYOK stage.
  if (process.env.SAAS_MODE === '1' && ['CANTOGEN_API_KEY', 'SYNC_API_KEY'].includes(name)) return fallback;
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v;
}

export function requireEnv(name, aliases = []) {
  const names = [name, ...aliases];
  for (const n of names) {
    const v = env(n);
    if (v) return v;
  }
  throw new Error(
    `Missing required env: ${names.join(' or ')}. Copy .env.example → .env and fill keys. Do not invent keys.`
  );
}

export function hasEnv(name, aliases = []) {
  return Boolean(env(name) || aliases.some((a) => env(a)));
}

export const CLIPS_DIR = path.resolve(ROOT, env('CLIPS_DIR', 'clips'));
export const REFS_DIR = path.resolve(ROOT, env('REFS_DIR', 'refs'));
export const OUT_DIR = path.resolve(ROOT, env('OUT_DIR', 'out'));

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

export function listClipIds() {
  if (!fs.existsSync(CLIPS_DIR)) return [];
  return fs
    .readdirSync(CLIPS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => fs.existsSync(path.join(CLIPS_DIR, name, 'en.txt')))
    .sort();
}

export function clipPaths(clipId) {
  const dir = path.join(CLIPS_DIR, clipId);
  return {
    dir,
    en: path.join(dir, 'en.txt'),
    yue: path.join(dir, 'yue.txt'),
    video: path.join(dir, 'video.mp4'),
  };
}

export function readText(file) {
  return fs.readFileSync(file, 'utf8').trim();
}

export function writeText(file, text) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, text.endsWith('\n') ? text : text + '\n', 'utf8');
}

/** Resolve reference audio: refs/<clip-id>.* then refs/default.* */
export function resolveRefAudio(clipId) {
  const exts = ['.wav', '.mp3', '.m4a', '.webm', '.ogg', '.flac'];
  const candidates = [];
  if (clipId) {
    for (const ext of exts) candidates.push(path.join(REFS_DIR, `${clipId}${ext}`));
  }
  for (const ext of exts) candidates.push(path.join(REFS_DIR, `default${ext}`));
  if (fs.existsSync(REFS_DIR)) {
    const files = fs
      .readdirSync(REFS_DIR)
      .filter((f) => exts.includes(path.extname(f).toLowerCase()) && f !== 'README.md');
    if (files.length === 1) candidates.push(path.join(REFS_DIR, files[0]));
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export function mimeForAudio(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      '.wav': 'audio/wav',
      '.mp3': 'audio/mpeg',
      '.m4a': 'audio/mp4',
      '.mp4': 'audio/mp4',
      '.webm': 'audio/webm',
      '.ogg': 'audio/ogg',
      '.flac': 'audio/flac',
    }[ext] || 'application/octet-stream'
  );
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function charCount(text) {
  return [...text].length;
}

export async function timed(fn) {
  const t0 = Date.now();
  const result = await fn();
  return { result, latencyMs: Date.now() - t0 };
}

export function log(...args) {
  console.log(`[phase0]`, ...args);
}

export function warn(...args) {
  console.warn(`[phase0:warn]`, ...args);
}

/** Mandarin trap voice IDs — never send these to MiniMax. */
export const MINIMAX_BANNED_VOICES = new Set([
  'Chinese (Mandarin)_HK_Flight_Attendant',
  'Chinese(Mandarin)_HK_Flight_Attendant',
  'Mandarin_HK_Flight_Attendant',
  'Chinese_Mandarin_HK_Flight_Attendant',
]);

export function assertNotBannedMinimaxVoice(voiceId) {
  if (!voiceId) return;
  if (MINIMAX_BANNED_VOICES.has(voiceId) || /HK_Flight_Attendant/i.test(voiceId)) {
    throw new Error(
      `REFUSED: MiniMax voice "${voiceId}" is a Mandarin trap (HK Flight Attendant speaks Mandarin, not 粵語/口語). Use Cantonese_* voices or a clone with language_boost=Chinese,Yue.`
    );
  }
}
