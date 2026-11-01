import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';
import { jobInputPath } from '../src/upload-path.ts';

async function loadRoute(file, { user = { id: '11111111-1111-4111-8111-111111111111', email: 'test@example.test' }, service, stripe } = {}) {
  const source = await fs.readFile(new URL(`../../../apps/web/app/api/${file}/route.ts`, import.meta.url), 'utf8');
  const mocks = {
    'next/server': { NextResponse: { json: (value, init) => Response.json(value, init) } },
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) },
      from() { throw new Error('Client-session billing write'); } }), createServiceClient: () => service },
    '@video-transcriber/shared': { jobInputPath },
    '@/lib/stripe': { getStripe: () => stripe }, 'stripe': { default: {} },
  };
  const context = vm.createContext({ Response, Date, process: { env: {
    STRIPE_WEBHOOK_SECRET: 'test', STRIPE_PRICE_ID: 'price_test', NEXT_PUBLIC_APP_URL: 'https://example.test',
  } } });
  const module = new vm.SourceTextModule(stripTypeScriptTypes(source), { context });
  await module.link((name) => new vm.SyntheticModule(Object.keys(mocks[name]), function () {
    for (const [key,value] of Object.entries(mocks[name])) this.setExport(key,value);
  }, { context }));
  await module.evaluate();
  return module.namespace.POST;
}
const request = (body = {}) => new Request('https://example.test/api/test', {
  method: 'POST', body: JSON.stringify(body), headers: { 'stripe-signature': 'signed' },
});

test('upload reservation requires authentication, valid media and reserved capacity', async () => {
  const args = [];
  let signed = 0;
  const service = { rpc: async (_name, value) => { args.push(value); return { error: { code: '54000', message: 'Quota reached' } }; },
    storage: { from: () => ({ createSignedUploadUrl: async () => { signed++; } }) } };
  const post = await loadRoute('uploads/reserve', { service });
  const payload = { jobId: '22222222-2222-4222-8222-222222222222', fileName: 'video.mp4', user_id: 'foreign' };
  assert.equal((await post(request({ ...payload, fileName: 'video.html' }))).status, 400);
  assert.equal((await post(request(payload))).status, 429);
  assert.equal(signed, 0);
  assert.equal(args[0].p_user_id, '11111111-1111-4111-8111-111111111111');
  assert.match(args[0].p_object_path, /^11111111-/);
  const unauthenticated = await loadRoute('uploads/reserve', { service, user: null });
  assert.equal((await unauthenticated(request(payload))).status, 401);
});

test('upload authorization uses session-bound reservations instead of reusable bearer tokens', async () => {
  const service = { rpc: async () => ({ error: null }),
    storage: { from() { throw new Error('Must not issue bearer upload tokens'); } } };
  const post = await loadRoute('uploads/reserve', { service });
  const response = await post(request({ jobId: '22222222-2222-4222-8222-222222222222', fileName: 'video.mp4' }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.token, undefined);
  assert.equal(body.objectPath, '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/input.mp4');
});

function billing({ readFailure = false, beginFailure = false, writeFailure = false, stale = false, duplicate = false } = {}) {
  const calls = [];
  const service = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({
      data: { user_id: 'owner' }, error: readFailure ? {} : null,
    }) }) }) }),
    rpc: async (name, values) => {
      calls.push([name, values]);
      if (name === 'begin_billing_sync') return { data: duplicate ? 0 : 2, error: beginFailure ? {} : null };
      return { data: !stale, error: writeFailure ? {} : null };
    },
  };
  const stripe = {
    webhooks: { constructEvent: () => ({ id: 'event', type: 'customer.subscription.updated',
      data: { object: { customer: 'customer', status: 'active' } } }) },
    customers: { retrieve: async () => ({ metadata: { supabase_user_id: 'owner' } }) },
    subscriptions: { list: () => ({ autoPagingToArray: async () => [{ id: 'sub', status: 'canceled',
      current_period_end: 1900000000, created: 1, items: { data: [{ price: { id: 'price_test' } }] } }] }) },
  };
  return { service, stripe, calls };
}

