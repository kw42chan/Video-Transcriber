import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('byok_enabled')
    .eq('id', user.id)
    .single();

  return (
    <>
      <nav className="nav">
        <strong>Video Transcriber</strong>
        <Link href="/dashboard">控制台</Link>
        <Link href="/pricing">方案</Link>
        {profile?.byok_enabled ? <Link href="/settings/byok">BYOK 設定</Link> : null}
        <form action="/auth/signout" method="post" style={{ marginLeft: 'auto' }}>
          <button type="submit" className="btn secondary">
            登出
          </button>
        </form>
      </nav>
      <main className="container">{children}</main>
    </>
  );
}
