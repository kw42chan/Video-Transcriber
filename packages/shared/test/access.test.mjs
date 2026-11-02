import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canCreateJob } from '../dist/access.js';

const credits = (availableSeconds) => ({
  availableSeconds,
  monthlySeconds: availableSeconds,
  topupSeconds: 0,
  reservedSeconds: 0,
});

test('canCreateJob: BYOK always allowed', () => {
  const r = canCreateJob(
    { trial_used: true, byok_enabled: true },
    null,
    credits(0),
    120
  );
  assert.equal(r.allowed, true);
  assert.equal(r.billingMode, 'byok');
});

test('canCreateJob: trial when unused', () => {
  const r = canCreateJob(
    { trial_used: false, byok_enabled: false },
    null,
    credits(0),
    45
  );
  assert.equal(r.allowed, true);
  assert.equal(r.consumesTrial, true);
});

test('canCreateJob: trial rejects long video', () => {
  const r = canCreateJob(
    { trial_used: false, byok_enabled: false },
    null,
    credits(0),
    90
  );
  assert.equal(r.allowed, false);
});

test('canCreateJob: no credits after trial', () => {
  const r = canCreateJob(
    { trial_used: true, byok_enabled: false },
    { status: 'inactive', current_period_end: null },
    credits(0),
    10
  );
  assert.equal(r.allowed, false);
});

test('canCreateJob: platform credits allow job', () => {
  const r = canCreateJob(
    { trial_used: true, byok_enabled: false },
    { status: 'active', current_period_end: new Date(Date.now() + 86400000).toISOString() },
    credits(100),
    0
  );
  assert.equal(r.allowed, true);
  assert.equal(r.billingMode, 'platform');
});

test('canCreateJob: active sub but zero credits blocked', () => {
  const r = canCreateJob(
    { trial_used: true, byok_enabled: false },
    { status: 'active', current_period_end: new Date(Date.now() + 86400000).toISOString() },
    credits(0),
    0
  );
  assert.equal(r.allowed, false);
});
