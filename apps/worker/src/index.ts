import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createClient } from '@supabase/supabase-js';
import { ABS_MAX_DURATION_SEC, TRIAL_MAX_DURATION_SEC, userUploadObjectPath } from '@video-transcriber/shared';
import { runProcess } from '../../../scripts/lib/process.mjs';
import { pipelineEnvironment, providerEnvironment } from './credentials.js';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? '5000');

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

const supabase = createClient(
  requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false }, global: {
    fetch: (input, init) => fetch(input, { ...init, signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) }),
  } }
);

function runPipeline(workDir: string, envExtra: Record<string, string>, limit: number, timeout: number): Promise<void> {
  return runProcess(process.execPath, [path.join(ROOT, 'scripts/run-saas-pipeline.mjs'),
    '--work-dir', workDir, '--max-duration-seconds', String(limit)], {
    cwd: ROOT, env: pipelineEnvironment(envExtra, process.env), timeout,
  }).then(() => undefined);
}

async function resolveKeysForUser(userId: string): Promise<Record<string, string>> {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('byok_enabled, encrypted_byok_keys')
    .eq('id', userId)
    .single();

  if (error || !profile) throw new Error('Could not load job credentials');
  return providerEnvironment(profile, process.env);
}

async function downloadInput(inputPath: string, userId: string, dest: string): Promise<void> {
  const objectPath = userUploadObjectPath(inputPath, userId);
  const { data, error } = await supabase.storage.from('user-uploads').createSignedUrl(objectPath, 180);
  if (error || !data) throw new Error('Could not download input');
  const response = await fetch(data.signedUrl, { signal: AbortSignal.timeout(120000) });
  if (!response.ok || !response.body) throw new Error('Could not download input');
  const maxBytes = 500 * 1024 ** 2;
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Input exceeds file size limit');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let bytes = 0;
  await pipeline(Readable.fromWeb(response.body as never), new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > maxBytes ? new Error('Input exceeds file size limit') : null, chunk);
    },
  }), fs.createWriteStream(dest, { flags: 'wx', mode: 0o600 }));
}

async function uploadOutputs(
  userId: string,
  jobId: string,
  workDir: string,
  manifestPath: string
): Promise<Record<string, string>> {
  if (fs.statSync(manifestPath).size > 1024 * 1024) throw new Error('Output manifest exceeds size limit');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    outputs: Record<string, string>;
  };
  const out: Record<string, string> = {};
  const entries = Object.entries(manifest.outputs).filter(([, p]) => p && fs.existsSync(p));
  if (entries.length > 8) throw new Error('Too many output files');

  for (const [key, localPath] of entries) {
    const relative = path.relative(workDir, fs.realpathSync(localPath));
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid output path');
    if (fs.statSync(localPath).size > 500 * 1024 ** 2) throw new Error('Output exceeds file size limit');
    const base = path.basename(localPath);
    const storagePath = `${userId}/${jobId}/${base}`;
    const body = fs.createReadStream(localPath);
    const contentType = base.endsWith('.mp4')
      ? 'video/mp4'
      : base.endsWith('.wav')
        ? 'audio/wav'
        : base.endsWith('.json')
          ? 'application/json'
          : 'application/octet-stream';
    try {
      const { error } = await supabase.storage.from('job-outputs').upload(storagePath, body, {
        upsert: true, contentType, duplex: 'half',
      });
      if (error) throw new Error('Could not upload output');
    } finally { body.destroy(); }
    out[key] = `job-outputs/${storagePath}`;
  }
  return out;
}

async function processJob(job: {
  id: string;
  user_id: string;
  input_path: string;
  max_duration_seconds?: number;
  lease_expires_at: string;
}): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(job.id)) {
    throw new Error('Invalid job identity');
  }
  const base = process.env.WORK_DIR ?? '/tmp/vt-jobs';
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const workDir = fs.mkdtempSync(path.join(fs.realpathSync(base), `${job.id}-`));

  try {
    const leaseDeadline = Date.parse(job.lease_expires_at);
    if (!Number.isFinite(leaseDeadline) || leaseDeadline <= Date.now()) throw new Error('Worker lease expired');
    // Older jobs have no trustworthy entitlement snapshot: use trial policy.
    const limit = job.max_duration_seconds ?? TRIAL_MAX_DURATION_SEC;
    if (limit !== TRIAL_MAX_DURATION_SEC && limit !== ABS_MAX_DURATION_SEC) throw new Error('Invalid job duration policy');
    await downloadInput(job.input_path, job.user_id, path.join(workDir, 'video.mp4'));
    const { stdout } = await runProcess(process.execPath, [
      path.join(ROOT, 'scripts/run-saas-pipeline.mjs'), '--work-dir', workDir,
      '--max-duration-seconds', String(limit), '--validate-only',
    ], { timeout: 20000, maxOutput: 1024 * 1024, env: pipelineEnvironment({}, process.env) });
    const duration = JSON.parse(stdout).durationSeconds;
    if (!Number.isFinite(duration) || duration <= 0 || duration > limit) {
      throw new Error('Cannot verify media duration');
    }
    const { data: savedDuration, error: durationError } = await supabase.from('jobs')
      .update({ duration_seconds: duration }).eq('id', job.id).eq('status', 'running')
      .eq('lease_expires_at', job.lease_expires_at).gt('lease_expires_at', new Date().toISOString()).select('id').single();
    if (durationError || !savedDuration) throw new Error('Could not save verified duration or worker lease was lost');
    // Reserve time for bounded uploads and status writes before the claim expires.
    if (leaseDeadline - Date.now() <= 10 * 60000) throw new Error('Worker lease is too close to expiry');
    const keyEnv = await resolveKeysForUser(job.user_id);
    const timeout = Math.min(45 * 60000, leaseDeadline - Date.now() - 10 * 60000);
    if (timeout <= 0) throw new Error('Worker lease is too close to expiry');
    // Revalidate at pipeline entry, including when invoked outside this worker.
    await runPipeline(workDir, keyEnv, limit, timeout);

    const manifestPath = path.join(workDir, 'pipeline_result.json');
    const outputPaths = await uploadOutputs(job.user_id, job.id, workDir, manifestPath);

    const { data: completed, error: completionError } = await supabase
      .from('jobs')
      .update({
        status: 'succeeded',
        output_paths: outputPaths,
        error: null,
      })
      .eq('id', job.id).eq('status', 'running').eq('lease_expires_at', job.lease_expires_at)
      .gt('lease_expires_at', new Date().toISOString()).select('id').single();
    if (completionError || !completed) throw new Error('Could not save job completion or worker lease was lost');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from('jobs')
      .update({ status: 'failed', error: message.slice(0, 4000) })
      .eq('id', job.id).eq('status', 'running').eq('lease_expires_at', job.lease_expires_at);
  } finally {
    if (process.env.WORKER_KEEP_WORKDIR !== '1') {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
}

async function claimLoop(): Promise<void> {
  const { data, error } = await supabase.rpc('claim_next_job');
  if (error) {
    console.error('[worker] claim error', error.message);
    return;
  }
  const job = Array.isArray(data) ? data[0] : data;
  if (!job) return;
  console.log('[worker] processing job', job.id);
  await processJob(job);
}

async function main(): Promise<void> {
  console.log('[worker] started; polling every', POLL_MS, 'ms');
  for (;;) {
    try {
      await claimLoop();
    } catch (e) {
      console.error('[worker]', e);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
