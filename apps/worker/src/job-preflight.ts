import { isMediaDurationWithinLimit } from '@video-transcriber/shared';

type JobPreflightOptions = {
  jobId: string;
  durationLimitSeconds: number;
  probe: () => Promise<number>;
  finalize: (jobId: string, durationSeconds: number | null) => Promise<boolean>;
};

/** Measure media before processing and persist the result through the trusted RPC. */
export async function preflightJob({
  jobId,
  durationLimitSeconds,
  probe,
  finalize,
}: JobPreflightOptions): Promise<boolean> {
  let durationSeconds: number | null = null;
  try {
    durationSeconds = await probe();
  } catch {
    // The finalizer records an unreadable file as failed and releases trial access.
  }

  const withinLimit = durationSeconds !== null
    && isMediaDurationWithinLimit(durationSeconds, durationLimitSeconds);
  const accepted = await finalize(jobId, durationSeconds);
  return withinLimit && accepted;
}
