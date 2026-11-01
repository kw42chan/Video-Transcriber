import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';
import { userUploadObjectPath } from '../src/upload-path.ts';
import { Readable, Transform } from 'node:stream';
import { pipelineEnvironment, providerEnvironment } from '../../../apps/worker/src/credentials.ts';

const workerPath = fileURLToPath(new URL('../../../apps/worker/src/index.ts', import.meta.url));
const source = (await fs.readFile(workerPath, 'utf8')).split('main().catch')[0] + '\nexport { processJob, uploadOutputs };';
const job = { id: '11111111-1111-4111-8111-111111111111', user_id: 'owner', input_path: 'user-uploads/owner/job/input.mp4',
  lease_expires_at: new Date(Date.now()+60*60000).toISOString() };

async function worker({ duration = 12, probeError = false, saveError = false, leaseLost = false, outputs = {} } = {}) {
  const events = [];
  const directories = [], queries = [], streams = [];
  const db = {
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://example.test/video' } }),
      upload: async (_path, body, options) => {
        assert.ok(body instanceof Readable);
        assert.equal(options.duplex, 'half');
        streams.push(body);
        return { error: null };
      },
    }) },
    from(table) {
      if (table === 'profiles') return { select: () => ({ eq: () => ({ single: async () => {
        events.push('keys');
        return { data: { byok_enabled: false } };
      } }) }) };
      return { update: (values) => {
        const filters = [];
        let recorded = false;
        const finish = () => {
          if (!recorded) { events.push(values); queries.push({ values, filters }); recorded = true; }
          return { data: leaseLost && 'duration_seconds' in values ? null : { id: job.id },
            error: saveError && 'duration_seconds' in values ? { message: 'DB unavailable' } : null };
        };
        const builder = { eq: (...args) => { filters.push(args); return builder; },
          gt: (...args) => { filters.push(['gt',...args]); return builder; }, select: () => builder,
          single: async () => finish(), then: (resolve, reject) => Promise.resolve(finish()).then(resolve,reject) };
        return builder;
      } };
    },
  };
  const mocks = {
    'dotenv/config': {},
    'node:fs': { default: { mkdirSync() {}, writeFileSync() {}, rmSync() {},
      mkdtempSync(prefix) { const dir = `${prefix}${directories.length}`; directories.push(dir); return dir; },
      statSync: () => ({ size: 0 }), existsSync: () => true, realpathSync: (file) => file,
      createReadStream: () => Readable.from(['output']),
      createWriteStream() {}, readFileSync: () => JSON.stringify({ outputs }) } },
    'node:path': { default: path },
    'node:stream': { Readable, Transform },
    'node:stream/promises': { pipeline: async () => {} },
    '../../../scripts/lib/process.mjs': { runProcess: async (_cmd, args, options) => {
      assert.equal(options.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
      if (!args.includes('--validate-only')) {
        assert.ok(options.timeout > 0 && options.timeout <= 45*60000);
        events.push({ pipelineArgs: args });
        return { stdout: '' };
      }
      events.push({ probeArgs: args });
      if (probeError) throw new Error('Probe failed');
      return { stdout: JSON.stringify({ durationSeconds: duration }) };
    } },
    './credentials.js': { pipelineEnvironment, providerEnvironment },
    '@supabase/supabase-js': { createClient: () => db },
    '@video-transcriber/shared': { TRIAL_MAX_DURATION_SEC: 60, ABS_MAX_DURATION_SEC: 300,
      userUploadObjectPath, decryptByokKeys() { throw new Error('unused'); } },
  };
  const context = vm.createContext({ Buffer, console, AbortSignal,
    fetch: async () => new Response('video'), process: {
    execPath: process.execPath, env: { NEXT_PUBLIC_SUPABASE_URL: 'https://example.test',
      SUPABASE_SERVICE_ROLE_KEY: 'test', WORK_DIR: '/test' },
  } });
  const module = new vm.SourceTextModule(stripTypeScriptTypes(source), {
    context, initializeImportMeta(meta) { meta.dirname = path.dirname(workerPath); },
  });
  await module.link((name) => new vm.SyntheticModule(Object.keys(mocks[name]), function () {
    for (const [key, value] of Object.entries(mocks[name])) this.setExport(key, value);
  }, { context }));
  await module.evaluate();
  return { processJob: module.namespace.processJob, uploadOutputs: module.namespace.uploadOutputs, events, directories, queries, streams };
}

