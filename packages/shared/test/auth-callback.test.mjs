import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await fs.readFile(
  new URL('../../../apps/web/app/auth/callback/route.ts', import.meta.url),
  'utf8'
);
const appOrigin = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

async function route() {
  const mocks = {
    'next/server': {
      NextResponse: { redirect: (url) => Response.redirect(url) },
    },
    '@/lib/supabase/server': {
      createClient: async () => ({
        auth: {
          exchangeCodeForSession: async () => ({ error: null }),
          verifyOtp: async () => ({ error: null }),
        },
      }),
    },
  };
  const module = new vm.SourceTextModule(stripTypeScriptTypes(source));
  await module.link((name) => new vm.SyntheticModule(Object.keys(mocks[name]), function () {
    for (const [key, value] of Object.entries(mocks[name])) this.setExport(key, value);
  }));
  await module.evaluate();
  return module.namespace.GET;
}

async function redirectLocation(get, params) {
  const request = new Request(`https://request.example/auth/callback?${params}`);
  const response = await get(request);
  assert.equal(response.status, 302);
  return response.headers.get('location');
}

test('auth callback rejects an encoded-backslash external redirect after code exchange', async () => {
  const get = await route();
  const params = new URLSearchParams({
    code: 'valid-code',
    next: String.fromCharCode(47, 92) + 'evil.example',
  });

  assert.equal(
    await redirectLocation(get, params),
    new URL('/dashboard', appOrigin).href
  );
});

test('auth callback preserves a same-origin destination after OTP verification', async () => {
  const get = await route();
  const params = new URLSearchParams({
    token_hash: 'valid-token',
    type: 'signup',
    next: '/settings?tab=keys',
  });

  assert.equal(
    await redirectLocation(get, params),
    new URL('/settings?tab=keys', appOrigin).href
  );
});
