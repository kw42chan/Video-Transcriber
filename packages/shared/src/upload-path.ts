const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Match the existing browser upload layout without trusting a supplied path. */
export function jobInputPath(userId: string, jobId: unknown, fileName: string): string | null {
  if (typeof jobId !== 'string' || !UUID.test(jobId)) return null;
  const ext = fileName.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
  return `user-uploads/${userId}/${jobId}/input.${ext}`;
}

/** Validate before using service-role storage access, including for older jobs. */
export function userUploadObjectPath(inputPath: unknown, userId: string): string {
  const prefix = `user-uploads/${userId}/`;
  if (typeof inputPath !== 'string' || !inputPath.startsWith(prefix)) {
    throw new Error('Invalid job input path');
  }
  const suffix = inputPath.slice(prefix.length);
  if (!suffix || /[%\\\x00-\x1f\x7f]/.test(suffix) ||
      suffix.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Invalid job input path');
  }
  return inputPath.slice('user-uploads/'.length);
}
