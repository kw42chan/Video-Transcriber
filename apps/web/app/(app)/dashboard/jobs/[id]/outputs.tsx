'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function JobOutputs({
  jobId,
  outputPaths,
  status,
}: {
  jobId: string;
  outputPaths: Record<string, string>;
  status: string;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (status !== 'succeeded' || !outputPaths) return;
    const supabase = createClient();
    (async () => {
      const next: Record<string, string> = {};
      for (const [key, fullPath] of Object.entries(outputPaths)) {
        const [bucket, ...rest] = fullPath.split('/');
        const path = rest.join('/');
        const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
        if (data?.signedUrl) next[key] = data.signedUrl;
      }
      setUrls(next);
    })();
  }, [status, outputPaths, jobId]);

  if (status === 'pending' || status === 'running') {
    return <p className="muted">處理中，請稍候刷新頁面…</p>;
  }

  if (status !== 'succeeded') return null;

  const final = urls.finalVideo ?? urls.muxedVideo;
  return (
    <div className="card">
      <h2>輸出</h2>
      {final ? (
        <p>
          <a className="btn" href={final} download>
            下載影片
          </a>
        </p>
      ) : (
        <p className="muted">尚無可下載檔案</p>
      )}
      <ul className="muted">
        {Object.keys(outputPaths).map((k) => (
          <li key={k}>
            {k}
            {urls[k] ? (
              <>
                {' '}
                — <a href={urls[k]}>下載</a>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
