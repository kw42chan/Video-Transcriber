// Run inside the intended Linux worker image before enabling production jobs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runMedia } from './lib/media-sandbox.mjs';

assert.equal(process.platform, 'linux', 'Sandbox smoke test requires Linux');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-sandbox-test-'));
const job = path.join(root, 'job');
fs.mkdirSync(job);
fs.writeFileSync(path.join(job, 'allowed.txt'), 'allowed');
fs.writeFileSync(path.join(root, 'private.txt'), 'private');
process.env.SAAS_MODE = '1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sandbox-test-secret';
const netNamespace = fs.readlinkSync('/proc/self/ns/net');
const pidNamespace = fs.readlinkSync('/proc/self/ns/pid');
try {
  const { stdout } = await runMedia(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict'; import fs from 'node:fs';
    assert.notEqual(process.getuid(), 0);
    assert.equal(process.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
    assert.equal(fs.readFileSync(${JSON.stringify(path.join(job,'allowed.txt'))}, 'utf8'), 'allowed');
    assert.equal(fs.existsSync(${JSON.stringify(path.join(root,'private.txt'))}), false);
    assert.notEqual(fs.readlinkSync('/proc/self/ns/net'), ${JSON.stringify(netNamespace)});
    assert.notEqual(fs.readlinkSync('/proc/self/ns/pid'), ${JSON.stringify(pidNamespace)});
    fs.writeFileSync(${JSON.stringify(path.join(job,'output.txt'))}, 'output');
    assert.throws(()=>fs.writeFileSync('/usr/sandbox-write-test', 'forbidden'));
    console.log('Sandbox filesystem, credential, user and namespace checks passed');
  `], job, { timeout: 10000 });
  console.log(stdout.trim());
} finally { fs.rmSync(root, { recursive: true, force: true }); }
