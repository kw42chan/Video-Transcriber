import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { SubscribeButton } from './subscribe-button';

export default async function PricingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let subStatus = 'none';
  if (user) {
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('status')
      .eq('user_id', user.id)
      .maybeSingle();
    subStatus = sub?.status ?? 'none';
  }

  return (
    <main className="container">
      <p>
        <Link href={user ? '/dashboard' : '/'}>← 返回</Link>
      </p>
      <h1>訂閱方案</h1>
      <div className="card">
        <h2>Pro 月費</h2>
        <p className="muted">無限次配音工作（公平使用），平台 API 由我方提供。</p>
        <p>新用戶：1 次免費試用（≤60 秒片段）。</p>
        {user ? (
          <>
            <p>
              目前狀態：<strong>{subStatus}</strong>
            </p>
            <SubscribeButton />
            <form action="/api/stripe/portal" method="post" style={{ marginTop: '0.75rem' }}>
              <button type="submit" className="btn secondary">
                管理訂閱（Customer Portal）
              </button>
            </form>
          </>
        ) : (
          <p>
            <Link className="btn" href="/login">
              登入以訂閱
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}
