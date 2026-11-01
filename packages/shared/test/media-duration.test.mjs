import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { durationLimit, validateProbe, verifyMediaDuration } from '../../../scripts/lib/media-duration.mjs';

const probe = (duration) => ({ format: { duration }, streams: [{ codec_type: 'video' }] });

test('trial and paid policy boundaries reject unverified and excessive duration', () => {
  assert.equal(validateProbe(probe('60'), 60), 60);
  assert.equal(validateProbe(probe('300'), 300), 300);
  for (const value of [undefined, null, '', 'N/A', 'NaN', 'Infinity', '-1', '0', '60.001']) {
    assert.throws(() => validateProbe(probe(value), 60));
  }
  assert.throws(() => validateProbe(probe('300.001'), 300));
  assert.throws(() => validateProbe({ ...probe('1'), streams: [{ codec_type: 'audio' }] }, 60));
  assert.throws(() => validateProbe({ format: { duration: '1' }, streams: [
    { codec_type: 'video', duration: '61' },
  ] }, 60));
  for (const value of [0, 61, 600, NaN, Infinity, '']) assert.throws(() => durationLimit(value));
});

test('probe is time bounded, limits output and propagates unavailable/corrupt media failures', async () => {
  const result = await verifyMediaDuration('/input.mp4', 60, async (cmd, args, options) => {
    assert.equal(cmd, 'ffprobe');
    assert.equal(options.timeout, 15000);
    assert.equal(options.maxOutput, 1024 * 1024);
    assert.ok(args.includes('-protocol_whitelist'));
    return { stdout: JSON.stringify(probe('12.5')) };
  });
  assert.equal(result, 12.5);
  await assert.rejects(verifyMediaDuration('/input', 60, async () => { throw new Error('timeout'); }));
  await assert.rejects(verifyMediaDuration('/input', 60, async () => ({ stdout: 'broken' })));
});

test('real pipeline rejects overlong/corrupt input before extraction and accepts valid preflight', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-duration-'));
  const pipeline = path.join(root, 'scripts/run-saas-pipeline.mjs');
  const input = path.join(dir, 'video.mp4');
  const run = (...args) => execFileSync(process.execPath, [pipeline, '--work-dir', dir, ...args], {
    cwd: root, encoding: 'utf8', timeout: 25000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i',
      'color=c=black:s=16x16:r=1', '-t', '61', '-c:v', 'mpeg4', input], { timeout: 20000 });
    assert.throws(() => run(), /60-second limit/);
    assert.equal(fs.existsSync(path.join(dir, 'audio_16k.wav')), false);
    assert.equal(fs.existsSync(path.join(dir, 'en_segments.json')), false);
    assert.equal(JSON.parse(run('--max-duration-seconds', '300', '--validate-only')).durationSeconds, 61);
    assert.throws(() => run('--max-duration-seconds', '9999'), /Invalid media duration policy/);
    fs.writeFileSync(input, 'not a video');
    assert.throws(() => run());
    assert.equal(fs.existsSync(path.join(dir, 'audio_16k.wav')), false);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i',
      'color=c=black:s=16x16:r=1', '-t', '1', '-c:v', 'mpeg4', input], { timeout: 20000 });
    assert.equal(JSON.parse(run('--validate-only')).durationSeconds, 1);
    assert.equal(fs.existsSync(path.join(dir, 'audio_16k.wav')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
