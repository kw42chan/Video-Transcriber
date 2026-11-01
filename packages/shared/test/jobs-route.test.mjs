import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';
import { jobInputPath } from '../src/upload-path.ts';

const userId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';
const source = await fs.readFile(new URL('../../../apps/web/app/api/jobs/route.ts', import.meta.url), 'utf8');

async function route(user, { rpcError = null, serviceAvailable = true } = {}) {
  const inserts = [];
  const db = {
    auth: { getUser: async () => ({ data: { user } }) },
    from() { throw new Error('User-session DB writes must not be used for job creation'); },
  };
  const service = {
    async rpc(name, args) {
      assert.equal(name, 'create_job_with_trial');
      inserts.push(args);
      return { data: rpcError ? null : jobId, error: rpcError };
    },
  };
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/supabase/server': {
      createClient: async () => db,
      createServiceClient: () => serviceAvailable ? service : null,
    },
    '@video-transcriber/shared': { jobInputPath },
  };
  const module = new vm.SourceTextModule(stripTypeScriptTypes(source));
  await module.link((name) => new vm.SyntheticModule(Object.keys(mocks[name]), function () {
    for (const [key, value] of Object.entries(mocks[name])) this.setExport(key, value);
  }));
  await module.evaluate();
  return { post: module.namespace.POST, inserts };
}

const payload = {
  jobId, inputPath: `user-uploads/${userId}/${jobId}/input.mp4`,
  projectName: 'Test', fileName: 'video.mp4',
};
const request = (body) => new Request('https://example.test/api/jobs', {
  method: 'POST', body: JSON.stringify(body),
});

test('jobs API rejects foreign users, wrong buckets, and mismatched job paths before insert', async () => {
  const { post, inserts } = await route({ id: userId });
  for (const inputPath of [
    `user-uploads/other-user/${jobId}/input.mp4`,
    `job-outputs/${userId}/${jobId}/input.mp4`,
    `user-uploads/${userId}/other-job/input.mp4`,
    `user-uploads/${userId}/${jobId}/../input.mp4`,
    `user-uploads/${userId}/${jobId}/other.mp4`,
    null, 42, {},
  ]) {
    assert.equal((await post(request({ ...payload, inputPath }))).status, 400);
  }
  assert.equal(inserts.length, 0);
});

test('jobs API stores the server-derived owner path for a valid upload', async () => {
  const { post, inserts } = await route({ id: userId });
  assert.equal((await post(request(payload))).status, 200);
  assert.deepEqual(inserts[0], {
    p_user_id: userId, p_job_id: jobId, p_input_path: payload.inputPath,
    p_project_name: 'Test', p_file_name: 'video.mp4',
  });
});

test('jobs API requires authentication', async () => {
  const { post, inserts } = await route(null);
  assert.equal((await post(request(payload))).status, 401);
  assert.equal(inserts.length, 0);
});

test('jobs API ignores unverified duration and client entitlement/identity fields', async () => {
  const { post, inserts } = await route({ id: userId });
  for (const durationSeconds of [null, 0, -1, 9999, 'short']) {
    assert.equal((await post(request({
      ...payload, durationSeconds, user_id: 'other', trial_used: false, byok_enabled: true,
    }))).status, 200);
  }
  for (const args of inserts) {
    assert.equal(args.p_user_id, userId);
    assert.deepEqual(Object.keys(args).sort(), [
      'p_file_name', 'p_input_path', 'p_job_id', 'p_project_name', 'p_user_id',
    ]);
  }
});

test('jobs API maps atomic entitlement, missing profile, and duplicate errors', async () => {
  for (const [code, expected] of [['42501', 403], ['P0002', 400], ['22023', 400], ['23505', 409], ['54000', 429], ['XX000', 500]]) {
    const { post } = await route({ id: userId }, { rpcError: { code, message: 'Database error' } });
    const response = await post(request(payload));
    assert.equal(response.status, expected);
    if (expected === 500) assert.equal((await response.json()).error, 'Could not create job');
  }
});

test('jobs API fails closed if the service client is unavailable', async () => {
  const { post, inserts } = await route({ id: userId }, { serviceAvailable: false });
  assert.equal((await post(request(payload))).status, 503);
  assert.equal(inserts.length, 0);
});
