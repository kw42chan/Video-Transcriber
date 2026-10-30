import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canCreateJob } from '@/lib/access';

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const jobId = body.jobId as string | undefined;
  const inputPath = body.inputPath as string | undefined;
  const durationSeconds = body.durationSeconds as number | null | undefined;

  if (!jobId || !inputPath?.startsWith('user-uploads/')) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const [{ data: profile }, { data: sub }] = await Promise.all([
    supabase.from('profiles').select('trial_used, byok_enabled').eq('id', user.id).single(),
    supabase.from('subscriptions').select('status, current_period_end').eq('user_id', user.id).maybeSingle(),
  ]);

  if (!profile) return NextResponse.json({ error: 'Profile missing' }, { status: 400 });

  const access = canCreateJob(profile, sub, durationSeconds ?? 0);
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason ?? 'Forbidden' }, { status: 403 });
  }

  const { data: job, error } = await supabase
    .from('jobs')
    .insert({
      id: jobId,
      user_id: user.id,
      status: 'pending',
      input_path: inputPath,
      duration_seconds: durationSeconds,
    })
    .select('id')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (access.consumesTrial) {
    await supabase.from('profiles').update({ trial_used: true }).eq('id', user.id);
  }

  return NextResponse.json({ id: job.id });
}
