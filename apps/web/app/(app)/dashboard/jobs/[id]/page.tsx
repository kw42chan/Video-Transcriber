import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { JobOutputs } from './outputs';

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: job } = await supabase.from('jobs').select('*').eq('id', id).eq('user_id', user!.id).single();
  if (!job) notFound();

  const metadata = job.metadata && typeof job.metadata === 'object' ? job.metadata as Record<string, unknown> : {};
  const fileName = typeof metadata.file_name === 'string' ? metadata.file_name : job.input_path.split('/').pop() || 'Source video';
  const projectName = typeof metadata.project_name === 'string' ? metadata.project_name : fileName.replace(/\.[^.]+$/, '');
  const status = job.status === 'succeeded'
    ? { label: 'Complete', tone: 'complete' }
    : job.status === 'failed'
      ? { label: 'Needs attention', tone: 'failed' }
      : { label: job.status === 'running' ? 'In progress' : 'Queued', tone: 'progress' };

  return (
    <>
      <div className="detail-back"><Link href="/dashboard">← Project library</Link></div>
      <section className="title-row detail-title-row">
        <div><div>English → Hong Kong Cantonese</div><h1>{projectName}</h1><p className="subtitle">Source file: {fileName}</p></div>
        <span className={`status ${status.tone}`}><i />{status.label}</span>
      </section>
      <section className="pipeline" aria-label="Dubbing workflow">
        <div className="pipeline-heading"><span>Project status</span><span>Created {new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(job.created_at))}</span></div>
        <div className="detail-status-copy">{job.status === 'pending' ? 'Your project is waiting for the worker to start.' : job.status === 'running' ? 'Your source is being processed through the dubbing workflow.' : job.status === 'succeeded' ? 'The dubbing job is complete. Download the available outputs below.' : 'The job could not finish. Review the message and try again later.'}</div>
        {job.error ? <p className="error-text">{job.error}</p> : null}
      </section>
      <JobOutputs jobId={job.id} outputPaths={job.output_paths as Record<string, string>} status={job.status} />
    </>
  );
}
