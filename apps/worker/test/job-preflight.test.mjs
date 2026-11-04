import assert from 'node:assert/strict';
import { test } from 'node:test';
import { preflightJob } from '../src/job-preflight.ts';

test('allows media at the trusted duration limit and finalizes its measured duration', async () => {
  const finalized = [];
  const allowed = await preflightJob({
    jobId: 'job-trial',
    durationLimitSeconds: 60,
    probe: async () => 60,
    finalize: async (...args) => { finalized.push(args); return true; },
  });

  assert.equal(allowed, true);
  assert.deepEqual(finalized, [['job-trial', 60]]);
});

test('does not authorize over-limit media and asks the database to reject it', async () => {
  const finalized = [];
  const allowed = await preflightJob({
    jobId: 'job-trial',
    durationLimitSeconds: 60,
    probe: async () => 60.001,
    finalize: async (...args) => { finalized.push(args); return false; },
  });

  assert.equal(allowed, false);
  assert.deepEqual(finalized, [['job-trial', 60.001]]);
});

test('finalizes an unreadable media file as a failed preflight', async () => {
  const finalized = [];
  const allowed = await preflightJob({
    jobId: 'job-trial',
    durationLimitSeconds: 60,
    probe: async () => { throw new Error('ffprobe timed out'); },
    finalize: async (...args) => { finalized.push(args); return false; },
  });

  assert.equal(allowed, false);
  assert.deepEqual(finalized, [['job-trial', null]]);
});

test('refuses to continue if the database declines a duration inside the local limit', async () => {
  const allowed = await preflightJob({
    jobId: 'job-paid',
    durationLimitSeconds: 300,
    probe: async () => 120,
    finalize: async () => false,
  });

  assert.equal(allowed, false);
});
