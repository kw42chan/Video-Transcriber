import { DashboardWorkspace } from './dashboard-workspace';
import { createClient } from '@/lib/supabase/server';
import { canCreateJob, formatCreditSeconds } from '@/lib/access';
import { creditAvailableFromAccount } from '@/lib/credits';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: profile }, { data: subscription }, { data: credits }, { data: jobs }] = await Promise.all([
    supabase.from('profiles').select('trial_used, byok_enabled').eq('id', user!.id).maybeSingle(),
    supabase.from('subscriptions').select('status, current_period_end, plan_key').eq('user_id', user!.id).maybeSingle(),
    supabase.from('credit_accounts').select('monthly_seconds, topup_seconds, reserved_seconds').eq('user_id', user!.id).maybeSingle(),
    supabase.from('jobs').select('id,status,input_path,error,metadata,created_at,updated_at').eq('user_id', user!.id).order('updated_at', { ascending: false }).limit(50),
  ]);

  const creditView = {
    availableSeconds: creditAvailableFromAccount(credits),
    monthlySeconds: Number(credits?.monthly_seconds ?? 0),
    topupSeconds: Number(credits?.topup_seconds ?? 0),
    reservedSeconds: Number(credits?.reserved_seconds ?? 0),
  };

  const access = canCreateJob(
    {
      trial_used: Boolean(profile?.trial_used),
      byok_enabled: Boolean(profile?.byok_enabled),
    },
    subscription,
    creditView,
    0
  );

  const subscriptionActive = subscription?.status === 'active'
    && (!subscription.current_period_end || new Date(subscription.current_period_end) > new Date());

  let planLabel: string;
  if (profile?.byok_enabled) {
    planLabel = 'Bring your own keys is enabled — platform seconds are not debited.';
  } else if (!profile?.trial_used) {
    planLabel = 'Free trial available for one job (≤60s).';
  } else if (creditView.availableSeconds > 0) {
    planLabel = `Platform credits: ${formatCreditSeconds(creditView.availableSeconds)} available (${formatCreditSeconds(creditView.monthlySeconds)} monthly + ${formatCreditSeconds(creditView.topupSeconds)} top-up, ${formatCreditSeconds(creditView.reservedSeconds)} reserved).`;
  } else if (subscriptionActive) {
    planLabel = 'Subscription active but no seconds left this period — buy a top-up or wait for renewal.';
  } else {
    planLabel = 'Trial used — choose a plan or top-up to create another project.';
  }

  return (
    <DashboardWorkspace
      jobs={jobs ?? []}
      canUpload={access.allowed}
      planLabel={planLabel}
      creditSummary={creditView}
    />
  );
}
