import path from 'node:path';
import { runMedia } from './media-sandbox.mjs';
import { ABS_MAX_DURATION_SEC, TRIAL_MAX_DURATION_SEC } from '@video-transcriber/shared';

const execute = (command, args, options) => runMedia(command, args, path.dirname(path.resolve(args.at(-1))), options);

// Only server-supported policies are accepted; CLI defaults to the safer one.
export function durationLimit(value = TRIAL_MAX_DURATION_SEC) {
  const limit = Number(value);
  if (limit !== TRIAL_MAX_DURATION_SEC && limit !== ABS_MAX_DURATION_SEC) throw new Error('Invalid media duration policy');
  return limit;
}

export function validateProbe(data, limit) {
  durationLimit(limit);
  const streams = data?.streams;
  if (!Array.isArray(streams) || !streams.some((s) => s.codec_type === 'video')) {
    throw new Error('Input must contain a video stream');
  }
  const duration = Number(data?.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Cannot verify media duration');
  // A stream longer than the container is also subject to the limit.
  const durations = [duration];
  for (const stream of streams) {
    if (stream.duration !== undefined && stream.duration !== 'N/A') {
      const seconds = Number(stream.duration);
      if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Invalid stream duration');
      durations.push(seconds);
    }
  }
  const verified = Math.max(...durations);
  if (verified > limit) throw new Error(`Video exceeds the ${limit}-second limit`);
  return verified;
}

export async function verifyMediaDuration(videoPath, limit = TRIAL_MAX_DURATION_SEC, run = execute) {
  durationLimit(limit);
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-protocol_whitelist', 'file',
    '-show_entries', 'format=duration:stream=codec_type,duration',
    '-of', 'json', videoPath,
  ], { timeout: 15000, maxOutput: 1024 * 1024 });
  return validateProbe(JSON.parse(stdout), limit);
}
