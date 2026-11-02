import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getStripe } from '@/lib/stripe';
import {
  legacyStripePriceId,
  stripePriceIdForProduct,
} from '@/lib/billing-stripe';
import { isPlanKey, isTopupKey, type CheckoutProductKey } from '@video-transcriber/shared';

export async function POST(req: Request) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: 'Stripe not configured — set STRIPE_SECRET_KEY and plan/top-up price env vars' },
      { status: 503 }
    );
  }

  let product: CheckoutProductKey = 'pro';
  try {
    const body = await req.json();
    if (typeof body?.product === 'string') {
      product = body.product as CheckoutProductKey;
    }
  } catch {
    /* empty body → legacy default pro */
  }

  if (!isPlanKey(product) && !isTopupKey(product)) {
    return NextResponse.json({ error: 'Unknown product' }, { status: 400 });
  }

  let priceId = stripePriceIdForProduct(product);
  if (!priceId && isPlanKey(product) && product === 'pro') {
    priceId = legacyStripePriceId();
  }
  if (!priceId) {
    return NextResponse.json(
      { error: `Stripe price not configured for ${product}` },
      { status: 503 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  const { data: existing } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle();

  let customerId = existing?.stripe_customer_id ?? undefined;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
    await supabase.from('subscriptions').upsert({
      user_id: user.id,
      stripe_customer_id: customerId,
      status: 'inactive',
    });
  }

  const isSubscription = isPlanKey(product);
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: isSubscription ? 'subscription' : 'payment',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/dashboard?checkout=success`,
    cancel_url: `${appUrl}/pricing?checkout=cancel`,
    metadata: {
      supabase_user_id: user.id,
      product_key: product,
    },
    ...(isSubscription
      ? {
          subscription_data: {
            metadata: {
              supabase_user_id: user.id,
              plan_key: product,
            },
          },
        }
      : {}),
  });

  return NextResponse.json({ url: session.url });
}
