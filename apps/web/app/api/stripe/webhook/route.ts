import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { createServiceClient } from '@/lib/supabase/server';

export async function POST(req: Request) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!stripe || !secret || !priceId) return NextResponse.json({ error: 'Billing unavailable' }, { status: 503 });
  const sig = req.headers.get('stripe-signature');
  if (!sig) return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  let event: Stripe.Event;
  try { event = stripe.webhooks.constructEvent(await req.text(), sig, secret); }
  catch { return NextResponse.json({ error: 'Invalid signature' }, { status: 400 }); }
  if (!['checkout.session.completed', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) {
    return NextResponse.json({ received: true });
  }
  const db = createServiceClient();
  if (!db) return NextResponse.json({ error: 'Billing unavailable' }, { status: 503 });
  try {
    const object = event.data.object as Stripe.Subscription | Stripe.Checkout.Session;
    const customerId = typeof object.customer === 'string' ? object.customer : object.customer?.id;
    if (!customerId) throw new Error('Missing customer');
    const { data: row, error: readError } = await db.from('subscriptions')
      .select('user_id').eq('stripe_customer_id', customerId).maybeSingle();
    if (readError) throw readError;
    const customer = await stripe.customers.retrieve(customerId);
    const metadataUser = customer.deleted ? undefined : customer.metadata.supabase_user_id;
    const userId = row?.user_id ?? metadataUser;
    // Account-wide Stripe events can include unrelated customers. They must not
    // create local entitlements or retry forever when no app mapping exists.
    if (!userId) return NextResponse.json({ received: true });
    if (row && metadataUser && metadataUser !== userId) throw new Error('Invalid customer mapping');
    const { data: version, error: beginError } = await db.rpc('begin_billing_sync', {
      p_event_id: event.id, p_user_id: userId, p_customer_id: customerId,
    });
    if (beginError) throw beginError;
    if (version === 0) return NextResponse.json({ received: true });
    if (typeof version !== 'number' || version <= 0) throw new Error('Invalid sync version');
    const subscriptions = customer.deleted ? [] : await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 })
      .autoPagingToArray({ limit: 1000 });
    const relevant = subscriptions.filter((sub) => sub.items.data.some((item) => item.price.id === priceId));
    relevant.sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || b.created - a.created);
    const current = relevant[0];
    const { data: completed, error: writeError } = await db.rpc('complete_billing_sync', {
      p_event_id: event.id, p_user_id: userId, p_version: version,
      p_subscription_id: current?.id ?? null, p_status: current?.status ?? 'inactive',
      p_period_end: current ? new Date(current.current_period_end * 1000).toISOString() : null,
    });
    if (writeError || completed !== true) throw new Error('Billing sync not committed');
    return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json({ error: 'Could not synchronize billing; retry required' }, { status: 503 });
  }
}
