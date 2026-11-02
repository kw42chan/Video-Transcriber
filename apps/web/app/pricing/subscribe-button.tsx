'use client';

import { useState } from 'react';
import type { CheckoutProductKey } from '@video-transcriber/shared';

export function CheckoutButton({
  product,
  label,
  variant = 'primary',
}: {
  product: CheckoutProductKey;
  label: string;
  variant?: 'primary' | 'secondary';
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkout() {
    setLoading(true);
    setError(null);
    const res = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? 'Checkout failed');
      return;
    }
    if (data.url) window.location.href = data.url;
  }

  const className = variant === 'secondary' ? 'btn secondary' : 'btn';

  return (
    <span style={{ display: 'inline-block' }}>
      <button type="button" className={className} onClick={checkout} disabled={loading}>
        {loading ? '…' : label}
      </button>
      {error && <p style={{ color: 'var(--danger)', marginTop: '0.35rem', fontSize: '0.9rem' }}>{error}</p>}
    </span>
  );
}

/** @deprecated Use CheckoutButton */
export function SubscribeButton() {
  return <CheckoutButton product="pro" label="Subscribe 訂閱 Pro" />;
}
