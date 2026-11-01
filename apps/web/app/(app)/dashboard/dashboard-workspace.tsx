'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { createClient } from '@/lib/supabase/client';

type Job = {
  id: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | string;
  input_path: string;
  error: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type Filter = 'all' | 'in_progress' | 'complete' | 'failed';

const isActive = (job: Job) => job.status === 'pending' || job.status === 'running';

function jobFileName(job: Job) {
  const savedName = job.metadata?.file_name;
  if (typeof savedName === 'string' && savedName.trim()) return savedName;
  return job.input_path.split('/').pop() || 'Source video';
}

function jobName(job: Job) {
  const savedName = job.metadata?.project_name;
  if (typeof savedName === 'string' && savedName.trim()) return savedName;
  return jobFileName(job).replace(/\.[^.]+$/, '');
}

function jobStatus(job: Job) {
  if (job.status === 'pending') return { tone: 'progress', label: 'Queued', stage: 'Waiting to transcribe' };
  if (job.status === 'running') return { tone: 'progress', label: 'In progress', stage: 'Transcribing & dubbing' };
  if (job.status === 'succeeded') return { tone: 'complete', label: 'Complete', stage: 'Ready to export' };
  return { tone: 'failed', label: 'Needs attention', stage: 'Review the error' };
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function formatSize(bytes: number) {
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function DashboardWorkspace({
  jobs,
  canUpload,
  planLabel,
  previewMode = false,
}: {
  jobs: Job[];
  canUpload: boolean;
  planLabel: string;
  previewMode?: boolean;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const dialog = useRef<HTMLDialogElement>(null);
  const activeCount = jobs.filter(isActive).length;
  const completeCount = jobs.filter((job) => job.status === 'succeeded').length;
  const failedCount = jobs.filter((job) => job.status === 'failed').length;
  const visibleJobs = jobs.filter((job) => {
    if (filter === 'in_progress') return isActive(job);
    if (filter === 'complete') return job.status === 'succeeded';
    if (filter === 'failed') return job.status === 'failed';
    return true;
  });

  const openProjectForm = () => dialog.current?.showModal();

  return (
    <>
      <section className="title-row">
        <div>
          <div>English → Hong Kong Cantonese</div>
          <h1>Your projects</h1>
          <p className="subtitle">Track each source video and its dubbing status.</p>
        </div>
        {canUpload ? (
          <button className="primary-button" type="button" onClick={openProjectForm}>
            <span className="button-plus" aria-hidden="true">+</span> New project
          </button>
        ) : (
          <Link className="primary-button" href="/pricing">View plans</Link>
        )}
      </section>

      <section className="pipeline" aria-label="Dubbing workflow">
        <div className="pipeline-heading"><span>The dubbing flow</span><span>Four steps from source to final cut</span></div>
        <div className="pipeline-steps">
          <div className="pipeline-step"><span className="step-icon waveform"><i /><i /><i /><i /><i /></span><b>Transcribe</b><small>English speech</small></div>
          <span className="pipeline-line" />
          <div className="pipeline-step"><span className="step-icon translate-icon">文<span>A</span></span><b>Translate</b><small>HK Cantonese</small></div>
          <span className="pipeline-line" />
          <div className="pipeline-step"><span className="step-icon audio-icon">◖</span><b>Voice</b><small>Cloned speech</small></div>
          <span className="pipeline-line" />
          <div className="pipeline-step"><span className="step-icon sync-icon">⌁</span><b>Sync &amp; review</b><small>Final video</small></div>
        </div>
      </section>

      <section className="project-section" aria-labelledby="project-library-heading">
        <div className="section-head">
          <div><h2 id="project-library-heading">Project library</h2><span className="section-count">{jobs.length} {jobs.length === 1 ? 'project' : 'projects'}</span></div>
          <div className="filters" role="tablist" aria-label="Filter projects">
            <FilterButton active={filter === 'all'} onClick={() => setFilter('all')} label="All" count={jobs.length} />
            <FilterButton active={filter === 'in_progress'} onClick={() => setFilter('in_progress')} label="In progress" count={activeCount} />
            <FilterButton active={filter === 'complete'} onClick={() => setFilter('complete')} label="Completed" count={completeCount} />
            <FilterButton active={filter === 'failed'} onClick={() => setFilter('failed')} label="Failed" count={failedCount} />
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead><tr><th>Project</th><th>Source</th><th>Last updated</th><th>Stage</th><th><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {visibleJobs.map((job) => {
                const status = jobStatus(job);
                return (
                  <tr key={job.id}>
                    <td><div className="project-name"><span className="project-symbol" aria-hidden="true">{job.status === 'succeeded' ? '■' : '▶'}</span><span><b>{jobName(job)}</b><small>{job.id.slice(0, 8).toUpperCase()}</small></span></div></td>
                    <td className="source-cell"><span className="file-symbol" aria-hidden="true">▧</span>{jobFileName(job)}</td>
                    <td className="date-cell">{formatDate(job.updated_at || job.created_at)}</td>
                    <td><span className={`status ${status.tone}`}><i />{status.label}</span><small className="stage-label">{status.stage}</small>{job.error ? <small className="stage-label error-text">{job.error}</small> : null}</td>
                    <td><Link className="row-action" href={`/dashboard/jobs/${job.id}`} aria-label={`Open ${jobName(job)}`}>→</Link></td>
                  </tr>
                );
              })}
              {!visibleJobs.length ? (
                <tr><td colSpan={5}>
                  <div className="empty-state">
                    <div className="empty-mark" aria-hidden="true"><span>▏</span><span>▏</span><span>▏</span></div>
                    <div className="empty-copy">
                      <h3>{jobs.length ? 'No projects in this view' : 'Your next cut starts here'}</h3>
                      <p>{jobs.length ? 'Choose another filter to see your projects.' : 'Add an English source video and follow its dubbing progress from one workspace.'}</p>
                    </div>
                    {!jobs.length ? canUpload ? (
                      <button className="primary-button" type="button" onClick={openProjectForm}><span className="button-plus" aria-hidden="true">+</span> New project</button>
                    ) : <Link className="primary-button" href="/pricing">View plans</Link> : null}
                  </div>
                </td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="footnote"><span>Built for speech that sounds at home in Hong Kong.</span><span className="foot-mono">SIDECAR / DUB WORKSPACE</span></footer>

      <ProjectDialog refElement={dialog} canUpload={canUpload} planLabel={planLabel} previewMode={previewMode} />
    </>
  );
}

function FilterButton({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return <button className={`filter${active ? ' selected' : ''}`} type="button" role="tab" aria-selected={active} onClick={onClick}>{label} <span>{count}</span></button>;
}

function ProjectDialog({
  refElement,
  canUpload,
  planLabel,
  previewMode,
}: {
  refElement: React.RefObject<HTMLDialogElement | null>;
  canUpload: boolean;
  planLabel: string;
  previewMode: boolean;
}) {
  const router = useRouter();
  const [projectName, setProjectName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canUpload || !file) return;
    if (previewMode) {
      setError('This design preview does not save projects.');
      return;
    }
    const name = projectName.trim();
    if (!name || name.length > 80) {
      setError('Enter a project name between 1 and 80 characters.');
      return;
    }
    if (file.size > 500 * 1024 ** 2) {
      setError('Choose a source video under 500 MB.');
      return;
    }

    setLoading(true);
    setError('');
    let uploadedPath = '';
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Your session expired. Sign in again to continue.');

      const jobId = crypto.randomUUID();
      const reservation = await fetch('/api/uploads/reserve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, fileName: file.name }),
      });
      const prepared = await reservation.json();
      if (!reservation.ok) throw new Error(prepared.error || 'Could not prepare upload.');
      uploadedPath = prepared.objectPath;
      const { error: uploadError } = await supabase.storage.from('user-uploads').upload(uploadedPath, file, {
        upsert: false,
        contentType: file.type || 'video/mp4',
      });
      if (uploadError) throw new Error(uploadError.message);

      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          inputPath: `user-uploads/${uploadedPath}`,
          durationSeconds: null,
          projectName: name,
          fileName: file.name,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not create the project.');

      setProjectName('');
      setFile(null);
      refElement.current?.close();
      router.push(`/dashboard/jobs/${result.id}`);
      router.refresh();
    } catch (submitError) {
      if (uploadedPath) await createClient().storage.from('user-uploads').remove([uploadedPath]);
      setError(submitError instanceof Error ? submitError.message : 'Could not create the project.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <dialog className="project-dialog" ref={refElement} onClose={() => { setError(''); }}>
      <form className="project-form" onSubmit={onSubmit}>
        <div className="dialog-head"><div><div className="eyebrow">New dubbing project</div><h2>Bring in a video</h2></div><button className="icon-button close-dialog" type="button" aria-label="Close" onClick={() => refElement.current?.close()}>×</button></div>
        <p className="dialog-copy">Upload an English source. You can track each processing stage here.</p>
        <label className="field-label" htmlFor="project-name">Project name</label>
        <input id="project-name" name="projectName" required maxLength={80} value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="e.g. Product launch — Cantonese" />
        <label className="field-label" htmlFor="video-file">Source video <span>Required</span></label>
        <label className="file-drop" htmlFor="video-file"><input id="video-file" name="video" type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" disabled={!canUpload || loading} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><span className="upload-mark">↑</span><b>{file ? file.name : 'Choose a video to upload'}</b><small>{file ? formatSize(file.size) : 'MP4, MOV or WebM · up to 500 MB'}</small></label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {!canUpload ? <p className="form-error">{planLabel}</p> : null}
        <div className="dialog-actions"><button className="secondary-button close-dialog" type="button" onClick={() => refElement.current?.close()}>Cancel</button><button className="primary-button" type="submit" disabled={!canUpload || !file || !projectName.trim() || loading}>{loading ? 'Uploading…' : 'Create project'} <span aria-hidden="true">→</span></button></div>
      </form>
    </dialog>
  );
}
