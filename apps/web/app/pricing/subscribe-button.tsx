'use client';

import { useState } from 'react';

export function SubscribeButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function subscribe() {
    setLoading(true);
    setError(null);
    const res = await fetch('/api/stripe/checkout', { method: 'POST' });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? 'Checkout failed');
      return;
    }
    if (data.url) window.location.href = data.url;
  }

  return (
    <>
      <button type="button" className="btn" onClick={subscribe} disabled={loading}>
        {loading ? '…' : 'Subscribe 訂閱'}
      </button>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
    </>
  );
}
