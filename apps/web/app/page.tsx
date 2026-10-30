import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect('/dashboard');

  return (
    <main className="container">
      <h1>Video Transcriber</h1>
      <p className="muted">
        上傳英文影片 → 自動轉寫、翻譯成香港口語粵語、Canto-Gen 配音、唇形同步。
      </p>
      <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
        <Link className="btn" href="/login">
          登入 / 註冊
        </Link>
        <Link className="btn secondary" href="/pricing">
          方案
        </Link>
      </div>
    </main>
  );
}
