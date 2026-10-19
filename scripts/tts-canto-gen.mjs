#!/usr/bin/env node
/**
 * Canto-Gen (港嘢) clone+TTS.
 * Docs: https://canto-gen.com/v1/docs/en
 * - Auth: Authorization: Bearer $CANTO_GEN_API_KEY (alias CANTOGEN_API_KEY)
 * - Clone needs tts:clone scope; reference ≥8s; text ≤500 (async jobs)
 * - POST /v1/audio/jobs → poll GET /v1/audio/jobs/{id} → download audio_url
 *
 * Usage:
 *   node scripts/tts-canto-gen.mjs <clip-id> [--out path]
 *   node scripts/tts-canto-gen.mjs --all
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  requireEnv,
  env,
  listClipIds,
  clipPaths,
  readText,
  resolveRefAudio,
  mimeForAudio,
  ensureDir,
  sleep,
  charCount,
  timed,
  log,
  warn,
  OUT_DIR,
} from './lib/common.mjs';

const BASE = 'https://canto-gen.com';
const TEXT_CAP = 500;

function apiKey() {
  return requireEnv('CANTO_GEN_API_KEY', ['CANTOGEN_API_KEY']);
}

async function pollJob(jobId, key, maxAttempts = 90) {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`${BASE}/v1/audio/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const job = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Canto-Gen poll ${res.status}: ${JSON.stringify(job).slice(0, 400)}`);
    }
    if (job.status === 'completed') return job;
    if (job.status === 'failed' || job.status === 'cancelled') {
      throw new Error(`Canto-Gen job ${job.status}: ${JSON.stringify(job).slice(0, 400)}`);
    }
    await sleep(Math.min(2000 + i * 400, 5000));
  }
  throw new Error('Canto-Gen poll timeout');
}

export async function synthesizeCantoGen({ text, refPath, outPath, voiceSlug }) {
  const key = apiKey();
  const n = charCount(text);
  if (n > TEXT_CAP) {
    throw new Error(`Canto-Gen text_too_long: ${n} > ${TEXT_CAP} characters`);
  }
  if (n < 1) throw new Error('Canto-Gen: empty text');

  const body = {
    model: 'cantogen-tts',
    text,
    response_format: 'mp3',
  };

  if (refPath) {
    const buf = fs.readFileSync(refPath);
    const b64 = buf.toString('base64');
    const mime = mimeForAudio(refPath);
    body.clone = {
      reference_audio: `data:${mime};base64,${b64}`,
    };
  } else {
    body.voice = voiceSlug || env('CANTO_GEN_VOICE', 'sum');
    warn(`No ref audio — using gallery voice "${body.voice}" (clone skipped)`);
  }

  const { result: submit, latencyMs: submitMs } = await timed(async () => {
    const res = await fetch(`${BASE}/v1/audio/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (res.status !== 202 && res.status !== 200) {
      throw new Error(`Canto-Gen submit ${res.status}: ${JSON.stringify(json).slice(0, 600)}`);
    }
    return json;
  });

  let job = submit;
  if (submit.job_id && submit.status !== 'completed') {
    log(`Canto-Gen job ${submit.job_id} queued; polling…`);
    job = await pollJob(submit.job_id, key);
  }
  if (!job.audio_url) {
    throw new Error(`Canto-Gen missing audio_url: ${JSON.stringify(job).slice(0, 400)}`);
  }

  const { latencyMs: dlMs } = await timed(async () => {
    const audioRes = await fetch(job.audio_url);
    if (!audioRes.ok) throw new Error(`Canto-Gen download ${audioRes.status}`);
    const ab = Buffer.from(await audioRes.arrayBuffer());
    ensureDir(path.dirname(outPath));
    fs.writeFileSync(outPath, ab);
  });

  return {
    vendor: 'canto-gen',
    outPath,
    chars: n,
    latencyMs: submitMs + dlMs,
    jobId: job.job_id || submit.job_id,
    mode: refPath ? 'clone' : 'gallery',
  };
}

async function runOne(clipId, outOverride) {
  const { yue } = clipPaths(clipId);
  if (!fs.existsSync(yue)) {
    throw new Error(`${clipId}: missing yue.txt — run translate-to-hk-kouyu.mjs first`);
  }
  const text = readText(yue);
  const ref = resolveRefAudio(clipId);
  const outPath =
    outOverride || path.join(OUT_DIR, clipId, 'canto-gen.mp3');
  log(`${clipId}: canto-gen TTS (${charCount(text)} chars, ref=${ref || 'none'})`);
  const meta = await synthesizeCantoGen({ text, refPath: ref, outPath });
  log(`${clipId}: wrote ${outPath} (${meta.latencyMs} ms)`);
  return meta;
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const outIdx = args.indexOf('--out');
  const outOverride = outIdx >= 0 ? args[outIdx + 1] : null;
  const ids = all
    ? listClipIds()
    : args.filter((a) => a !== '--all' && a !== '--out' && a !== outOverride);
  if (!ids.length) {
    console.error('Usage: node scripts/tts-canto-gen.mjs <clip-id> | --all');
    process.exit(1);
  }
  const results = [];
  for (const id of ids) {
    results.push(await runOne(id, ids.length === 1 ? outOverride : null));
  }
  console.log(JSON.stringify(results, null, 2));
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
