/** Display currency for plans and top-ups (Stripe charges use smallest unit: HKD cents). */
export const BILLING_CURRENCY = 'hkd' as const;

export type PlanKey = 'starter' | 'pro' | 'studio';
export type TopupKey = 'topup_100' | 'topup_320';

export type BillingPlan = {
  key: PlanKey;
  nameZh: string;
  nameEn: string;
  /** Price in HKD (major units). */
  priceHkd: number;
  /** Successful lipsync output seconds granted each billing period. */
  seconds: number;
  /** Env var holding Stripe Price id (`price_…`). */
  stripePriceEnv: string;
};

export type TopupPack = {
  key: TopupKey;
  nameZh: string;
  nameEn: string;
  priceHkd: number;
  seconds: number;
  stripePriceEnv: string;
};

/**
 * Monthly subscription buckets. Unused monthly seconds expire at period end (replaced on renewal).
 * Top-up seconds are stored separately and do not expire with the monthly bucket.
 */
export const BILLING_PLANS: Record<PlanKey, BillingPlan> = {
  starter: {
    key: 'starter',
    nameZh: '入門',
    nameEn: 'Starter',
    priceHkd: 148,
    seconds: 120,
    stripePriceEnv: 'STRIPE_PRICE_STARTER',
  },
  pro: {
    key: 'pro',
    nameZh: '專業',
    nameEn: 'Pro',
    priceHkd: 388,
    seconds: 360,
    stripePriceEnv: 'STRIPE_PRICE_PRO',
  },
  studio: {
    key: 'studio',
    nameZh: '工作室',
    nameEn: 'Studio',
    priceHkd: 788,
    seconds: 900,
    stripePriceEnv: 'STRIPE_PRICE_STUDIO',
  },
};

/** One-time credit packs (payment mode). Top-up balance does not expire with monthly renewal. */
export const TOPUP_PACKS: Record<TopupKey, TopupPack> = {
  topup_100: {
    key: 'topup_100',
    nameZh: '加購 100 秒',
    nameEn: '100s top-up',
    priceHkd: 98,
    seconds: 100,
    stripePriceEnv: 'STRIPE_PRICE_TOPUP_100',
  },
  topup_320: {
    key: 'topup_320',
    nameZh: '加購 320 秒',
    nameEn: '320s top-up',
    priceHkd: 288,
    seconds: 320,
    stripePriceEnv: 'STRIPE_PRICE_TOPUP_320',
  },
};

export const PLAN_KEYS = Object.keys(BILLING_PLANS) as PlanKey[];
export const TOPUP_KEYS = Object.keys(TOPUP_PACKS) as TopupKey[];

export type CheckoutProductKey = PlanKey | TopupKey;

export function isPlanKey(key: string): key is PlanKey {
  return key in BILLING_PLANS;
}

export function isTopupKey(key: string): key is TopupKey {
  return key in TOPUP_PACKS;
}

export function planSeconds(plan: PlanKey): number {
  return BILLING_PLANS[plan].seconds;
}

export function topupSeconds(pack: TopupKey): number {
  return TOPUP_PACKS[pack].seconds;
}

/** HKD major units → Stripe amount in cents (smallest currency unit). */
export function hkdToStripeCents(hkd: number): number {
  return Math.round(hkd * 100);
}
