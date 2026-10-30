'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const result =
      mode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <main className="container" style={{ maxWidth: 420 }}>
      <h1>{mode === 'login' ? '登入' : '註冊'}</h1>
      <form className="card" onSubmit={onSubmit}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label htmlFor="password" style={{ marginTop: '0.75rem' }}>
          密碼
        </label>
        <input
          id="password"
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        <button className="btn" type="submit" disabled={loading} style={{ marginTop: '1rem' }}>
          {loading ? '…' : mode === 'login' ? '登入' : '建立帳戶'}
        </button>
      </form>
      <p className="muted">
        {mode === 'login' ? (
          <>
            未有帳戶？{' '}
            <button type="button" className="btn secondary" onClick={() => setMode('signup')}>
              註冊
            </button>
          </>
        ) : (
          <>
            已有帳戶？{' '}
            <button type="button" className="btn secondary" onClick={() => setMode('login')}>
              登入
            </button>
          </>
        )}
      </p>
      <p>
        <Link href="/">← 返回首頁</Link>
      </p>
    </main>
  );
}
