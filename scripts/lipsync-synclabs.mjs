#!/usr/bin/env node
/**
 * Day 2 lip sync — Sync Labs (sync.so) API client. No SDK / npm install needed.
 * Docs (verified 2026-10-19): https://sync.so/docs  · OpenAPI: https://sync.so/docs/openapi.json
 *   Base:    https://api.sync.so
 *   Auth:    x-api-key: $SYNCLABS_API_KEY   (docs call it SYNC_API_KEY; both accepted)
 *   Submit:  POST /v2/generate  — multipart/form-data with local files `video` + `audio`
 *            (nested `options` / `input` as JSON strings), OR JSON with input[].url / input[].assetId
 *   Large:   POST /v2/assets/upload → PUT presigned uploadUrl → POST /v2/assets {url,type} → assetId
 *   Poll:    GET /v2/generate/{id} → status PENDING|PROCESSING|COMPLETED|FAILED|REJECTED, outputUrl
 *   Output:  outputUrl, or GET /v2/generations/{id}/download (text/plain signed URL; fetch WITHOUT key)
 *   Cost:    POST /v2/generations/estimate {model,duration,fps} → estimatedGenerationCost (USD)
 *   Models:  sync-3 (API default), lipsync-2 (harness default), lipsync-2-pro, lipsync-1.9.0-beta, react-1
 *   Free:    3 gens/month ≤20s each (sync-3: 1 gen ≤15s); free outputs are watermarked.
 *
 * Usage:
 *   node scripts/lipsync-synclabs.mjs --video V.mp4 --audio A.wav [--out O.mp4]
 *        [--start S] [--duration D] [--model lipsync-2] [--sync-mode cut_off]
 *        [--upload multipart|assets] [--video-url URL --audio-url URL]
 *        [--free-tier] [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { env, log, warn, sleep, ROOT } from './lib/common.mjs';
import {
  parseArgs, resolvePath, rel, probeDuration, probeVideo, maybeTrim, checkBudget, recordSpend, readSpend,
  redactHeaders, downloadTo, mimeFor, fileSizeMB,
} from './lib/lipsync.mjs';

const BASE = env('SYNCLABS_BASE_URL', 'https://api.sync.so');
const KEY_NAMES = ['SYNCLABS_API_KEY', 'SYNC_API_KEY'];
const MODELS = ['sync-3', 'lipsync-2', 'lipsync-2-pro', 'lipsync-1.9.0-beta', 'react-1'];
const USD_PER_SEC = Number(env('SYNCLABS_USD_PER_SEC', '0.05')); // lipsync-2 ≈ $0.05/s @25fps (approx)
const PLAN_USD = Number(env('SYNCLABS_PLAN_USD', '5')); // ~US$5 plan needed for >20s / beyond free tier
const FREE_MAX_S = { default: 20, 'sync-3': 15 };
const FREE_GENS_PER_MONTH = 3;

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error('usage: node scripts/lipsync-synclabs.mjs --video V.mp4 --audio A.wav [--out O.mp4] [--start S] [--duration D] [--model lipsync-2] [--sync-mode cut_off] [--upload multipart|assets] [--video-url U --audio-url U --duration D] [--free-tier] [--dry-run]');
  process.exit(msg ? 2 : 0);
}

function getKey() {
  for (const n of KEY_NAMES) if (env(n)) return { name: n, value: env(n) };
  return null;
}

async function api(key, method, p, { json, form } = {}) {
  const headers = { 'x-api-key': key };
  let body;
  if (json) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form) body = form;
  const res = await fetch(`${BASE}${p}`, { method, headers, body });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`Sync ${method} ${p} → ${res.status}: ${String(text).slice(0, 500)}`);
  return data;
}

async function uploadAsset(key, file, type) {
  const up = await api(key, 'POST', '/v2/assets/upload', {
    json: { fileName: path.basename(file), contentType: mimeFor(file), size: fs.statSync(file).size },
  });
  const put = await fetch(up.uploadUrl, { method: 'PUT', headers: { 'Content-Type': mimeFor(file) }, body: fs.readFileSync(file) });
  if (!put.ok) throw new Error(`Sync presigned PUT ${put.status}`);
  const asset = await api(key, 'POST', '/v2/assets', { json: { url: up.url, type, name: path.basename(file) } });
  return asset.id;
}

async function main() {
  const a = parseArgs(process.argv.slice(2), ['dry-run', 'free-tier', 'help']);
  if (a.help) usage();
  const dry = Boolean(a.dryRun);
  const model = a.model || env('SYNCLABS_MODEL', 'lipsync-2');
  if (!MODELS.includes(model)) usage(`--model must be one of ${MODELS.join(', ')}`);
  const syncMode = a.syncMode || 'cut_off';
  const uploadMode = a.upload || 'multipart';
  if (!['multipart', 'assets'].includes(uploadMode)) usage('--upload must be multipart|assets');
  const useUrls = Boolean(a.videoUrl || a.audioUrl);
  if (useUrls && !(a.videoUrl && a.audioUrl)) usage('--video-url and --audio-url go together');
  if (!useUrls && (!a.video || !a.audio)) usage('--video and --audio are required');

  let video = a.video && resolvePath(a.video);
  let audio = a.audio && resolvePath(a.audio);
  const outDefault = video
    ? path.join(path.dirname(video), `${path.basename(video, path.extname(video))}_synclabs_${model}.mp4`)
    : path.join(ROOT, 'out', `synclabs_${model}.mp4`);
  const out = resolvePath(a.out || outDefault);
  for (const f of [video, audio]) if (f && !fs.existsSync(f)) usage(`missing file ${f}`);

  // Trim
  let dur;
  let fps = 30;
  if (!useUrls) {
    const t = maybeTrim({ video, audio, start: a.start, duration: a.duration, out });
    video = t.video;
    audio = t.audio;
    if (t.trimmed) log(`trimmed pair → ${rel(t.dir)}/ (start=${a.start || 0}s dur=${a.duration ?? 'to end'})`);
    const vd = probeDuration(video);
    const ad = probeDuration(audio);
    dur = Math.max(vd, ad);
    fps = probeVideo(video).fps;
    log(`video ${rel(video)} ${vd.toFixed(2)}s (${fileSizeMB(video)} MB)  audio ${rel(audio)} ${ad.toFixed(2)}s (${fileSizeMB(audio)} MB)`);
    if (Math.abs(vd - ad) > 0.5) warn(`video/audio differ by ${(vd - ad).toFixed(2)}s; sync_mode=${syncMode}`);
  } else {
    dur = Number(a.duration);
    if (!Number.isFinite(dur)) usage('with --video-url/--audio-url pass --duration (seconds) for the cost estimate');
  }

  // Cost
  const spend = readSpend();
  const freeCap = FREE_MAX_S[model] ?? FREE_MAX_S.default;
  const freeUsed = spend.entries.filter((e) => e.vendor === 'synclabs' && e.free_tier && String(e.ts).slice(0, 7) === new Date().toISOString().slice(0, 7)).length;
  const paidUsd = dur * USD_PER_SEC + (spend.plans?.synclabs ? 0 : PLAN_USD);
  let estimate = paidUsd;
  let label = `paid: ${dur.toFixed(1)}s × US$${USD_PER_SEC}/s${spend.plans?.synclabs ? '' : ` + US$${PLAN_USD} plan`}`;
  if (a.freeTier) {
    if (dur > freeCap + 0.05) usage(`--free-tier: ${dur.toFixed(1)}s exceeds free max ${freeCap}s for ${model}; trim with --duration`);
    if (freeUsed >= FREE_GENS_PER_MONTH) warn(`free tier: ${freeUsed}/${FREE_GENS_PER_MONTH} gens already logged this month — Sync may reject`);
    estimate = 0;
    label = `free tier (${freeUsed}/${FREE_GENS_PER_MONTH} used this month; paid-equivalent US$${(dur * USD_PER_SEC).toFixed(2)})`;
  } else if (dur <= freeCap) {
    log(`note: ${dur.toFixed(1)}s ≤ ${freeCap}s — eligible for free tier; pass --free-tier if the account is on the free plan`);
  }
  const budget = checkBudget(estimate, label);

  // Planned request
  const key = getKey();
  const options = { sync_mode: syncMode };
  const outputFileName = path.basename(out, path.extname(out));
  const headers = { 'x-api-key': key ? key.value : '' };
  let plan;
  if (useUrls) {
    plan = { method: 'POST', url: `${BASE}/v2/generate`, headers: { ...redactHeaders(headers), 'Content-Type': 'application/json' },
      body: { model, input: [{ type: 'video', url: a.videoUrl }, { type: 'audio', url: a.audioUrl }], options, outputFileName } };
  } else if (uploadMode === 'multipart') {
    plan = { method: 'POST', url: `${BASE}/v2/generate`, headers: { ...redactHeaders(headers), 'Content-Type': 'multipart/form-data' },
      form: { video: `@${rel(video)} (${mimeFor(video)})`, audio: `@${rel(audio)} (${mimeFor(audio)})`, model, options: JSON.stringify(options), outputFileName } };
  } else {
    plan = { steps: [
      `POST ${BASE}/v2/assets/upload {fileName,contentType,size} ×2 → PUT uploadUrl → POST ${BASE}/v2/assets {url,type:VIDEO|AUDIO} → assetId`,
      { method: 'POST', url: `${BASE}/v2/generate`, body: { model, input: [{ type: 'video', assetId: '<video assetId>' }, { type: 'audio', assetId: '<audio assetId>' }], options, outputFileName } },
    ] };
  }
  log(`key: ${key ? `${key.name} present` : `${KEY_NAMES.join('/')} missing`}`);
  log(`planned request:\n${JSON.stringify(plan, null, 2)}`);
  log(`then: poll GET ${BASE}/v2/generate/<id> every 10s → download outputUrl → ${rel(out)}`);

  if (dry) {
    log(`DRY RUN — no network calls, no spend. ${budget.ok ? 'Would submit.' : 'Would REFUSE (cap).'}`);
    return;
  }
  if (!budget.ok) { console.error('REFUSED: estimate would push cumulative spend over cap. Raise cap_usd in out/spend.json only with Darwin\'s OK.'); process.exit(3); }
  if (!key) { console.error(`Missing ${KEY_NAMES.join(' or ')} in .env`); process.exit(2); }

  // Server-side estimate (free call) — take the higher number when paid
  try {
    const est = await api(key.value, 'POST', '/v2/generations/estimate', { json: { model, duration: dur, fps } });
    log(`Sync estimate endpoint: US$${est.estimatedGenerationCost} (${est.estimatedFrameCount} frames${est.estimatedCredits != null ? `, ${est.estimatedCredits} credits` : ''})`);
    if (!a.freeTier && est.estimatedGenerationCost > dur * USD_PER_SEC) {
      estimate = est.estimatedGenerationCost + (spend.plans?.synclabs ? 0 : PLAN_USD);
      if (!checkBudget(estimate, 'server estimate').ok) process.exit(3);
    }
  } catch (e) {
    warn(`estimate endpoint failed (continuing with local estimate): ${e.message}`);
  }

  const t0 = Date.now();
  let gen;
  if (useUrls) {
    gen = await api(key.value, 'POST', '/v2/generate', { json: plan.body });
  } else if (uploadMode === 'multipart') {
    const form = new FormData();
    form.append('video', new Blob([fs.readFileSync(video)], { type: mimeFor(video) }), path.basename(video));
    form.append('audio', new Blob([fs.readFileSync(audio)], { type: mimeFor(audio) }), path.basename(audio));
    form.append('model', model);
    form.append('options', JSON.stringify(options));
    form.append('outputFileName', outputFileName);
    gen = await api(key.value, 'POST', '/v2/generate', { form });
  } else {
    const vId = await uploadAsset(key.value, video, 'VIDEO');
    const aId = await uploadAsset(key.value, audio, 'AUDIO');
    gen = await api(key.value, 'POST', '/v2/generate', { json: { model, input: [{ type: 'video', assetId: vId }, { type: 'audio', assetId: aId }], options, outputFileName } });
  }
  log(`submitted generation ${gen.id} (status ${gen.status})`);
  recordSpend({ vendor: 'synclabs', model, generation_id: gen.id, seconds: Number(dur.toFixed(2)), usd: Number(estimate.toFixed(4)), free_tier: Boolean(a.freeTier), plan: !a.freeTier && !spend.plans?.synclabs ? 'synclabs' : undefined, note: 'estimate at submit' });

  const deadline = Date.now() + 30 * 60 * 1000;
  while (!['COMPLETED', 'FAILED', 'REJECTED'].includes(gen.status)) {
    if (Date.now() > deadline) throw new Error(`poll timeout; generation ${gen.id} still ${gen.status}`);
    await sleep(10000);
    gen = await api(key.value, 'GET', `/v2/generate/${gen.id}`);
    log(`poll ${gen.id}: ${gen.status}`);
  }
  if (gen.status !== 'COMPLETED') throw new Error(`generation ${gen.status}: ${gen.errorCode || ''} ${gen.error || ''}`);
  let url = gen.outputUrl;
  if (!url) url = String(await api(key.value, 'GET', `/v2/generations/${gen.id}/download`)).trim();
  await downloadTo(url, out);
  const meta = { vendor: 'synclabs', model, generation_id: gen.id, status: gen.status, seconds: dur, latency_s: (Date.now() - t0) / 1000, out: rel(out), output_duration: gen.outputDuration, est_usd: estimate };
  fs.writeFileSync(out.replace(/\.mp4$/, '') + '.json', JSON.stringify(meta, null, 2) + '\n');
  log(`done → ${rel(out)} (${meta.latency_s.toFixed(0)}s wall)`);
}

main().catch((e) => { console.error(`[phase0:error] ${e.message}`); process.exit(1); });
