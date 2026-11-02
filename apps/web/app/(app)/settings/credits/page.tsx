import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { creditAvailableFromAccount } from '@/lib/credits';
import { formatCreditSeconds } from '@/lib/access';

export default async function CreditsSettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: acct }, { data: sub }, { data: ledger }] = await Promise.all([
    supabase.from('credit_accounts').select('monthly_seconds, topup_seconds, reserved_seconds, updated_at').eq('user_id', user!.id).maybeSingle(),
    supabase.from('subscriptions').select('status, plan_key, current_period_end').eq('user_id', user!.id).maybeSingle(),
    supabase.from('credit_ledger').select('kind, amount_seconds, created_at, metadata').eq('user_id', user!.id).order('created_at', { ascending: false }).limit(20),
  ]);

  const avail = creditAvailableFromAccount(acct);

  return (
    <>
      <p><Link href="/dashboard">← 返回項目庫</Link></p>
      <h1>秒數餘額</h1>
      <p className="muted">
        成功唇形同步先會扣秒；失敗工作會釋放預留。本月訂閱秒數喺帳單週期結束時清零，加購秒數保留。
      </p>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <p><strong>{formatCreditSeconds(avail)}</strong> 可用</p>
        <ul>
          <li>本月配額：{formatCreditSeconds(Number(acct?.monthly_seconds ?? 0))}</li>
          <li>加購結餘：{formatCreditSeconds(Number(acct?.topup_seconds ?? 0))}</li>
          <li>處理中預留：{formatCreditSeconds(Number(acct?.reserved_seconds ?? 0))}</li>
        </ul>
        {sub?.plan_key ? (
          <p className="muted">訂閱：{sub.plan_key} ({sub.status})</p>
        ) : null}
        <p><Link className="btn" href="/pricing">加購或升級方案</Link></p>
      </div>

      <h2>最近紀錄</h2>
      {!ledger?.length ? (
        <p className="muted">尚無紀錄。</p>
      ) : (
        <table>
          <thead>
            <tr><th>時間</th><th>類型</th><th>秒數</th></tr>
          </thead>
          <tbody>
            {ledger.map((row, i) => (
              <tr key={i}>
                <td>{new Date(row.created_at).toLocaleString('zh-HK')}</td>
                <td>{row.kind}</td>
                <td>{Number(row.amount_seconds) > 0 ? '+' : ''}{Number(row.amount_seconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
