import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChildEnv } from '../lib/child-env.mjs';

test('child environment excludes worker secrets unless explicitly scoped', () => {
  const source = {
    PATH: '/usr/bin',
    NODE_ENV: 'production',
    SUPABASE_SERVICE_ROLE_KEY: 'service-secret',
    BYOK_ENCRYPTION_KEY: 'encryption-secret',
    OPENROUTER_API_KEY: 'provider-secret',
  };

  const child = createChildEnv(source);
  assert.deepEqual(child, { PATH: '/usr/bin', NODE_ENV: 'production' });

  const translator = createChildEnv(source, {
    OPENROUTER_API_KEY: source.OPENROUTER_API_KEY,
    DOTENV_DISABLED: '1',
  });
  assert.equal(translator.OPENROUTER_API_KEY, 'provider-secret');
  assert.equal(translator.DOTENV_DISABLED, '1');
  assert.equal(translator.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(translator.BYOK_ENCRYPTION_KEY, undefined);
});

test('child environment construction does not mutate the worker environment', () => {
  const source = { PATH: '/usr/bin', SUPABASE_SERVICE_ROLE_KEY: 'service-secret' };
  createChildEnv(source, { CANTO_GEN_API_KEY: 'tts-secret' });
  assert.deepEqual(source, { PATH: '/usr/bin', SUPABASE_SERVICE_ROLE_KEY: 'service-secret' });
});
