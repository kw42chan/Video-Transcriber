import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { createServiceClient } from '@/lib/supabase/server';

export async function POST(req: Request) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !webhookSecret) {
    return NextResponse.json({ error: 'Stripe webhook not configured' }, { status: 503 });
  }

  const body = await req.text();
  const sig = req.headers.get('stripe-signature');
  if (!sig) return NextResponse.json({ error: 'No signature' }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid signature';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const admin = createServiceClient();
  if (!admin) return NextResponse.json({ error: 'Service role missing' }, { status: 500 });
  const db = admin;

  async function upsertSub(
    userId: string,
    customerId: string,
    subscription: Stripe.Subscription
  ) {
    await db.from('subscriptions').upsert({
      user_id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      status: subscription.status,
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
    });
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.supabase_user_id;
      if (userId && session.subscription && session.customer) {
        const sub = await stripe.subscriptions.retrieve(String(session.subscription));
        await upsertSub(userId, String(session.customer), sub);
      }
      break;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = String(subscription.customer);
      const { data: row } = await db
        .from('subscriptions')
        .select('user_id')
        .eq('stripe_customer_id', customerId)
        .maybeSingle();
      if (row?.user_id) {
        await upsertSub(row.user_id, customerId, subscription);
      }
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
