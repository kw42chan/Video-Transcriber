import {
  BILLING_PLANS,
  TOPUP_PACKS,
  isPlanKey,
  isTopupKey,
  type CheckoutProductKey,
  type PlanKey,
} from '@video-transcriber/shared';

export function stripePriceIdForProduct(key: CheckoutProductKey): string | undefined {
  const envName = isPlanKey(key)
    ? BILLING_PLANS[key].stripePriceEnv
    : isTopupKey(key)
      ? TOPUP_PACKS[key].stripePriceEnv
      : undefined;
  if (!envName) return undefined;
  return process.env[envName]?.trim() || undefined;
}

export function planKeyFromPriceId(priceId: string): PlanKey | null {
  for (const plan of Object.values(BILLING_PLANS)) {
    const envVal = process.env[plan.stripePriceEnv]?.trim();
    if (envVal && envVal === priceId) return plan.key;
  }
  return null;
}

export function topupKeyFromPriceId(priceId: string): keyof typeof TOPUP_PACKS | null {
  for (const pack of Object.values(TOPUP_PACKS)) {
    const envVal = process.env[pack.stripePriceEnv]?.trim();
    if (envVal && envVal === priceId) return pack.key;
  }
  return null;
}

/** Legacy single-price env (maps to Pro plan when set). */
export function legacyStripePriceId(): string | undefined {
  return process.env.STRIPE_PRICE_ID?.trim() || undefined;
}
