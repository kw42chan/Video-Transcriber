import { ABS_MAX_DURATION_SEC, TRIAL_MAX_DURATION_SEC } from '@video-transcriber/shared';

export type AccessProfile = {
  trial_used: boolean;
  byok_enabled: boolean;
};

export type AccessSubscription = {
  status: string;
  current_period_end: string | null;
} | null;

export function canCreateJob(
  profile: AccessProfile,
  sub: AccessSubscription,
  durationSec: number
): { allowed: boolean; reason?: string; consumesTrial?: boolean } {
  if (durationSec > ABS_MAX_DURATION_SEC) {
    return {
      allowed: false,
      reason: `影片長度不可超過 ${ABS_MAX_DURATION_SEC} 秒`,
    };
  }

  const subActive =
    sub?.status === 'active' &&
    (!sub.current_period_end || new Date(sub.current_period_end) > new Date());

  if (subActive || profile.byok_enabled) {
    return { allowed: true };
  }

  if (!profile.trial_used) {
    if (durationSec > TRIAL_MAX_DURATION_SEC) {
      return {
        allowed: false,
        reason: `免費試用請使用 ≤${TRIAL_MAX_DURATION_SEC} 秒的片段`,
      };
    }
    return { allowed: true, consumesTrial: true };
  }

  return {
    allowed: false,
    reason: '試用已用完，請訂閱或聯絡管理員啟用 BYOK',
  };
}
