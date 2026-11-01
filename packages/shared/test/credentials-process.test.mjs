import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encryptByokKeys } from '../src/byok.ts';
import { pipelineEnvironment, providerEnvironment } from '../../../apps/worker/src/credentials.ts';
import { mediaEnvironment, mediaCommand } from '../../../scripts/lib/media-sandbox.mjs';
import { runProcess } from '../../../scripts/lib/process.mjs';

const encryptionKey = Buffer.alloc(32, 1).toString('base64');
const platform = { BYOK_ENCRYPTION_KEY: encryptionKey, CANTOGEN_API_KEY: 'platform-tts',
  SYNC_API_KEY: 'platform-sync', OPENROUTER_API_KEY: 'platform-llm',
  SUPABASE_SERVICE_ROLE_KEY: 'database-secret', PRIVATE_OTHER_SECRET: 'other' };

test('BYOK never falls back to platform credentials for absent, partial or invalid payloads', async () => {
  await assert.rejects(providerEnvironment({ byok_enabled: true, encrypted_byok_keys: null }, platform));
  for (const keys of [{}, { openrouter: 'user-llm' }, { cantoGen: 'user-tts' }]) {
    const encrypted_byok_keys = await encryptByokKeys(keys, encryptionKey);
    await assert.rejects(providerEnvironment({ byok_enabled: true, encrypted_byok_keys }, platform));
  }
  await assert.rejects(providerEnvironment({ byok_enabled: true, encrypted_byok_keys: { v: 1, iv: 'bad', ciphertext: 'bad' } }, platform));
  const encrypted_byok_keys = await encryptByokKeys({ openrouter: 'user-llm', cantoGen: 'user-tts' }, encryptionKey);
  const result = await providerEnvironment({ byok_enabled: true, encrypted_byok_keys }, platform);
  assert.deepEqual(result, { OPENROUTER_API_KEY: 'user-llm', CANTO_GEN_API_KEY: 'user-tts', SYNCLABS_API_KEY: '', FAL_KEY: '' });
  const env = pipelineEnvironment(result, platform);
  for (const key of ['SUPABASE_SERVICE_ROLE_KEY','BYOK_ENCRYPTION_KEY','CANTOGEN_API_KEY','SYNC_API_KEY','PRIVATE_OTHER_SECRET']) {
    assert.equal(env[key], undefined);
  }
  assert.equal(env.SAAS_MODE, '1');
  for (const key of Object.keys(platform)) assert.equal(mediaEnvironment(platform)[key], undefined);
});

test('media fails closed when SaaS sandbox is unavailable on this platform', { skip: process.platform === 'linux' }, () => {
  const before = process.env.SAAS_MODE;
  process.env.SAAS_MODE = '1';
  try { assert.throws(() => mediaCommand('ffprobe', [], '/tmp/job'), /Linux sandbox/); }
  finally { if (before === undefined) delete process.env.SAAS_MODE; else process.env.SAAS_MODE = before; }
});

test('subprocess deadlines and output bounds terminate processing; next task still works', async () => {
  await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeout: 150 }), /timed out/);
  await assert.rejects(runProcess(process.execPath, ['-e', "process.stdout.write('x'.repeat(10000));setInterval(()=>{},1000)"],
    { timeout: 3000, maxOutput: 100 }), /output limit/);
  const result = await runProcess(process.execPath, ['-e', "console.log('next-job')"]);
  assert.equal(result.stdout.trim(), 'next-job');
  await assert.rejects(runProcess('nonexistent-vt-security-command', []));
});

test('SaaS common helpers do not reload provider keys from root dotenv', async () => {
  const root = new URL('../../../scripts/lib/common.mjs', import.meta.url).href;
  const result = await runProcess(process.execPath, ['--input-type=module', '-e',
    `const {loadDotEnv}=await import(${JSON.stringify(root)});loadDotEnv('missing.env');console.log(process.env.SYNC_API_KEY??'absent')`],
    { env: { SAAS_MODE: '1', SystemRoot: process.env.SystemRoot } });
  assert.equal(result.stdout.trim(), 'absent');
});
