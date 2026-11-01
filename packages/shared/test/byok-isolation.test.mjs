import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { encryptByokKeys } from '../src/byok.ts';
import { providerEnvironment, pipelineEnvironment } from '../../../apps/worker/src/credentials.ts';

const master = Buffer.alloc(32, 7).toString('base64');
const platform = { BYOK_ENCRYPTION_KEY: master, OPENROUTER_API_KEY: 'platform-router',
  CANTO_GEN_API_KEY: 'platform-tts', CANTOGEN_API_KEY: 'platform-tts-alias',
  SYNCLABS_API_KEY: 'platform-sync', SYNC_API_KEY: 'platform-sync-alias', FAL_KEY: 'platform-fal' };

test('malformed credential mode and decrypted BYOK bundles cannot select platform billing', async () => {
  for (const mode of [undefined, null, 0, '', 'false']) {
    await assert.rejects(providerEnvironment({ byok_enabled: mode, encrypted_byok_keys: null }, platform));
  }
  for (const bundle of [null, [], 'text', { openrouter: 'user-router', cantoGen: 'user-tts', synclabs: 123 },
    { openrouter: 'user-router', cantoGen: 'user-tts', fal: null },
    { openrouter: 'user\nrouter', cantoGen: 'user-tts' },
    { openrouter: 'user-router', cantoGen: 'x'.repeat(4097) }]) {
    const encrypted_byok_keys = await encryptByokKeys(bundle, master);
    await assert.rejects(providerEnvironment({ byok_enabled: true, encrypted_byok_keys }, platform));
  }
  const encrypted_byok_keys = await encryptByokKeys({ openrouter: ' user-router ', cantoGen: ' user-tts ',
    SYNCLABS_API_KEY: 'forged', SUPABASE_SERVICE_ROLE_KEY: 'forged', SAAS_MODE: '0' }, master);
  const selected = await providerEnvironment({ byok_enabled: true, encrypted_byok_keys }, platform);
  assert.deepEqual(selected, { OPENROUTER_API_KEY: 'user-router', CANTO_GEN_API_KEY: 'user-tts', SYNCLABS_API_KEY: '', FAL_KEY: '' });
});

test('pipeline environment accepts exact provider names and cannot override isolation settings', () => {
  const env = pipelineEnvironment({ OPENROUTER_API_KEY: 'user-router', CANTO_GEN_API_KEY: 'user-tts',
    SAAS_MODE: '0', PATH: 'forged-path', HOME: 'forged-home', NODE_OPTIONS: '--require=forged',
    SUPABASE_SERVICE_ROLE_KEY: 'database-secret', BYOK_ENCRYPTION_KEY: 'master-secret',
    CANTOGEN_API_KEY: 'platform-alias', SYNC_API_KEY: 'platform-alias' }, { PATH: 'trusted-path', ...platform });
  assert.equal(env.SAAS_MODE, '1');
  assert.equal(env.PATH, 'trusted-path');
  assert.equal(env.HOME, '/tmp');
  assert.equal(env.OPENROUTER_API_KEY, 'user-router');
  for (const key of ['NODE_OPTIONS','SUPABASE_SERVICE_ROLE_KEY','BYOK_ENCRYPTION_KEY','CANTOGEN_API_KEY','SYNC_API_KEY']) {
    assert.equal(env[key], undefined);
  }
});

test('SaaS helpers ignore real dotenv secrets and inherited aliases while CLI behavior stays intact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-byok-env-'));
  const file = path.join(dir, '.env');
  fs.writeFileSync(file, 'SYNC_API_KEY=dotenv-sync\nCANTOGEN_API_KEY=dotenv-tts\nPLATFORM_ONLY_SECRET=dotenv-secret\n');
  const common = new URL('../../../scripts/lib/common.mjs', import.meta.url).href;
  const script = `const {loadDotEnv,env,hasEnv,requireEnv}=await import(${JSON.stringify(common)});
    loadDotEnv(${JSON.stringify(file)});
    let required;try{required=requireEnv('CANTO_GEN_API_KEY',['CANTOGEN_API_KEY'])}catch{required='missing'}
    console.log(JSON.stringify({alias:env('SYNC_API_KEY'),present:hasEnv('SYNCLABS_API_KEY',['SYNC_API_KEY']),
      required,secret:process.env.PLATFORM_ONLY_SECRET}));`;
  const execute = (saas, aliases = {}) => JSON.parse(execFileSync(process.execPath, ['--input-type=module','-e',script], {
    env: { SystemRoot: process.env.SystemRoot, SAAS_MODE: saas, ...aliases },
    encoding: 'utf8', timeout: 5000,
  }));
  try {
    assert.deepEqual(execute('1'), { present: false, required: 'missing' });
    assert.deepEqual(execute('1', { SYNC_API_KEY: 'inherited-sync', CANTOGEN_API_KEY: 'inherited-tts' }),
      { present: false, required: 'missing' });
    assert.deepEqual(execute('0'), { alias: 'dotenv-sync', present: true, required: 'dotenv-tts', secret: 'dotenv-secret' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
