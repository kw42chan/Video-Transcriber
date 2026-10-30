'use client';

import { useEffect, useState } from 'react';

type Mask = Record<string, boolean>;

export function ByokForm() {
  const [mask, setMask] = useState<Mask>({});
  const [openrouter, setOpenrouter] = useState('');
  const [cantoGen, setCantoGen] = useState('');
  const [synclabs, setSynclabs] = useState('');
  const [fal, setFal] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings/byok')
      .then((r) => r.json())
      .then((d) => setMask(d.mask ?? {}))
      .catch(() => {});
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    const res = await fetch('/api/settings/byok', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        openrouter: openrouter || undefined,
        cantoGen: cantoGen || undefined,
        synclabs: synclabs || undefined,
        fal: fal || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Save failed');
      return;
    }
    setMask(data.mask ?? {});
    setOpenrouter('');
    setCantoGen('');
    setSynclabs('');
    setFal('');
    setMessage('已儲存（留空欄位表示保留原有金鑰）');
  }

  const hint = (key: string) => (mask[key] ? '已設定 ✓' : '未設定');

  return (
    <form className="card" onSubmit={onSubmit}>
      <label>OpenRouter {hint('openrouter')}</label>
      <input type="password" autoComplete="off" value={openrouter} onChange={(e) => setOpenrouter(e.target.value)} />
      <label style={{ marginTop: '0.75rem' }}>Canto-Gen {hint('cantoGen')}</label>
      <input type="password" autoComplete="off" value={cantoGen} onChange={(e) => setCantoGen(e.target.value)} />
      <label style={{ marginTop: '0.75rem' }}>Sync Labs {hint('synclabs')}</label>
      <input type="password" autoComplete="off" value={synclabs} onChange={(e) => setSynclabs(e.target.value)} />
      <label style={{ marginTop: '0.75rem' }}>Fal {hint('fal')}</label>
      <input type="password" autoComplete="off" value={fal} onChange={(e) => setFal(e.target.value)} />
      {message && <p style={{ color: 'var(--accent)' }}>{message}</p>}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      <button type="submit" className="btn" style={{ marginTop: '1rem' }}>
        儲存
      </button>
    </form>
  );
}
