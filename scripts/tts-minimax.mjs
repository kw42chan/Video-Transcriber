#!/usr/bin/env node
/**
 * MiniMax Speech T2A with language_boost Chinese,Yue + Cantonese_* / clone.
 * Docs:
 *   https://platform.minimax.io/docs/api-reference/speech-t2a-http
 *   https://platform.minimax.io/docs/api-reference/voice-cloning-clone
 *   Upload: POST /v1/files/upload purpose=voice_clone
 *
 * NEVER use Chinese (Mandarin)_HK_Flight_Attendant — Mandarin trap.
 *
 * Usage:
 *   node scripts/tts-minimax.mjs <clip-id> [--out path]
 *   node scripts/tts-minimax.mjs --all
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
  ensureDir,
  charCount,
  timed,
  log,
  warn,
  OUT_DIR,
  assertNotBannedMinimaxVoice,
} from './lib/common.mjs';

const BASE = 'https://api.minimax.io';
const CACHE_FILE = path.join(OUT_DIR, '_cache', 'minimax-voice-id.txt');

function apiKey() {
  return requireEnv('MINIMAX_API_KEY');
}

function authHeaders(json = true) {
  const headers = { Authorization: `Bearer ${apiKey()}` };
  const groupId = env('MINIMAX_GROUP_ID');
  if (groupId) headers.GroupId = groupId;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

async function uploadCloneAudio(refPath) {
  const form = new FormData();
  form.append('purpose', 'voice_clone');
  form.append(
    'file',
    new Blob([fs.readFileSync(refPath)], { type: 'application/octet-stream' }),
    path.basename(refPath)
  );
  const res = await fetch(`${BASE}/v1/files/upload`, {
    method: 'POST',
    headers: authHeaders(false),
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.base_resp?.status_code) {
    const code = json?.base_resp?.status_code;
    if (code && code !== 0) {
      throw new Error(`MiniMax upload failed: ${JSON.stringify(json).slice(0, 600)}`);
    }
    if (!res.ok) {
      throw new Error(`MiniMax upload HTTP ${res.status}: ${JSON.stringify(json).slice(0, 600)}`);
    }
  }
  const fileId = json?.file?.file_id;
  if (!fileId) {
    throw new Error(`MiniMax upload missing file_id: ${JSON.stringify(json).slice(0, 400)}`);
  }
  return fileId;
}

async function cloneVoice(fileId, voiceId) {
  assertNotBannedMinimaxVoice(voiceId);
  const model = env('MINIMAX_MODEL', 'speech-2.8-hd');
  const body = {
    file_id: fileId,
    voice_id: voiceId,
    language_boost: 'Chinese,Yue',
    model,
    need_noise_reduction: false,
    need_volume_normalization: false,
  };
  const res = await fetch(`${BASE}/v1/voice_clone`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json?.base_resp && json.base_resp.status_code !== 0)) {
    throw new Error(`MiniMax voice_clone failed: ${JSON.stringify(json).slice(0, 600)}`);
  }
  ensureDir(path.dirname(CACHE_FILE));
  fs.writeFileSync(CACHE_FILE, voiceId + '\n', 'utf8');
  log(`MiniMax clone ready voice_id=${voiceId}`);
  return voiceId;
}

async function resolveVoiceId(clipId, refOverride) {
  const fromEnv = env('MINIMAX_VOICE_ID');
  if (fromEnv) {
    assertNotBannedMinimaxVoice(fromEnv);
    return { voiceId: fromEnv, source: 'env' };
  }
  if (fs.existsSync(CACHE_FILE)) {
    const cached = fs.readFileSync(CACHE_FILE, 'utf8').trim();
    if (cached) {
      assertNotBannedMinimaxVoice(cached);
      return { voiceId: cached, source: 'cache' };
    }
  }
  const ref = refOverride || resolveRefAudio(clipId);
  if (ref) {
    // MiniMax requires ≥10s; we still try — API will reject if too short
    const voiceId = `Phase0Canto${Date.now().toString(36)}`.slice(0, 32);
    assertNotBannedMinimaxVoice(voiceId);
    log(`MiniMax: uploading ref ${ref} for clone…`);
    const fileId = await uploadCloneAudio(ref);
    await cloneVoice(fileId, voiceId);
    return { voiceId, source: 'clone', ref };
  }
  const fallback = env('MINIMAX_FALLBACK_VOICE_ID', 'Cantonese_GentleLady');
  assertNotBannedMinimaxVoice(fallback);
  if (!/^Cantonese_/i.test(fallback) && !fallback.startsWith('Phase0')) {
    warn(
      `MiniMax fallback voice "${fallback}" does not look like Cantonese_*; ensure language_boost=Chinese,Yue`
    );
  }
  warn(`No MiniMax clone ref — using system voice ${fallback}`);
  return { voiceId: fallback, source: 'system' };
}

export async function synthesizeMinimax({ text, clipId, outPath, refPath }) {
  const model = env('MINIMAX_MODEL', 'speech-2.8-hd');
  const { voiceId, source } = await resolveVoiceId(clipId, refPath);
  assertNotBannedMinimaxVoice(voiceId);
  const n = charCount(text);
  if (n < 1) throw new Error('MiniMax: empty text');

  const body = {
    model,
    text,
    stream: false,
    language_boost: 'Chinese,Yue',
    output_format: 'hex',
    voice_setting: {
      voice_id: voiceId,
      speed: 1,
      vol: 1,
      pitch: 0,
    },
    audio_setting: {
      sample_rate: 32000,
      bitrate: 128000,
      format: 'mp3',
      channel: 1,
    },
  };

  const { result: json, latencyMs } = await timed(async () => {
    const res = await fetch(`${BASE}/v1/t2a_v2`, {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || (data?.base_resp && data.base_resp.status_code !== 0)) {
      throw new Error(`MiniMax T2A failed: ${JSON.stringify(data).slice(0, 600)}`);
    }
    return data;
  });

  const hex = json?.data?.audio;
  if (!hex) {
    throw new Error(`MiniMax T2A missing data.audio: ${JSON.stringify(json).slice(0, 400)}`);
  }
  const audio = Buffer.from(hex, 'hex');
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, audio);

  return {
    vendor: 'minimax',
    outPath,
    chars: n,
    latencyMs,
    voiceId,
    voiceSource: source,
    model,
    language_boost: 'Chinese,Yue',
    usage_characters: json?.extra_info?.usage_characters,
  };
}

async function runOne(clipId, outOverride) {
  const { yue } = clipPaths(clipId);
  if (!fs.existsSync(yue)) {
    throw new Error(`${clipId}: missing yue.txt — run translate-to-hk-kouyu.mjs first`);
  }
  const text = readText(yue);
  const outPath = outOverride || path.join(OUT_DIR, clipId, 'minimax.mp3');
  log(`${clipId}: minimax TTS (${charCount(text)} chars)`);
  const meta = await synthesizeMinimax({ text, clipId, outPath });
  log(`${clipId}: wrote ${outPath} (${meta.latencyMs} ms, voice=${meta.voiceId})`);
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
    console.error('Usage: node scripts/tts-minimax.mjs <clip-id> | --all');
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
