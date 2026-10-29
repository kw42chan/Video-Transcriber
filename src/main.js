import { createClient } from '@supabase/supabase-js';
import './style.css';

const config = {
  url: import.meta.env.VITE_SUPABASE_URL || '',
  key: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
};
const configured = Boolean(config.url && config.key);
const supabase = configured ? createClient(config.url, config.key, {
  auth: { flowType: 'pkce', autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
}) : null;

const root = document.querySelector('#app');
const state = { session: null, projects: [], filter: 'all', busy: false, message: '', error: '' };
const esc = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (value) => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
const initials = (user) => (user?.user_metadata?.full_name || user?.email || 'U').split(/[\s@]+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join('');

function render() {
  if (!configured) return renderSetup();
  if (!state.session) return renderSignIn();
  const user = state.session.user;
  const filtered = state.filter === 'all' ? state.projects : state.projects.filter(p => p.status === state.filter);
  const activeCount = state.projects.filter(p => !['complete', 'archived'].includes(p.status)).length;
  root.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <a class="brand" href="#" aria-label="Sidecar home"><span class="brand-mark"><i></i><i></i><i></i></span><span>sidecar<span class="brand-period">.</span></span></a>
        <div class="workspace-label">WORKSPACE</div>
        <button class="workspace-switch" type="button"><span class="workspace-avatar">${esc(initials(user))}</span><span class="workspace-copy"><b>${esc(user.user_metadata?.full_name || 'My workspace')}</b><small>Personal workspace</small></span><span class="chevron">⌄</span></button>
        <nav class="nav" aria-label="Main navigation">
          <div class="nav-group">WORKSPACE</div>
          <button class="nav-item active" type="button" data-view="projects"><span class="nav-glyph">▤</span>Projects<span class="nav-count">${state.projects.length}</span></button>
          <button class="nav-item" type="button" data-view="voice"><span class="nav-glyph">◖</span>Voice library</button>
          <button class="nav-item" type="button" data-view="settings"><span class="nav-glyph">·</span>Settings</button>
        </nav>
        <div class="sidebar-bottom"><div class="storage-label"><span>Storage</span><span>0 GB used</span></div><div class="storage-track"><i></i></div><div class="storage-caption">Files stay private to your workspace.</div><div class="profile"><span class="profile-avatar">${esc(initials(user))}</span><span class="profile-copy"><b>${esc(user.user_metadata?.full_name || 'Signed in')}</b><small>${esc(user.email || '')}</small></span><button class="icon-button" id="signout" aria-label="Sign out" title="Sign out">↗</button></div></div>
      </aside>
      <main class="main">
        <header class="topbar"><div class="breadcrumbs"><span>Workspace</span><span class="crumb-slash">/</span><b>Projects</b></div><div class="topbar-right"><span class="secure-label"><i></i> Private workspace</span><span class="top-divider"></span><button class="avatar-button" id="account" aria-label="Account">${esc(initials(user))}</button></div></header>
        <div class="content">
          <section class="title-row"><div><div >ENGLISH → HONG KONG CANTONESE</div><h1>Your projects</h1><p class="subtitle">Translate, voice and sync your video in one place.</p></div><button class="primary-button" id="new-project"><span>＋</span> New project</button></section>
          <section class="pipeline" aria-label="Dubbing workflow"><div class="pipeline-heading"><span>THE DUBBING FLOW</span><span>Four steps from source to final cut</span></div><div class="pipeline-steps"><div class="pipeline-step"><span class="step-icon waveform"><i></i><i></i><i></i><i></i><i></i></span><b>Transcribe</b><small>English speech</small></div><span class="pipeline-line"></span><div class="pipeline-step"><span class="step-icon translate-icon">文<span> A</span></span><b>Translate</b><small>HK Cantonese</small></div><span class="pipeline-line"></span><div class="pipeline-step"><span class="step-icon audio-icon">◖</span><b>Voice</b><small>Cloned speech</small></div><span class="pipeline-line"></span><div class="pipeline-step"><span class="step-icon sync-icon">⌁</span><b>Sync &amp; review</b><small>Final video</small></div></div></section>
          <section class="project-section"><div class="section-head"><div><h2>Project library</h2><span class="section-count">${state.projects.length} ${state.projects.length === 1 ? 'project' : 'projects'}</span></div><div class="filters" role="tablist" aria-label="Filter projects"><button class="filter ${state.filter === 'all' ? 'selected' : ''}" data-filter="all">All <span>${state.projects.length}</span></button><button class="filter ${state.filter === 'in_progress' ? 'selected' : ''}" data-filter="in_progress">In progress <span>${activeCount}</span></button><button class="filter ${state.filter === 'complete' ? 'selected' : ''}" data-filter="complete">Completed</button></div></div>
          ${state.error ? `<div class="notice error-notice">${esc(state.error)}</div>` : ''}${state.message ? `<div class="notice success-notice">${esc(state.message)}</div>` : ''}
          <div class="table-wrap"><table><thead><tr><th>PROJECT</th><th>SOURCE</th><th>LAST UPDATED</th><th>STAGE</th><th></th></tr></thead><tbody>${filtered.length ? filtered.map(projectRow).join('') : `<tr><td colspan="5"><div class="empty-state"><div class="empty-mark"><span>▶</span><span>文</span><span>◖</span></div><h3>${state.projects.length ? 'No projects in this view' : 'Your next cut starts here'}</h3><p>${state.projects.length ? 'Choose another filter to see your projects.' : 'Add an English video and build its Cantonese version step by step.'}</p>${state.projects.length ? '' : '<button class="primary-button" id="empty-new">＋ New project</button>'}</div></td></tr>`}</tbody></table></div></section>
          <footer class="footnote"><span>Built for speech that sounds at home in Hong Kong.</span><span class="foot-mono">SIDECAR / DUB WORKSPACE</span></footer>
        </div>
      </main>
    </div>
    <dialog id="project-dialog"><form id="project-form" class="project-form"><div class="dialog-head"><div><div >New dubbing project</div><h2>Bring in a video</h2></div><button class="icon-button close-dialog" type="button" aria-label="Close">×</button></div><p class="dialog-copy">Start with an English video. You can add a voice reference later.</p><label class="field-label" for="project-name">Project name</label><input id="project-name" name="name" required maxlength="80" placeholder="e.g. Product launch — Cantonese" /><label class="field-label" for="video-file">Source video <span>Optional for now</span></label><label class="file-drop" for="video-file"><input id="video-file" name="video" type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" /><span class="upload-mark">↑</span><b>Choose a video to upload</b><small>MP4, MOV or WebM · up to 1 GB</small><span class="file-name" id="file-name"></span></label><div class="dialog-actions"><button class="secondary-button close-dialog" type="button">Cancel</button><button class="primary-button" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Creating…' : 'Create project'} <span>→</span></button></div><p class="form-error" id="form-error"></p></form></dialog>`;
  bindAppEvents();
}

function projectRow(p) {
  const status = p.status === 'complete' ? ['complete', 'Complete'] : p.status === 'in_progress' ? ['progress', 'In progress'] : ['draft', 'Draft'];
  const stage = p.current_stage ? p.current_stage.replaceAll('_', ' ') : (p.status === 'complete' ? 'Ready to export' : 'Source video');
  return `<tr><td><div class="project-name"><span class="project-symbol">${p.status === 'complete' ? '■' : '▶'}</span><span><b>${esc(p.name)}</b><small>${esc(p.id.slice(0, 8).toUpperCase())}</small></span></div></td><td class="source-cell">${p.source_filename ? `<span class="file-symbol">▧</span>${esc(p.source_filename)}` : '<span class="muted">No video added</span>'}</td><td class="date-cell">${fmtDate(p.updated_at)}</td><td><span class="status ${status[0]}"><i></i>${status[1]}</span><small class="stage-label">${esc(stage)}</small></td><td><button class="row-action" data-project="${esc(p.id)}" aria-label="Open ${esc(p.name)}">→</button></td></tr>`;
}

function renderSetup() {
  root.innerHTML = `<main class="setup-screen"><div class="setup-card"><a class="brand" href="#"><span class="brand-mark"><i></i><i></i><i></i></span><span>sidecar<span class="brand-period">.</span></span></a><div >Setup required</div><h1>Connect your workspace</h1><p>Add your Supabase project URL and public anon key to <code>.env</code> to enable Google sign-in and the project library.</p><pre>VITE_SUPABASE_URL=https://…supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key</pre><a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">Open Supabase dashboard ↗</a></div></main>`;
}

function renderSignIn() {
  root.innerHTML = `<main class="signin-screen"><div class="signin-art"><div class="art-top"><a class="brand" href="#"><span class="brand-mark"><i></i><i></i><i></i></span><span>sidecar<span class="brand-period">.</span></span></a><span class="art-index">Dubbing workspace</span></div><div class="art-title"><div >English to 香港粵語</div><h1>Keep the voice.<br/><em>Change the language.</em></h1><p>A considered workflow for turning English video into Cantonese that sounds like it belongs.</p></div><div class="art-timeline"><div class="art-track"><span class="track-line"></span><span class="track-playhead"></span><span class="track-wave">▁▃▂▆▃▂▅▃▁▅▇▃▂▆▂▅▃▁▆▂▃▇▂▅</span></div><div class="track-labels"><span>English source</span><span>Cantonese voice</span><span>Ready to sync</span></div></div><span class="art-footer">Speech is culture. Keep it human.</span></div><section class="signin-panel"><div class="signin-top"><span>Personal workspace</span><span class="secure-label"><i></i> Encrypted sign-in</span></div><div class="signin-box"><div >Welcome to Sidecar</div><h2>Your next voice,<br/>in the right language.</h2><p>Sign in to save your projects, source videos and voice references.</p><button id="google-signin" class="google-button"><svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11c-.5 2.5-1.9 4.6-4.1 6v5h6.6c3.9-3.6 6.1-8.8 6.1-14.7z"/><path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.8l-6.6-5c-1.8 1.2-4.1 1.9-6.9 1.9-5.3 0-9.8-3.6-11.4-8.4H5.8v5.2C9.2 39.5 16 44 24 44z"/><path fill="#FBBC05" d="M12.6 27.7a12 12 0 0 1 0-7.4v-5.2H5.8a20 20 0 0 0 0 17.8z"/><path fill="#EA4335" d="M24 11.9c3 0 5.7 1 7.8 3.1l5.8-5.8C34.1 6 29.5 4 24 4 16 4 9.2 8.5 5.8 15.1l6.8 5.2c1.6-4.8 6.1-8.4 11.4-8.4z"/></svg><span id="signin-label">Continue with Google</span><span>→</span></button><p class="signin-error" id="signin-error">${esc(state.error)}</p><div class="privacy-note"><span>◈</span><span>Your source video and voice references are private to your account. We only process them when you choose a dubbing service.</span></div></div><footer class="signin-footer"><span>Sidecar · Cantonese dubbing workspace</span><span>Privacy · Terms</span></footer></section></main>`;
  document.querySelector('#google-signin').addEventListener('click', async () => {
    const label = document.querySelector('#signin-label');
    label.textContent = 'Connecting…';
    document.querySelector('#signin-error').textContent = '';
    try {
      const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
      if (error) throw error;
    } catch (error) {
      document.querySelector('#signin-error').textContent = error.message || 'Could not start Google sign-in.';
      label.textContent = 'Continue with Google';
    }
  });
}

function bindAppEvents() {
  document.querySelector('#new-project')?.addEventListener('click', openDialog);
  document.querySelector('#empty-new')?.addEventListener('click', openDialog);
  document.querySelectorAll('.close-dialog').forEach(btn => btn.addEventListener('click', () => document.querySelector('#project-dialog').close()));
  document.querySelector('#signout')?.addEventListener('click', async () => { await supabase.auth.signOut(); });
  document.querySelector('#account')?.addEventListener('click', async () => { await supabase.auth.signOut(); });
  document.querySelectorAll('[data-filter]').forEach(btn => btn.addEventListener('click', () => { state.filter = btn.dataset.filter; render(); }));
  document.querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', () => {
    if (btn.dataset.view !== 'projects') { state.error = `${btn.textContent.trim()} is coming soon.`; render(); }
  }));
  document.querySelectorAll('[data-project]').forEach(btn => btn.addEventListener('click', () => {
    const project = state.projects.find(p => p.id === btn.dataset.project);
    state.error = `Project details for “${project?.name || 'this project'}” are next in the workspace build.`;
    render();
  }));
  const file = document.querySelector('#video-file');
  file?.addEventListener('change', () => {
    const f = file.files[0];
    document.querySelector('#file-name').textContent = f ? `${f.name} · ${formatSize(f.size)}` : '';
  });
  document.querySelector('#project-form')?.addEventListener('submit', createProject);
}

