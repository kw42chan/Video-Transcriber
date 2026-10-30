import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { JobOutputs } from './outputs';

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: job } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', id)
    .eq('user_id', user!.id)
    .single();

  if (!job) notFound();

  return (
    <>
      <p>
        <Link href="/dashboard">← 控制台</Link>
      </p>
      <h1>工作 {job.id.slice(0, 8)}…</h1>
      <p>
        狀態：<span className={`status-${job.status}`}>{job.status}</span>
      </p>
      {job.error ? <p style={{ color: 'var(--danger)' }}>{job.error}</p> : null}
      <JobOutputs jobId={job.id} outputPaths={job.output_paths as Record<string, string>} status={job.status} />
    </>
  );
}
