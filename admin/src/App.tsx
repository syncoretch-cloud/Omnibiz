import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router';
import { Icon } from '@web/components/Icon.tsx';
import { Empty, SectionSwap, Spinner } from '@web/components/ui.tsx';
import { useSession } from '@web/lib/session.tsx';
import { label } from '@web/lib/format.ts';
import { Audit, Broadcast, Categories, Content, Overview, Reports, Users, Verification } from './pages/Sections.tsx';
import { Billing } from './pages/Billing.tsx';
import { BlockedWords } from './pages/BlockedWords.tsx';
import { Login } from './pages/Login.tsx';

// [path, label, icon, permission]
const LINKS: [string, string, string, string][] = [
  ['', 'Overview', 'chart', 'stats'],
  ['users', 'Users', 'users', 'users.view'],
  ['content', 'Content', 'layers', 'content'],
  ['reports', 'Reports', 'flag', 'reports'],
  ['words', 'Blocked words', 'shield', 'content'],
  ['verification', 'Verification', 'verified', 'verification'],
  ['billing', 'Plans & billing', 'cash', 'billing'],
  ['categories', 'Categories', 'tag', 'categories'],
  ['broadcast', 'Broadcast', 'megaphone', 'broadcast'],
  ['audit', 'Audit log', 'file', 'audit'],
];

export function App() {
  const { me, ready, staffCan, logout } = useSession();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);

  if (!ready) return <Spinner block />;
  if (!me) return <Login />;
  if (!me.staff_permissions.length) {
    return (
      <main className="admin-login">
        <div className="card card-pad stack">
          <Empty icon="lock" title="This account is not staff">Sign in with an account that has an admin, moderator, support or verification role.</Empty>
          <button className="btn btn-outline" onClick={logout}>Sign out</button>
        </div>
      </main>
    );
  }
  const allowed = LINKS.filter(([, , , p]) => staffCan(p));
  const current = allowed.find(([to]) => (to ? pathname.startsWith('/' + to) : pathname === '/'));
  return (
    <div className={`admin-shell${open ? ' is-open' : ''}`}>
      <header className="admin-top">
        <button className="icon-btn" aria-label="Menu" onClick={() => setOpen((o) => !o)}><Icon name="menu" /></button>
        <b>{current?.[1] ?? 'OmniBiz Admin'}</b>
      </header>
      <aside className="admin-side">
        <div className="admin-brand"><img src="/brand/omnibiz-mark.png" alt="" width={28} height={28} /><b>OmniBiz</b><span className="chip">Admin</span></div>
        <nav>
          {allowed.map(([to, text, icon]) => <NavLink key={to} to={to ? `/${to}` : '/'} end={!to}><Icon name={icon as never} />{text}</NavLink>)}
        </nav>
        <div className="admin-who">
          <div className="small bold">{me.user.display_name}</div>
          <div className="xsmall muted">{label(me.user.role)}</div>
          <button className="btn btn-ghost btn-sm" onClick={logout}><Icon name="logout" />Sign out</button>
        </div>
      </aside>
      <button className="admin-scrim" aria-label="Close menu" onClick={() => setOpen(false)} />
      <main className="admin-main">
        <SectionSwap><Routes>
          <Route index element={staffCan('stats') ? <Overview /> : <Navigate to={`/${allowed[0]?.[0] ?? ''}`} replace />} />
          {staffCan('users.view') && <Route path="users" element={<Users />} />}
          {staffCan('content') && <Route path="content" element={<Content />} />}
          {staffCan('content') && <Route path="words" element={<BlockedWords />} />}
          {staffCan('reports') && <Route path="reports" element={<Reports />} />}
          {staffCan('verification') && <Route path="verification" element={<Verification />} />}
          {staffCan('billing') && <Route path="billing" element={<Billing />} />}
          {staffCan('categories') && <Route path="categories" element={<Categories />} />}
          {staffCan('broadcast') && <Route path="broadcast" element={<Broadcast />} />}
          {staffCan('audit') && <Route path="audit" element={<Audit />} />}
          <Route path="*" element={<Empty icon="lock" title="You don't have access to this section" />} />
        </Routes></SectionSwap>
      </main>
    </div>
  );
}
