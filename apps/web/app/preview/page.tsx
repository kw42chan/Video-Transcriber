import Link from 'next/link';
import { DashboardWorkspace } from '../(app)/dashboard/dashboard-workspace';

export default function DashboardPreviewPage() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link className="brand" href="/preview" aria-label="Sidecar preview home"><span className="brand-mark"><i /><i /><i /></span><span>sidecar<span className="brand-period">.</span></span></Link>
        <div className="workspace-label">Workspace</div>
        <div className="workspace-switch"><span className="workspace-avatar">DP</span><span className="workspace-copy"><b>Design preview</b><small>Preview workspace</small></span></div>
        <nav className="nav" aria-label="Main navigation">
          <div className="nav-group">Projects</div>
          <span className="nav-item active"><span className="nav-glyph" aria-hidden="true">▤</span>Project library<span className="nav-count">0</span></span>
        </nav>
        <div className="sidebar-bottom"><span className="privacy-mark" aria-hidden="true">◈</span><span>Preview data stays in this page and is never saved.</span></div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><b>Projects</b></div>
          <div className="topbar-right"><span className="secure-label"><i />Design preview · no data saved</span><span className="top-divider" /><span className="avatar-button"><span className="avatar-initials">DP</span><span className="account-name">Design preview</span></span></div>
        </header>
        <div className="content">
          <DashboardWorkspace jobs={[]} canUpload planLabel="Preview mode" previewMode />
        </div>
      </main>
    </div>
  );
}
