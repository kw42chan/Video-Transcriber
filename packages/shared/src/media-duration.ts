/** Parse ffprobe's single-value duration output and reject invalid media metadata. */
export function parseMediaDuration(stdout: string): number {
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('Could not determine a valid source video duration');
  }
  return duration;
}

/** Use only a duration limit loaded from the server-owned job record. */
export function isMediaDurationWithinLimit(durationSeconds: number, limitSeconds: number): boolean {
  return Number.isFinite(durationSeconds)
    && durationSeconds > 0
    && Number.isFinite(limitSeconds)
    && limitSeconds > 0
    && durationSeconds <= limitSeconds;
}