function openDialog() { state.error = ''; document.querySelector('#project-dialog').showModal(); }
function formatSize(n) { return n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(0)} MB` : `${(n / 1024 ** 3).toFixed(1)} GB`; }

async function createProject(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const errorEl = document.querySelector('#form-error');
  const submit = form.querySelector('[type="submit"]');
  const name = form.elements.name.value.trim();
  const file = form.elements.video.files[0];
  errorEl.textContent = '';
  if (file && file.size > 1024 ** 3) { errorEl.textContent = 'Choose a video under 1 GB.'; return; }
  state.busy = true; submit.disabled = true; submit.innerHTML = 'Creating…';
  const userId = state.session.user.id;
  const { data, error } = await supabase.from('projects').insert({ owner_id: userId, name, status: 'draft', current_stage: 'source_video' }).select().single();
  if (error) { state.busy = false; submit.disabled = false; submit.innerHTML = 'Create project <span>→</span>'; errorEl.textContent = error.message; return; }
  if (file) {
    const safeName = file.name.replace(/[^\w.-]+/g, '-');
    const objectPath = `${userId}/${data.id}/${safeName}`;
    const upload = await supabase.storage.from('source-videos').upload(objectPath, file, { upsert: false, contentType: file.type || 'video/mp4' });
    if (upload.error) {
      await supabase.from('projects').delete().eq('id', data.id);
      state.busy = false; submit.disabled = false; submit.innerHTML = 'Create project <span>→</span>'; errorEl.textContent = `Upload failed: ${upload.error.message}`; return;
    }
    const update = await supabase.from('projects').update({ source_path: objectPath, source_filename: file.name, source_bytes: file.size }).eq('id', data.id);
    if (update.error) { errorEl.textContent = `Project saved, but video metadata could not be saved: ${update.error.message}`; }
  }
  document.querySelector('#project-dialog').close();
  form.reset(); state.busy = false; state.message = file ? 'Project created and source video uploaded.' : 'Project created.';
  await loadProjects();
}

async function loadProjects() {
  if (!supabase || !state.session) return;
  const { data, error } = await supabase.from('projects').select('id,name,status,current_stage,source_path,source_filename,source_bytes,created_at,updated_at').order('updated_at', { ascending: false });
  state.error = error ? `Could not load projects: ${error.message}` : '';
  state.projects = data || [];
  render();
}

async function start() {
  if (!configured) { render(); return; }
  const { data: { session } } = await supabase.auth.getSession();
  state.session = session;
  supabase.auth.onAuthStateChange((_event, nextSession) => {
    state.session = nextSession;
    if (nextSession) queueMicrotask(loadProjects); else { state.projects = []; render(); }
  });
  if (session) await loadProjects(); else render();
}

start();


