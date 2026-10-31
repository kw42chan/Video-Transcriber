'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const supabase = createClient();
      const result = mode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
      if (result.error) throw result.error;
      if (mode === 'signup' && !result.data.session) {
        setError('Check your email to confirm your account, then sign in.');
        setLoading(false);
        return;
      }
      router.push('/dashboard');
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not sign in. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="signin-screen">
      <section className="signin-art" aria-label="Sidecar dubbing workflow">
        <div className="art-top">
          <Link className="brand" href="/"><span className="brand-mark"><i /><i /><i /></span><span>sidecar<span className="brand-period">.</span></span></Link>
          <span className="art-index">Dubbing workspace</span>
        </div>
        <div className="art-title">
          <div className="eyebrow">English to Hong Kong Cantonese</div>
          <h1>Keep the voice.<br /><em>Change the language.</em></h1>
          <p>A considered workflow for turning English video into Cantonese that sounds like it belongs.</p>
        </div>
        <div className="art-timeline" aria-hidden="true">
          <div className="art-track"><span className="track-line" /><span className="track-playhead" /><span className="track-wave">▁▃▂▆▃▂▅▃▁▅▇▃▂▆▂▅▃▁▆▂▃▇▂▅</span></div>
          <div className="track-labels"><span>English source</span><span>Cantonese voice</span><span>Ready to sync</span></div>
        </div>
        <span className="art-footer">Speech is culture. Keep it human.</span>
      </section>
      <section className="signin-panel">
        <div className="signin-top"><span>Personal workspace</span><span className="secure-label"><i />Encrypted sign-in</span></div>
        <div className="signin-box">
          <div className="eyebrow">{mode === 'login' ? 'Welcome back' : 'Create your workspace'}</div>
          <h2>{mode === 'login' ? <>Your next voice,<br />in the right language.</> : <>Start your<br />first dubbing project.</>}</h2>
          <p>Sign in to save your projects, source videos and dubbing outputs.</p>
          <form className="signin-form" onSubmit={onSubmit}>
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            <label htmlFor="password">Password</label>
            <input id="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} />
            <button className="primary-button" type="submit" disabled={loading}>{loading ? 'Connecting…' : mode === 'login' ? 'Sign in' : 'Create account'} <span aria-hidden="true">→</span></button>
          </form>
          <p className="signin-error" role="alert">{error}</p>
          <p className="signin-toggle">{mode === 'login' ? 'New to Sidecar? ' : 'Already have an account? '}<button type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); }}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button></p>
          <div className="privacy-note"><span aria-hidden="true">◈</span><span>Your source videos and voice settings are private to your account.</span></div>
        </div>
        <footer className="signin-footer"><span>Sidecar · Cantonese dubbing workspace</span><Link href="/pricing">Plans</Link></footer>
      </section>
    </main>
  );
}