test('worker persists verified duration before resolving keys or starting processing', async () => {
  for (const policy of [undefined, 60, 300]) {
    const { processJob, events } = await worker();
    await processJob({ ...job, max_duration_seconds: policy });
    const probe = events.findIndex((e) => e.probeArgs);
    const save = events.findIndex((e) => e.duration_seconds);
    const keys = events.indexOf('keys');
    const pipeline = events.findIndex((e) => e.pipelineArgs);
    assert.ok(probe < save && save < keys && keys < pipeline);
    assert.ok(events[probe].probeArgs.includes('--validate-only'));
    assert.equal(events[probe].probeArgs.at(-2), String(policy ?? 60));
    assert.equal(events[pipeline].pipelineArgs.at(-1), String(policy ?? 60));
    assert.equal(events.at(-1).status, 'succeeded');
  }
});

test('worker fails closed before keys/providers on invalid media, policy, or failed duration save', async () => {
  for (const options of [ { duration: 61 }, { duration: 0 }, { duration: '12' },
    { duration: null }, { probeError: true }, { saveError: true }, { leaseLost: true }, { policy: 9999 } ]) {
    const { processJob, events } = await worker(options);
    await processJob({ ...job, max_duration_seconds: options.policy });
    assert.equal(events.includes('keys'), false);
    assert.equal(events.some((e) => e.pipelineArgs), false);
    assert.equal(events.at(-1).status, 'failed');
  }
});

test('worker rejects expired or nearly expired leases before loading provider keys', async () => {
  for (const lease_expires_at of ['invalid', new Date(Date.now()-1000).toISOString(), new Date(Date.now()+5*60000).toISOString()]) {
    const { processJob, events } = await worker();
    await processJob({ ...job, lease_expires_at });
    assert.equal(events.includes('keys'), false);
    assert.equal(events.some((e)=>e.pipelineArgs), false);
    assert.equal(events.at(-1).status, 'failed');
  }
});

test('worker uses fresh directories and fences progress/completion against its exact live lease', async () => {
  const { processJob, directories, queries } = await worker();
  await processJob(job);
  await processJob(job);
  assert.equal(new Set(directories).size, 2);
  for (const { filters } of queries) {
    assert.ok(filters.some(([name,value])=>name==='lease_expires_at' && value===job.lease_expires_at));
    assert.ok(filters.some(([name,value])=>name==='status' && value==='running'));
    assert.ok(filters.some(([operation,name])=>operation==='gt' && name==='lease_expires_at'));
  }
});

test('output uploads stream files and reject escaped paths or excessive manifests', async () => {
  const { uploadOutputs, streams } = await worker({ outputs: { finalVideo: '/test/jobdir/video.mp4' } });
  const result = await uploadOutputs('owner', job.id, '/test/jobdir', '/test/jobdir/manifest.json');
  assert.equal(result.finalVideo, `job-outputs/owner/${job.id}/video.mp4`);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].destroyed, true);
  const escaped = await worker({ outputs: { finalVideo: '/test/foreign/video.mp4' } });
  await assert.rejects(escaped.uploadOutputs('owner',job.id,'/test/jobdir','/test/jobdir/manifest.json'), /Invalid output path/);
  assert.equal(escaped.streams.length, 0);
  const excessive = await worker({ outputs: Object.fromEntries(Array.from({ length: 9 },(_,i)=>[i,`/test/jobdir/${i}.mp4`])) });
  await assert.rejects(excessive.uploadOutputs('owner',job.id,'/test/jobdir','/test/jobdir/manifest.json'), /Too many output files/);
  assert.equal(excessive.streams.length, 0);
});
