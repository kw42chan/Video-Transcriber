import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isMediaDurationWithinLimit, parseMediaDuration } from '../src/media-duration.ts';

test('parses finite positive ffprobe durations', () => {
  assert.equal(parseMediaDuration('59.999\n'), 59.999);
  assert.throws(() => parseMediaDuration(''), /valid source video duration/);
  assert.throws(() => parseMediaDuration('N/A'), /valid source video duration/);
  assert.throws(() => parseMediaDuration('Infinity'), /valid source video duration/);
  assert.throws(() => parseMediaDuration('0'), /valid source video duration/);
  assert.throws(() => parseMediaDuration('-1'), /valid source video duration/);
});

test('enforces the trusted trial and paid duration thresholds inclusively', () => {
  assert.equal(isMediaDurationWithinLimit(60, 60), true);
  assert.equal(isMediaDurationWithinLimit(60.001, 60), false);
  assert.equal(isMediaDurationWithinLimit(300, 300), true);
  assert.equal(isMediaDurationWithinLimit(300.001, 300), false);
  assert.equal(isMediaDurationWithinLimit(Number.NaN, 300), false);
  assert.equal(isMediaDurationWithinLimit(20, Number.NaN), false);
});
