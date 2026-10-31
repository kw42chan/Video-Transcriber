import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { decryptByokKeys, userUploadObjectPath, type EncryptedByokPayload } from '@video-transcriber/shared';

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
  { auth: { persistSession: false, autoRefreshToken: false } }
);

function runPipeline(workDir: string, envExtra: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = path.join(ROOT, 'scripts/run-saas-pipeline.mjs');
    const child = spawn(process.execPath, [script, '--work-dir', workDir], {
      cwd: ROOT,
      env: { ...process.env, ...envExtra },
      stdio: 'inherit',
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Pipeline exited ${code}`));
    });
  });
}

async function resolveKeysForUser(userId: string): Promise<Record<string, string>> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('byok_enabled, encrypted_byok_keys')
    .eq('id', userId)
    .single();

  if (profile?.byok_enabled && profile.encrypted_byok_keys) {
    const encKey = process.env.BYOK_ENCRYPTION_KEY;
    if (!encKey) throw new Error('BYOK user but BYOK_ENCRYPTION_KEY unset on worker');
    const keys = await decryptByokKeys(profile.encrypted_byok_keys as EncryptedByokPayload, encKey);
    return {
      OPENROUTER_API_KEY: keys.openrouter ?? '',
      CANTO_GEN_API_KEY: keys.cantoGen ?? '',
      SYNCLABS_API_KEY: keys.synclabs ?? '',
      FAL_KEY: keys.fal ?? '',
    };
  }

  return {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? '',
    CANTO_GEN_API_KEY: process.env.CANTO_GEN_API_KEY ?? process.env.CANTOGEN_API_KEY ?? '',
    SYNCLABS_API_KEY: process.env.SYNCLABS_API_KEY ?? process.env.SYNC_API_KEY ?? '',
    FAL_KEY: process.env.FAL_KEY ?? '',
  };
}

async function downloadInput(inputPath: string, userId: string, dest: string): Promise<void> {
  const objectPath = userUploadObjectPath(inputPath, userId);
  const { data, error } = await supabase.storage.from('user-uploads').download(objectPath);
  if (error || !data) throw new Error(`Download failed: ${error?.message ?? 'no data'}`);
  const buf = Buffer.from(await data.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}

async function uploadOutputs(
  userId: string,
  jobId: string,
  workDir: string,
  manifestPath: string
): Promise<Record<string, string>> {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    outputs: Record<string, string>;
  };
  const out: Record<string, string> = {};
  const entries = Object.entries(manifest.outputs).filter(([, p]) => p && fs.existsSync(p));

  for (const [key, localPath] of entries) {
    const base = path.basename(localPath);
    const storagePath = `${userId}/${jobId}/${base}`;
    const body = fs.readFileSync(localPath);
    const contentType = base.endsWith('.mp4')
      ? 'video/mp4'
      : base.endsWith('.wav')
        ? 'audio/wav'
        : base.endsWith('.json')
          ? 'application/json'
          : 'application/octet-stream';
    const { error } = await supabase.storage.from('job-outputs').upload(storagePath, body, {
      upsert: true,
      contentType,
    });
    if (error) throw new Error(`Upload ${base}: ${error.message}`);
    out[key] = `job-outputs/${storagePath}`;
  }
  return out;
}

async function processJob(job: {
  id: string;
  user_id: string;
  input_path: string;
}): Promise<void> {
  const workDir = path.join(process.env.WORK_DIR ?? '/tmp/vt-jobs', job.id);
  fs.mkdirSync(workDir, { recursive: true });

  try {
    const keyEnv = await resolveKeysForUser(job.user_id);
    await downloadInput(job.input_path, job.user_id, path.join(workDir, 'video.mp4'));
    await runPipeline(workDir, keyEnv);

    const manifestPath = path.join(workDir, 'pipeline_result.json');
    const outputPaths = await uploadOutputs(job.user_id, job.id, workDir, manifestPath);

    await supabase
      .from('jobs')
      .update({
        status: 'succeeded',
        output_paths: outputPaths,
        error: null,
      })
      .eq('id', job.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from('jobs')
      .update({ status: 'failed', error: message.slice(0, 4000) })
      .eq('id', job.id);
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
