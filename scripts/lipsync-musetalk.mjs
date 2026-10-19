#!/usr/bin/env node
/**
 * Day 2 lip sync fallback — MuseTalk on Fal (fal-ai/musetalk). No SDK / npm install needed.
 * Docs (verified 2026-10-19): https://fal.ai/models/fal-ai/musetalk/api · https://docs.fal.ai/model-apis/model-endpoints/queue
 *   Auth:    Authorization: Key $FAL_KEY
 *   Input:   { source_video_url, audio_url }  (public URL or base64 data URI)
 *   Upload:  POST https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3
 *            {content_type,file_name} → {upload_url,file_url}; PUT bytes to upload_url (same flow as @fal-ai/client)
 *   Submit:  POST https://queue.fal.run/fal-ai/musetalk → {request_id,status_url,response_url}
 *   Poll:    GET status_url → IN_QUEUE|IN_PROGRESS|COMPLETED (error field if failed)
 *   Result:  GET response_url → { video: { url, content_type, file_name, file_size } }
 *   Price:   billed per GPU compute-second; model page lists no fixed rate → harness uses a conservative
 *            FAL_MUSETALK_USD_PER_SEC (default 0.05 per output second) until the first real invoice.
 *
 * Usage:
 *   node scripts/lipsync-musetalk.mjs --video V.mp4 --audio A.wav [--out O.mp4]
 *        [--start S] [--duration D] [--upload storage|datauri] [--video-url URL --audio-url URL] [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { env, log, warn, sleep, ROOT } from './lib/common.mjs';
import {
  parseArgs, resolvePath, rel, probeDuration, maybeTrim, checkBudget, recordSpend, redactHeaders, downloadTo, mimeFor, fileSizeMB,
} from './lib/lipsync.mjs';

const MODEL_ID = 'fal-ai/musetalk';
const QUEUE = `https://queue.fal.run/${MODEL_ID}`;
const STORAGE_INIT = 'https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3';
const USD_PER_SEC = Number(env('FAL_MUSETALK_USD_PER_SEC', '0.05'));

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error('usage: node scripts/lipsync-musetalk.mjs --video V.mp4 --audio A.wav [--out O.mp4] [--start S] [--duration D] [--upload storage|datauri] [--video-url U --audio-url U] [--dry-run]');
  process.exit(msg ? 2 : 0);
}

async function falUpload(key, file) {
  const init = await fetch(STORAGE_INIT, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content_type: mimeFor(file), file_name: path.basename(file) }),
  });
  if (!init.ok) throw new Error(`fal storage initiate ${init.status}: ${(await init.text()).slice(0, 300)}`);
  const { upload_url, file_url } = await init.json();
  const put = await fetch(upload_url, { method: 'PUT', headers: { 'Content-Type': mimeFor(file) }, body: fs.readFileSync(file) });
  if (!put.ok) throw new Error(`fal storage PUT ${put.status}`);
  return file_url;
}

function dataUri(file) {
  return `data:${mimeFor(file)};base64,${fs.readFileSync(file).toString('base64')}`;
}

async function main() {
  const a = parseArgs(process.argv.slice(2), ['dry-run', 'help']);
  if (a.help) usage();
  const dry = Boolean(a.dryRun);
  const uploadMode = a.upload || 'storage';
  if (!['storage', 'datauri'].includes(uploadMode)) usage('--upload must be storage|datauri');
  const useUrls = Boolean(a.videoUrl || a.audioUrl);
  if (useUrls && !(a.videoUrl && a.audioUrl)) usage('--video-url and --audio-url go together');
  if (!useUrls && (!a.video || !a.audio)) usage('--video and --audio are required');

  let video = a.video && resolvePath(a.video);
  let audio = a.audio && resolvePath(a.audio);
  const out = resolvePath(a.out || (video ? path.join(path.dirname(video), `${path.basename(video, path.extname(video))}_musetalk.mp4`) : path.join(ROOT, 'out', 'musetalk.mp4')));
  for (const f of [video, audio]) if (f && !fs.existsSync(f)) usage(`missing file ${f}`);

  let dur;
  if (!useUrls) {
    const t = maybeTrim({ video, audio, start: a.start, duration: a.duration, out });
    video = t.video;
    audio = t.audio;
    if (t.trimmed) log(`trimmed pair → ${rel(t.dir)}/ (start=${a.start || 0}s dur=${a.duration ?? 'to end'})`);
    const vd = probeDuration(video);
    const ad = probeDuration(audio);
    dur = Math.max(vd, ad);
    log(`video ${rel(video)} ${vd.toFixed(2)}s (${fileSizeMB(video)} MB)  audio ${rel(audio)} ${ad.toFixed(2)}s (${fileSizeMB(audio)} MB)`);
    if (uploadMode === 'datauri' && fs.statSync(video).size + fs.statSync(audio).size > 10 * 1024 * 1024) warn('data URIs >10 MB are slow/may be rejected; prefer --upload storage');
  } else {
    dur = Number(a.duration);
    if (!Number.isFinite(dur)) usage('with --video-url/--audio-url pass --duration for the cost estimate');
  }

  const estimate = dur * USD_PER_SEC;
  const budget = checkBudget(estimate, `${dur.toFixed(1)}s × US$${USD_PER_SEC}/s (conservative; Fal bills GPU-seconds)`);

  const key = env('FAL_KEY');
  const headers = redactHeaders({ Authorization: `Key ${key || ''}`, 'Content-Type': 'application/json' });
  const src = useUrls
    ? { source_video_url: a.videoUrl, audio_url: a.audioUrl }
    : uploadMode === 'storage'
      ? { source_video_url: `<fal storage url of ${rel(video)}>`, audio_url: `<fal storage url of ${rel(audio)}>` }
      : { source_video_url: `data:${mimeFor(video)};base64,<${fileSizeMB(video)} MB>`, audio_url: `data:${mimeFor(audio)};base64,<${fileSizeMB(audio)} MB>` };
  const plan = {
    ...(useUrls || uploadMode !== 'storage' ? {} : { upload: `POST ${STORAGE_INIT} {content_type,file_name} ×2 → PUT upload_url → file_url` }),
    submit: { method: 'POST', url: QUEUE, headers, body: src },
  };
  log(`key: ${key ? 'FAL_KEY present' : 'FAL_KEY missing'}`);
  log(`planned request:\n${JSON.stringify(plan, null, 2)}`);
  log(`then: poll status_url every 5s → GET response_url → download video.url → ${rel(out)}`);

  if (dry) {
    log(`DRY RUN — no network calls, no spend. ${budget.ok ? 'Would submit.' : 'Would REFUSE (cap).'}`);
    return;
  }
  if (!budget.ok) { console.error('REFUSED: estimate would push cumulative spend over cap.'); process.exit(3); }
  if (!key) { console.error('Missing FAL_KEY in .env'); process.exit(2); }

  const t0 = Date.now();
  const body = useUrls
    ? src
    : uploadMode === 'storage'
      ? { source_video_url: await falUpload(key, video), audio_url: await falUpload(key, audio) }
      : { source_video_url: dataUri(video), audio_url: dataUri(audio) };
  const sub = await fetch(QUEUE, { method: 'POST', headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!sub.ok) throw new Error(`fal submit ${sub.status}: ${(await sub.text()).slice(0, 400)}`);
  const job = await sub.json();
  log(`submitted ${job.request_id}`);
  recordSpend({ vendor: 'fal-musetalk', request_id: job.request_id, seconds: Number(dur.toFixed(2)), usd: Number(estimate.toFixed(4)), note: 'estimate at submit' });

  const statusUrl = job.status_url || `${QUEUE}/requests/${job.request_id}/status`;
  const responseUrl = job.response_url || `${QUEUE}/requests/${job.request_id}`;
  const deadline = Date.now() + 30 * 60 * 1000;
  let st;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`poll timeout ${job.request_id}`);
    await sleep(5000);
    const r = await fetch(statusUrl, { headers: { Authorization: `Key ${key}` } });
    st = await r.json().catch(() => ({}));
    if (!r.ok && r.status !== 202) throw new Error(`fal status ${r.status}: ${JSON.stringify(st).slice(0, 300)}`);
    log(`poll ${job.request_id}: ${st.status}${st.queue_position != null ? ` (pos ${st.queue_position})` : ''}`);
    if (st.status === 'COMPLETED') break;
  }
  if (st.error) throw new Error(`fal failed: ${st.error_type || ''} ${st.error}`);
  const res = await fetch(responseUrl, { headers: { Authorization: `Key ${key}` } });
  const data = await res.json();
  if (!res.ok || !data?.video?.url) throw new Error(`fal result ${res.status}: ${JSON.stringify(data).slice(0, 400)}`);
  await downloadTo(data.video.url, out);
  const meta = { vendor: 'fal-musetalk', request_id: job.request_id, seconds: dur, latency_s: (Date.now() - t0) / 1000, inference_s: st.metrics?.inference_time, out: rel(out), est_usd: estimate };
  fs.writeFileSync(out.replace(/\.mp4$/, '') + '.json', JSON.stringify(meta, null, 2) + '\n');
  log(`done → ${rel(out)} (${meta.latency_s.toFixed(0)}s wall)`);
}

main().catch((e) => { console.error(`[phase0:error] ${e.message}`); process.exit(1); });
