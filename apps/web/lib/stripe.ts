import Stripe from 'stripe';

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key, { apiVersion: '2025-02-24.acacia', timeout: 10000, maxNetworkRetries: 1 });
}
