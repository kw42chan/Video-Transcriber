export {
  type ByokKeySet,
  type EncryptedByokPayload,
  encryptByokKeys,
  decryptByokKeys,
  maskByokKeys,
} from './byok.js';

export const JOB_STATUSES = ['pending', 'running', 'succeeded', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const TRIAL_MAX_DURATION_SEC = 60;
export const ABS_MAX_DURATION_SEC = 300;