test('billing retries database failures and stale handlers, and reconciles current Stripe state', async () => {
  for (const options of [{}, { readFailure: true }, { beginFailure: true }, { writeFailure: true }, { stale: true }, { duplicate: true }]) {
    const fixture = billing(options);
    const post = await loadRoute('stripe/webhook', fixture);
    const response = await post(request());
    assert.equal(response.status, Object.keys(options).some((key) => key !== 'duplicate') ? 503 : 200);
    const completion = fixture.calls.find(([name]) => name === 'complete_billing_sync');
    if (completion) assert.equal(completion[1].p_status, 'canceled');
    if (options.duplicate) assert.equal(fixture.calls.length, 1);
  }
});

test('invalid webhook signatures never write billing state', async () => {
  const fixture = billing();
  fixture.stripe.webhooks.constructEvent = () => { throw new Error('Invalid'); };
  const post = await loadRoute('stripe/webhook', fixture);
  assert.equal((await post(request())).status, 400);
  assert.equal(fixture.calls.length, 0);
});

test('checkout stops on server mapping failure before creating a payment session', async () => {
  let sessions = 0;
  const post = await loadRoute('stripe/checkout', { service: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ error: {} }) }) }) }),
  }, stripe: { checkout: { sessions: { create: async () => { sessions++; } } } } });
  assert.equal((await post()).status, 503);
  assert.equal(sessions, 0);
});

test('deleted known customers revoke access without retrying unavailable subscription history', async () => {
  const fixture = billing();
  fixture.stripe.customers.retrieve = async () => ({ id: 'customer', deleted: true });
  fixture.stripe.subscriptions.list = () => { throw new Error('Deleted customer history must not be required'); };
  const post = await loadRoute('stripe/webhook', fixture);
  assert.equal((await post(request())).status, 200);
  const completion = fixture.calls.find(([name]) => name === 'complete_billing_sync')[1];
  assert.equal(completion.p_status, 'inactive');
  assert.equal(completion.p_subscription_id, null);
  assert.equal(completion.p_period_end, null);
});

test('webhook rejects conflicting mappings and retries provider failures', async () => {
  const conflicting = billing();
  conflicting.stripe.customers.retrieve = async () => ({ metadata: { supabase_user_id: 'foreign' } });
  const conflictPost = await loadRoute('stripe/webhook', conflicting);
  assert.equal((await conflictPost(request())).status, 503);
  assert.equal(conflicting.calls.length, 0);
  const unavailable = billing();
  unavailable.stripe.subscriptions.list = () => ({ autoPagingToArray: async () => { throw new Error('Stripe unavailable'); } });
  const failedPost = await loadRoute('stripe/webhook', unavailable);
  assert.equal((await failedPost(request())).status, 503);
  assert.equal(unavailable.calls.some(([name]) => name === 'complete_billing_sync'), false);
});

test('unrelated active subscriptions cannot grant the configured plan', async () => {
  const fixture = billing();
  fixture.stripe.subscriptions.list = () => ({ autoPagingToArray: async () => [{ id: 'other-sub', status: 'active',
    current_period_end: 1900000000, created: 1, items: { data: [{ price: { id: 'unrelated-price' } }] } }] });
  const post = await loadRoute('stripe/webhook', fixture);
  assert.equal((await post(request())).status, 200);
  assert.equal(fixture.calls.find(([name]) => name === 'complete_billing_sync')[1].p_status, 'inactive');
});

test('checkout reuses database-reserved identity and exact expiry for Stripe idempotency', async () => {
  const sessions = [];
  const service = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { stripe_customer_id: 'cus_saved' } }) }) }) }),
    rpc: async (name) => {
      assert.equal(name, 'reserve_checkout');
      return { data: { attemptId: 'durable-attempt', expiresAt: 1900000000, customerId: 'cus_saved' } };
    },
  };
  const stripe = { subscriptions: { list: async () => ({ data: [] }) }, checkout: { sessions: {
    create: async (parameters, options) => {
      sessions.push([parameters, options]);
      return { status: 'open', url: 'https://checkout.stripe.test/session' };
    },
  } } };
  const post = await loadRoute('stripe/checkout', { service, stripe });
  assert.equal((await post()).status, 200);
  assert.equal((await post()).status, 200);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0][1].idempotencyKey, 'checkout:durable-attempt');
  assert.equal(sessions[0][1].idempotencyKey, sessions[1][1].idempotencyKey);
  assert.equal(sessions[0][0].expires_at, 1900000000);
  assert.equal(sessions[0][0].customer, 'cus_saved');
});
