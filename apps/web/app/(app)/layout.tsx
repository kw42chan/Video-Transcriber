import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

function initials(name: string) {
  return name.split(/[\s@]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'U';
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: profile }, { count: projectCount }] = await Promise.all([
    supabase.from('profiles').select('byok_enabled').eq('id', user.id).maybeSingle(),
    supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
  ]);
  const displayName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Personal workspace';
  const email = user.email || 'Signed-in account';

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link className="brand" href="/dashboard" aria-label="Sidecar home">
          <span className="brand-mark"><i /><i /><i /></span><span>sidecar<span className="brand-period">.</span></span>
        </Link>
        <div className="workspace-label">Workspace</div>
        <div className="workspace-switch"><span className="workspace-avatar">{initials(displayName)}</span><span className="workspace-copy"><b>{displayName}</b><small>Personal workspace</small></span></div>
        <nav className="nav" aria-label="Main navigation">
          <div className="nav-group">Projects</div>
          <Link className="nav-item active" href="/dashboard"><span className="nav-glyph" aria-hidden="true">▤</span>Project library<span className="nav-count">{projectCount ?? 0}</span></Link>
          <Link className="nav-item" href="/pricing"><span className="nav-glyph" aria-hidden="true">◌</span>Plans</Link>
          {profile?.byok_enabled ? <Link className="nav-item" href="/settings/byok"><span className="nav-glyph" aria-hidden="true">⌘</span>BYOK settings</Link> : null}
        </nav>
        <div className="sidebar-bottom"><span className="privacy-mark" aria-hidden="true">◈</span><span>Uploads and outputs stay private to your account.</span></div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><b>Projects</b></div>
          <div className="topbar-right"><span className="secure-label"><i />Private workspace</span><span className="top-divider" /><form action="/auth/signout" method="post"><button className="avatar-button" type="submit" aria-label={`Sign out ${displayName}`} title="Sign out"><span className="avatar-initials">{initials(displayName)}</span><span className="account-name">{displayName}</span></button></form></div>
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
