import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { CheckoutButton } from './subscribe-button';
import { BILLING_PLANS, TOPUP_PACKS, TRIAL_MAX_DURATION_SEC } from '@video-transcriber/shared';
import { creditAvailableFromAccount } from '@/lib/credits';

export default async function PricingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let subStatus = 'none';
  let planKey: string | null = null;
  let creditsLine = '';

  if (user) {
    const [{ data: sub }, { data: acct }] = await Promise.all([
      supabase.from('subscriptions').select('status, plan_key').eq('user_id', user.id).maybeSingle(),
      supabase.from('credit_accounts').select('monthly_seconds, topup_seconds, reserved_seconds').eq('user_id', user.id).maybeSingle(),
    ]);
    subStatus = sub?.status ?? 'none';
    planKey = sub?.plan_key ?? null;
    const avail = creditAvailableFromAccount(acct);
    creditsLine = `平台秒數餘額：${Math.floor(avail)} 秒（含本月 ${Math.floor(Number(acct?.monthly_seconds ?? 0))} + 加購 ${Math.floor(Number(acct?.topup_seconds ?? 0))}，處理中預留 ${Math.floor(Number(acct?.reserved_seconds ?? 0))}）`;
  }

  const plans = Object.values(BILLING_PLANS);
  const topups = Object.values(TOPUP_PACKS);

  return (
    <main className="container">
      <p>
        <Link href={user ? '/dashboard' : '/'}>← 返回</Link>
      </p>
      <h1>方案與加購</h1>
      <p className="muted">
        計費單位：成功輸出嘅唇形同步秒數（失敗工作唔會扣秒）。新用戶可享 1 次免費試用（≤{TRIAL_MAX_DURATION_SEC} 秒片段，唔扣付費秒數）。
      </p>

      {user ? (
        <p style={{ marginBottom: '1.25rem' }}>
          訂閱狀態：<strong>{subStatus}</strong>
          {planKey ? <> · 方案 <strong>{planKey}</strong></> : null}
          {creditsLine ? <> · {creditsLine}</> : null}
        </p>
      ) : null}

      <section style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', marginBottom: '2rem' }}>
        {plans.map((plan) => (
          <div className="card" key={plan.key}>
            <h2>{plan.nameZh} {plan.nameEn}</h2>
            <p>
              <strong>HK${plan.priceHkd}</strong> / 月
            </p>
            <p>{plan.seconds} 秒 / 帳單週期</p>
            <p className="muted" style={{ fontSize: '0.9rem' }}>
              未用晒嘅本月秒數會喺週期結束時清零；加購秒數保留。
            </p>
            {user ? (
              <CheckoutButton product={plan.key} label={`訂閱 ${plan.nameZh}`} />
            ) : (
              <Link className="btn" href="/login">
                登入以訂閱
              </Link>
            )}
          </div>
        ))}
      </section>

      <h2>加購秒數（一次性）</h2>
      <p className="muted">適合偶爾超額或唔想改月費方案；與訂閱共用同一秒數餘額。</p>
      <section style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginBottom: '2rem' }}>
        {topups.map((pack) => (
          <div className="card" key={pack.key}>
            <h3>{pack.nameZh}</h3>
            <p>
              <strong>HK${pack.priceHkd}</strong> → {pack.seconds} 秒
            </p>
            {user ? (
              <CheckoutButton product={pack.key} label="加購" variant="secondary" />
            ) : (
              <Link className="btn secondary" href="/login">
                登入以加購
              </Link>
            )}
          </div>
        ))}
      </section>

      {user ? (
        <form action="/api/stripe/portal" method="post">
          <button type="submit" className="btn secondary">
            管理訂閱（Customer Portal）
          </button>
        </form>
      ) : null}
    </main>
  );
}
