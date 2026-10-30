import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { JobUploadForm } from './upload-form';

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: profile }, { data: sub }, { data: jobs }] = await Promise.all([
    supabase.from('profiles').select('trial_used, byok_enabled').eq('id', user!.id).single(),
    supabase.from('subscriptions').select('status, current_period_end').eq('user_id', user!.id).maybeSingle(),
    supabase.from('jobs').select('*').eq('user_id', user!.id).order('created_at', { ascending: false }).limit(20),
  ]);

  const subActive =
    sub?.status === 'active' &&
    (!sub.current_period_end || new Date(sub.current_period_end) > new Date());

  return (
    <>
      <h1>控制台</h1>
      <p className="muted">
        {subActive
          ? '訂閱使用中'
          : profile?.byok_enabled
            ? 'BYOK 模式'
            : profile?.trial_used
              ? '試用已用完 — 請訂閱'
              : '尚有 1 次免費試用（建議 ≤60 秒）'}
        {!subActive && !profile?.byok_enabled && profile?.trial_used ? (
          <>
            {' '}
            <Link href="/pricing">前往訂閱</Link>
          </>
        ) : null}
      </p>

      <JobUploadForm
        canUpload={subActive || profile?.byok_enabled || !profile?.trial_used}
      />

      <h2 style={{ marginTop: '2rem' }}>工作紀錄</h2>
      {!jobs?.length ? (
        <p className="muted">尚未建立工作</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {jobs.map((job) => (
            <li key={job.id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                <div>
                  <code>{job.id.slice(0, 8)}…</code>
                  <span className={`status-${job.status}`} style={{ marginLeft: '0.75rem' }}>
                    {job.status}
                  </span>
                  {job.error ? (
                    <p className="muted" style={{ fontSize: '0.85rem' }}>
                      {job.error}
                    </p>
                  ) : null}
                </div>
                <Link href={`/dashboard/jobs/${job.id}`}>詳情</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
