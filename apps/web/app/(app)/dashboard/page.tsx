import { DashboardWorkspace } from './dashboard-workspace';
import { createClient } from '@/lib/supabase/server';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: profile }, { data: subscription }, { data: jobs }] = await Promise.all([
    supabase.from('profiles').select('trial_used, byok_enabled').eq('id', user!.id).maybeSingle(),
    supabase.from('subscriptions').select('status, current_period_end').eq('user_id', user!.id).maybeSingle(),
    supabase.from('jobs').select('id,status,input_path,error,metadata,created_at,updated_at').eq('user_id', user!.id).order('updated_at', { ascending: false }).limit(50),
  ]);

  const subscriptionActive = subscription?.status === 'active'
    && (!subscription.current_period_end || new Date(subscription.current_period_end) > new Date());
  const byokEnabled = Boolean(profile?.byok_enabled);
  const trialUsed = Boolean(profile?.trial_used);
  const canUpload = subscriptionActive || byokEnabled || !trialUsed;
  const planLabel = subscriptionActive
    ? 'Your subscription is active.'
    : byokEnabled
      ? 'Bring your own keys is enabled.'
      : 'Your free trial has been used. Choose a plan to create another project.';

  return <DashboardWorkspace jobs={jobs ?? []} canUpload={canUpload} planLabel={planLabel} />;
}
