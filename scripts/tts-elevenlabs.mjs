#!/usr/bin/env node
/**
 * ElevenLabs v4 TTS + Cantonese (language_code: yue) + Instant Voice Clone.
 * Docs:
 *   https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4
 *   POST /v1/voices/add (IVC) — xi-api-key
 *   POST /v1/text-to-speech/{voice_id} — model eleven_v4, language_code yue
 *
 * Usage:
 *   node scripts/tts-elevenlabs.mjs <clip-id> [--out path]
 *   node scripts/tts-elevenlabs.mjs --all
 *
 * Env: ELEVENLABS_API_KEY; optional ELEVENLABS_VOICE_ID to skip IVC.
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
  ROOT,
} from './lib/common.mjs';

const BASE = 'https://api.elevenlabs.io';
const CACHE_FILE = path.join(OUT_DIR, '_cache', 'elevenlabs-voice-id.txt');

function apiKey() {
  return requireEnv('ELEVENLABS_API_KEY');
}

async function createIvc(refPath, name) {
  const key = apiKey();
  const form = new FormData();
  form.append('name', name);
  const blob = new Blob([fs.readFileSync(refPath)], {
    type: 'application/octet-stream',
  });
  form.append('files', blob, path.basename(refPath));
  form.append('description', 'phase0-cantonese-tts Day1 IVC');
  form.append('labels', JSON.stringify({ language: 'yue', project: 'phase0' }));

  const res = await fetch(`${BASE}/v1/voices/add`, {
    method: 'POST',
    headers: { 'xi-api-key': key },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`ElevenLabs IVC ${res.status}: ${JSON.stringify(json).slice(0, 600)}`);
  }
  if (!json.voice_id) {
    throw new Error(`ElevenLabs IVC missing voice_id: ${JSON.stringify(json).slice(0, 400)}`);
  }
  ensureDir(path.dirname(CACHE_FILE));
  fs.writeFileSync(CACHE_FILE, json.voice_id + '\n', 'utf8');
  log(`ElevenLabs IVC created voice_id=${json.voice_id}`);
  return json.voice_id;
}

export async function deleteElevenLabsVoice(voiceId) {
  const res = await fetch(`${BASE}/v1/voices/${encodeURIComponent(voiceId)}`, {
    method: 'DELETE',
    headers: { 'xi-api-key': apiKey() },
  });
  if (fs.existsSync(CACHE_FILE) && fs.readFileSync(CACHE_FILE, 'utf8').trim() === voiceId) fs.unlinkSync(CACHE_FILE);
  return res.status;
}

async function resolveVoiceId(clipId, refOverride) {
  const existing = env('ELEVENLABS_VOICE_ID');
  if (existing) return { voiceId: existing, source: 'env' };
  if (fs.existsSync(CACHE_FILE)) {
    const cached = fs.readFileSync(CACHE_FILE, 'utf8').trim();
    if (cached) return { voiceId: cached, source: 'cache' };
  }
  const ref = refOverride || resolveRefAudio(clipId);
  if (!ref) {
    throw new Error(
      'ElevenLabs: need ELEVENLABS_VOICE_ID or a refs/ audio (≥~10s) for Instant Voice Clone'
    );
  }
  const voiceId = await createIvc(ref, `phase0-${clipId || 'default'}-${Date.now()}`);
  return { voiceId, source: 'ivc', ref };
}

export async function synthesizeElevenLabs({ text, clipId, outPath, refPath }) {
  const key = apiKey();
  const model = env('ELEVENLABS_MODEL', 'eleven_v4');
  const { voiceId, source } = await resolveVoiceId(clipId, refPath);
  const n = charCount(text);
  if (n < 1) throw new Error('ElevenLabs: empty text');

  const url = `${BASE}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`;
  const { latencyMs } = await timed(async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': key,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: model,
        language_code: 'yue',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8,
        },
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`ElevenLabs TTS ${res.status}: ${errText.slice(0, 600)}`);
    }
    const ab = Buffer.from(await res.arrayBuffer());
    ensureDir(path.dirname(outPath));
    fs.writeFileSync(outPath, ab);
  });

  return {
    vendor: 'elevenlabs',
    outPath,
    chars: n,
    latencyMs,
    voiceId,
    voiceSource: source,
    model,
    language_code: 'yue',
  };
}

async function runOne(clipId, outOverride) {
  const { yue } = clipPaths(clipId);
  if (!fs.existsSync(yue)) {
    throw new Error(`${clipId}: missing yue.txt — run translate-to-hk-kouyu.mjs first`);
  }
  const text = readText(yue);
  const outPath = outOverride || path.join(OUT_DIR, clipId, 'elevenlabs.mp3');
  log(`${clipId}: elevenlabs TTS (${charCount(text)} chars)`);
  const meta = await synthesizeElevenLabs({ text, clipId, outPath });
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
    console.error('Usage: node scripts/tts-elevenlabs.mjs <clip-id> | --all');
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
