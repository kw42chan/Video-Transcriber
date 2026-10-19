#!/usr/bin/env node
/**
 * Cut a ≤20s lip-sync test pair (video segment + matching dubbed-audio segment, same start time).
 * Video is re-encoded H.264 with audio stripped; audio is PCM WAV.
 *
 * Usage:
 *   node scripts/cut-lipsync-test.mjs [--clip clip_A] [--vendor canto-gen] [--start 0] [--duration 20]
 *        [--video inputs/clip_A.mp4] [--audio out/clip_A/canto-gen_yue.wav] [--out-dir out/clip_A/lipsync_test20]
 * Default window 0–20s: for clip_A it contains the only on-screen face (illustrated, ~0–6s).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, OUT_DIR, log, warn } from './lib/common.mjs';
import { parseArgs, resolvePath, rel, cutPair, probeDuration } from './lib/lipsync.mjs';

const a = parseArgs(process.argv.slice(2));
const clip = a.clip || 'clip_A';
const vendor = a.vendor || 'canto-gen';
const start = Number(a.start ?? 0);
const duration = Number(a.duration ?? 20);
if (duration > 20) warn(`duration ${duration}s > 20s: exceeds Sync Labs free tier`);
const video = resolvePath(a.video || path.join(ROOT, 'inputs', `${clip}.mp4`));
const audio = resolvePath(a.audio || path.join(OUT_DIR, clip, `${vendor}_yue.wav`));
const outDir = resolvePath(a.outDir || path.join(OUT_DIR, clip, `lipsync_test${duration}`));
for (const f of [video, audio]) if (!fs.existsSync(f)) { console.error(`missing ${f}`); process.exit(2); }

const r = cutPair({ video, audio, start, duration, outDir });
const vd = probeDuration(r.video);
const ad = probeDuration(r.audio);
fs.writeFileSync(path.join(outDir, 'pair.json'), JSON.stringify({ clip, vendor, src_video: rel(video), src_audio: rel(audio), start, duration, video_s: vd, audio_s: ad }, null, 2) + '\n');
log(`test pair ${start}–${start + duration}s → ${rel(r.video)} (${vd.toFixed(2)}s), ${rel(r.audio)} (${ad.toFixed(2)}s)`);
