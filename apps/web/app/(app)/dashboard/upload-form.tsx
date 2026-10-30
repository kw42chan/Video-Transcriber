'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function JobUploadForm({ canUpload }: { canUpload: boolean }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !canUpload) return;
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      const jobId = crypto.randomUUID();
      const ext = file.name.split('.').pop() ?? 'mp4';
      const storagePath = `${user.id}/${jobId}/input.${ext}`;

      const { error: upErr } = await supabase.storage
        .from('user-uploads')
        .upload(storagePath, file, { upsert: false, contentType: file.type || 'video/mp4' });
      if (upErr) throw new Error(upErr.message);

      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          inputPath: `user-uploads/${storagePath}`,
          durationSeconds: null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Failed to create job');

      router.push(`/dashboard/jobs/${body.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <h2>上傳影片</h2>
      <input
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        disabled={!canUpload || loading}
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      <button className="btn" type="submit" disabled={!canUpload || !file || loading} style={{ marginTop: '1rem' }}>
        {loading ? '上傳中…' : '建立配音工作'}
      </button>
      {!canUpload && <p className="muted">需要有效訂閱或 BYOK 才能繼續（試用已用完）。</p>}
    </form>
  );
}
