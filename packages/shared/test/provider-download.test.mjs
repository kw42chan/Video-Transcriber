import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { downloadTo } from '../../../scripts/lib/lipsync.mjs';

test('provider downloads enforce declared size, require a body and stream valid media', async () => {
  const fetchBefore = globalThis.fetch;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'vt-provider-download-'));
  const output = path.join(dir,'audio.mp3');
  try {
    globalThis.fetch = async (_url, options) => {
      assert.ok(options.signal instanceof AbortSignal);
      return new Response('audio', { headers: { 'content-length': String(501*1024**2) } });
    };
    await assert.rejects(downloadTo('https://provider.test/audio', output), /size limit/);
    assert.equal(fs.existsSync(output), false);
    globalThis.fetch = async () => new Response(null);
    await assert.rejects(downloadTo('https://provider.test/audio', output), /no media/);
    globalThis.fetch = async () => new Response('audio');
    await downloadTo('https://provider.test/audio',output);
    assert.equal(fs.readFileSync(output,'utf8'),'audio');
  } finally {
    globalThis.fetch=fetchBefore;
    fs.rmSync(dir,{ recursive:true,force:true });
  }
});
