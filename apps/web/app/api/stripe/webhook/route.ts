import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { createServiceClient } from '@/lib/supabase/server';
import { planKeyFromPriceId, topupKeyFromPriceId } from '@/lib/billing-stripe';
import { TOPUP_PACKS, isPlanKey, planSeconds, topupSeconds } from '@video-transcriber/shared';

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
  const stripeClient = stripe;

  async function upsertSub(
    userId: string,
    customerId: string,
    subscription: Stripe.Subscription,
    planKey: string | null
  ) {
    await db.from('subscriptions').upsert({
      user_id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      status: subscription.status,
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      plan_key: planKey,
    });
  }

  function resolvePlanKey(sub: Stripe.Subscription, sessionMeta?: Stripe.Metadata): string | null {
    const fromMeta = sessionMeta?.plan_key ?? sub.metadata?.plan_key;
    if (typeof fromMeta === 'string' && isPlanKey(fromMeta)) return fromMeta;
    const priceId = sub.items.data[0]?.price?.id;
    if (priceId) return planKeyFromPriceId(priceId);
    return null;
  }

  async function grantMonthlyForInvoice(invoice: Stripe.Invoice) {
    const userId = invoice.metadata?.supabase_user_id
      ?? (typeof invoice.subscription === 'string'
        ? undefined
        : invoice.subscription?.metadata?.supabase_user_id);

    let resolvedUserId = typeof userId === 'string' ? userId : undefined;
    let planKey: string | null =
      typeof invoice.metadata?.plan_key === 'string' ? invoice.metadata.plan_key : null;

    const subId =
      typeof invoice.subscription === 'string'
        ? invoice.subscription
        : invoice.subscription?.id;

    if (subId) {
      const sub = await stripeClient.subscriptions.retrieve(subId);
      if (!resolvedUserId) {
        resolvedUserId = sub.metadata?.supabase_user_id;
      }
      if (!planKey) planKey = resolvePlanKey(sub);
    }

    if (!resolvedUserId || !planKey || !isPlanKey(planKey)) return;

    const seconds = planSeconds(planKey);
    await db.rpc('grant_monthly_credits', {
      p_user_id: resolvedUserId,
      p_seconds: seconds,
      p_idempotency_key: `invoice:${invoice.id}`,
      p_metadata: {
        plan_key: planKey,
        invoice_id: invoice.id,
        billing_reason: invoice.billing_reason,
      },
    });
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.supabase_user_id;
      if (!userId) break;

      if (session.mode === 'subscription' && session.subscription && session.customer) {
        const sub = await stripeClient.subscriptions.retrieve(String(session.subscription));
        const planKey = resolvePlanKey(sub, session.metadata ?? undefined);
        await upsertSub(userId, String(session.customer), sub, planKey);
      }

      if (session.mode === 'payment' && session.payment_status === 'paid') {
        const productKey = session.metadata?.product_key;
        let seconds: number | null = null;
        if (typeof productKey === 'string' && productKey in TOPUP_PACKS) {
          seconds = topupSeconds(productKey as keyof typeof TOPUP_PACKS);
        } else {
          const lineItems = await stripeClient.checkout.sessions.listLineItems(session.id, { limit: 5 });
          const priceId = lineItems.data[0]?.price?.id;
          if (priceId) {
            const topup = topupKeyFromPriceId(priceId);
            if (topup) seconds = topupSeconds(topup);
          }
        }
        if (seconds && seconds > 0) {
          await db.rpc('grant_topup_credits', {
            p_user_id: userId,
            p_seconds: seconds,
            p_idempotency_key: `checkout_session:${session.id}`,
            p_metadata: { session_id: session.id, product_key: productKey },
          });
        }
      }
      break;
    }
    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice;
      if (invoice.subscription) {
        await grantMonthlyForInvoice(invoice);
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
        const planKey = resolvePlanKey(subscription);
        await upsertSub(row.user_id, customerId, subscription, planKey);
      }
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
