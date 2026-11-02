import { ABS_MAX_DURATION_SEC, TRIAL_MAX_DURATION_SEC } from './duration.js';

export type AccessProfile = {
  trial_used: boolean;
  byok_enabled: boolean;
};

export type AccessSubscription = {
  status: string;
  current_period_end: string | null;
  plan_key?: string | null;
} | null;

export type AccessCredits = {
  /** monthly + topup − reserved (platform pool). */
  availableSeconds: number;
  monthlySeconds: number;
  topupSeconds: number;
  reservedSeconds: number;
};

export function canCreateJob(
  profile: AccessProfile,
  sub: AccessSubscription,
  credits: AccessCredits,
  durationSec: number
): { allowed: boolean; reason?: string; consumesTrial?: boolean; billingMode?: 'trial' | 'byok' | 'platform' } {
  if (durationSec > ABS_MAX_DURATION_SEC) {
    return {
      allowed: false,
      reason: `影片長度不可超過 ${ABS_MAX_DURATION_SEC} 秒`,
    };
  }

  if (profile.byok_enabled) {
    return { allowed: true, billingMode: 'byok' };
  }

  if (!profile.trial_used) {
    if (durationSec > TRIAL_MAX_DURATION_SEC) {
      return {
        allowed: false,
        reason: `免費試用請使用 ≤${TRIAL_MAX_DURATION_SEC} 秒的片段`,
      };
    }
    return { allowed: true, consumesTrial: true, billingMode: 'trial' };
  }

  if (credits.availableSeconds <= 0) {
    const subActive =
      sub?.status === 'active' &&
      (!sub.current_period_end || new Date(sub.current_period_end) > new Date());
    return {
      allowed: false,
      reason: subActive
        ? '本月秒數已用完，可加購 top-up 或等下個帳單週期'
        : '試用已用完，請訂閱方案或加購秒數（或聯絡管理員啟用 BYOK）',
    };
  }

  if (durationSec > 0 && credits.availableSeconds < durationSec) {
    return {
      allowed: false,
      reason: `餘額不足：需要 ${Math.ceil(durationSec)} 秒，可用 ${Math.floor(credits.availableSeconds)} 秒`,
    };
  }

  return { allowed: true, billingMode: 'platform' };
}

export function formatCreditSeconds(seconds: number): string {
  const n = Math.max(0, Math.floor(seconds));
  return `${n} 秒`;
}
