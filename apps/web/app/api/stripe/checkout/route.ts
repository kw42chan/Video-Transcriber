import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getStripe } from '@/lib/stripe';

export async function POST() {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: 'Stripe not configured — set STRIPE_SECRET_KEY and STRIPE_PRICE_ID' },
      { status: 503 }
    );
  }

  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    return NextResponse.json({ error: 'STRIPE_PRICE_ID missing' }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  const service = createServiceClient();
  if (!service) return NextResponse.json({ error: 'Billing unavailable' }, { status: 503 });
  try {
    const { data: existing, error: readError } = await service
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (readError) throw readError;

    let customerId = existing?.stripe_customer_id ?? undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      }, { idempotencyKey: `customer:${user.id}` });
      customerId = customer.id;
      const { error: saveError } = await service.from('subscriptions').upsert({
        user_id: user.id,
        stripe_customer_id: customerId,
        status: 'inactive',
      }, { onConflict: 'user_id', ignoreDuplicates: true });
      if (saveError) throw saveError;
      const { error: updateError } = await service.from('subscriptions')
        .update({ stripe_customer_id: customerId }).eq('user_id', user.id).is('stripe_customer_id', null);
      if (updateError) throw updateError;
      const { data: saved, error: mappingError } = await service.from('subscriptions')
        .select('stripe_customer_id').eq('user_id', user.id).single();
      if (mappingError || !saved?.stripe_customer_id) throw new Error('Customer mapping unavailable');
      customerId = saved.stripe_customer_id;
    }

    const active = await stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 1 });
    if (active.data.length) return NextResponse.json({ error: 'A subscription is already active. Manage it in billing settings.' }, { status: 409 });
    const { data: attempt, error: attemptError } = await service.rpc('reserve_checkout', { p_user_id: user.id });
    if (attemptError?.code === '42501') return NextResponse.json({ error: 'A subscription is already active. Manage it in billing settings.' }, { status: 409 });
    if (attemptError || typeof attempt?.attemptId !== 'string' || !Number.isInteger(attempt.expiresAt)
      || attempt.customerId !== customerId) throw new Error('Checkout reservation unavailable');
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/dashboard?checkout=success`,
      cancel_url: `${appUrl}/pricing?checkout=cancel`,
      metadata: { supabase_user_id: user.id },
      client_reference_id: attempt.attemptId,
      expires_at: attempt.expiresAt,
    }, { idempotencyKey: `checkout:${attempt.attemptId}` });
    if (session.status === 'complete') return NextResponse.json({ error: 'Checkout already completed. Refresh your account.' }, { status: 409 });
    if (session.status === 'expired' || !session.url) throw new Error('Checkout is unavailable');
    return NextResponse.json({ url: session.url });
  } catch {
    return NextResponse.json({ error: 'Could not start checkout' }, { status: 503 });
  }
}
