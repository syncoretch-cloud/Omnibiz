import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { Icon } from './Icon.tsx';
import { Avatar, useIndicator } from './ui.tsx';
import { CreatePostModal } from './CreatePost.tsx';
import { isBusinessType, useSession } from '../lib/session.tsx';
import { toggleTheme, useTheme } from '../lib/theme.ts';
import { get } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { useDebounced } from '../lib/hooks.ts';

export interface ShellContext {
  openCreate: () => void;
}

export function Wordmark({ className = '' }: { className?: string }) {
  return <span className={`brand-chip ${className}`}><img src="/brand/logo.png" alt="OmniBiz" /></span>;
}

export function Ambient() {
  return <div className="ambient" aria-hidden="true"><i /><i /><i /></div>;
}

export function ThemeButton({ className, children }: { className?: string; children?: (dark: boolean) => ReactNode }) {
  const theme = useTheme();
  const dark = theme === 'dark';
  return (
    <button className={className} onClick={(e) => toggleTheme(e)} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
      {children ? children(dark) : <Icon name={dark ? 'sun' : 'moon'} />}
    </button>
  );
}

const Badge = ({ n }: { n: number }) => (n > 0 ? <span className="badge-dot">{n > 99 ? '99+' : n}</span> : null);

/** Route-level enter animation; nested areas (dashboard/admin/settings) animate their own sections. */
function routeKey(pathname: string) {
  const first = pathname.split('/')[1] ?? '';
  return ['dashboard', 'admin', 'settings'].includes(first) ? first : pathname;
}

// ───────────── search drawer (desktop) ─────────────
const RECENT_KEY = 'omnibiz-recent-searches';
function readRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; }
}
export function rememberSearch(q: string) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...readRecent().filter((x) => x !== q)].slice(0, 8))); } catch { /* storage unavailable */ }
}

function SearchDrawer({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Json[]>([]);
  const [recent, setRecent] = useState(readRecent);
  const dq = useDebounced(q, 180);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (dq.trim().length < 2) {
      setItems([]);
      return;
    }
    const ctrl = new AbortController();
    get(`/search/suggest?q=${encodeURIComponent(dq)}`, ctrl.signal).then((r) => setItems(r.suggestions)).catch(() => {});
    return () => ctrl.abort();
  }, [dq]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(t) && !t.closest('[data-search-toggle]')) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [onClose]);
  const go = (term: string) => {
    if (!term.trim()) return;
    rememberSearch(term.trim());
    nav(`/search?q=${encodeURIComponent(term.trim())}`);
    onClose();
  };
  return (
    <div className="drawer glass" ref={ref} role="dialog" aria-label="Search">
      <h2 style={{ padding: '4px 6px 6px' }}>Search</h2>
      <form onSubmit={(e) => { e.preventDefault(); go(q); }} className="input-icon">
        <Icon name="search" />
        <input className="input search-input" autoFocus placeholder="Search people, jobs, shops…" value={q} onChange={(e) => setQ(e.target.value)} />
      </form>
      <hr className="divider" />
      <div className="suggest-box" style={{ overflowY: 'auto' }}>
        {q.trim().length >= 2 ? (
          <>
            {items.map((s) => (
              <Link key={s.href} to={s.href} onClick={() => { rememberSearch(q.trim()); onClose(); }}>
                {s.kind === 'job' ? <span className="notif-icon" style={{ width: 44, height: 44 }}><Icon name="briefcase" /></span>
                  : s.kind === 'product' ? <span className="notif-icon" style={{ width: 44, height: 44, background: 'var(--grad-brown)', boxShadow: 'var(--clay-brown)' }}><Icon name="bag" /></span>
                  : <Avatar user={{ display_name: s.label, avatar_url: s.avatar_url, account_type: s.kind === 'business' ? 'company' : 'personal' }} size={44} />}
                <div className="grow">
                  <div className="truncate bold small">{s.label}</div>
                  <div className="truncate xsmall muted">{s.sub}</div>
                </div>
              </Link>
            ))}
            <a href="#" onClick={(e) => { e.preventDefault(); go(q); }}>
              <span className="notif-icon" style={{ width: 44, height: 44 }}><Icon name="search" /></span>
              <span className="small">See all results for “<b>{q.trim()}</b>”</span>
            </a>
          </>
        ) : (
          <>
            <div className="row-between" style={{ padding: '2px 8px 6px' }}>
              <b className="small">Recent</b>
              {recent.length > 0 && <button className="text-btn" onClick={() => { try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ } setRecent([]); }}>Clear all</button>}
            </div>
            {recent.length ? recent.map((r) => (
              <a key={r} href="#" onClick={(e) => { e.preventDefault(); go(r); }}>
                <span className="notif-icon" style={{ width: 44, height: 44, background: 'var(--surface-2)', color: 'var(--muted)', boxShadow: 'var(--neu-in-sm)' }}><Icon name="clock" /></span>
                <span className="small grow">{r}</span>
              </a>
            )) : <p className="muted small center" style={{ padding: 30 }}>No recent searches.</p>}
          </>
        )}
      </div>
    </div>
  );
}

// ───────────── create & more menus ─────────────
function CreateMenu({ onPost, onClose, style }: { onPost: () => void; onClose: () => void; style?: React.CSSProperties }) {
  const { can } = useSession();
  const nav = useNavigate();
  const go = (to: string) => { onClose(); nav(to); };
  return (
    <div className="popover" style={style} onMouseDown={(e) => e.stopPropagation()}>
      {can('create_posts') && <button onClick={() => { onClose(); onPost(); }}><Icon name="image" />Post</button>}
      {can('manage_products') && <button onClick={() => go('/dashboard/products?new=1')}><Icon name="bag" />Product listing</button>}
      {can('create_jobs') && <button onClick={() => go('/dashboard/jobs?new=1')}><Icon name="briefcase" />Job vacancy</button>}
      {can('publish_announcements') && <button onClick={() => go('/dashboard/announcements')}><Icon name="megaphone" />Announcement</button>}
    </div>
  );
}

export function MoreMenuItems({ onDone }: { onDone?: () => void }) {
  const { me, can, logout } = useSession();
  const nav = useNavigate();
  const isStaff = !!me && me.staff_permissions.length > 0;
  const biz = isBusinessType(me?.user.account_type);
  const counts = me?.counts ?? { notifications: 0, messages: 0, cart: 0 };
  return (
    <>
      {biz && <Link to="/dashboard" onClick={onDone}><Icon name="dashboard" />Business dashboard</Link>}
      {can('manage_cv') && <Link to="/me/cv" onClick={onDone}><Icon name="file" />My CV & documents</Link>}
      <Link to="/businesses" onClick={onDone}><Icon name="building" />Businesses & map</Link>
      <Link to="/saved" onClick={onDone}><Icon name="bookmark" />Saved</Link>
      {can('purchase') && <Link to="/cart" onClick={onDone}><Icon name="cart" />Cart{counts.cart > 0 && <span className="chip chip-brand" style={{ marginLeft: 'auto', height: 22 }}>{counts.cart}</span>}</Link>}
      {can('purchase') && <Link to="/orders" onClick={onDone}><Icon name="package" />My orders</Link>}
      {isStaff && <Link to="/admin" onClick={onDone}><Icon name="shield" />Admin portal</Link>}
      <Link to="/settings" onClick={onDone}><Icon name="settings" />Settings</Link>
      <ThemeButton>{(dark) => <><Icon name={dark ? 'sun' : 'moon'} />Switch appearance</>}</ThemeButton>
      <hr />
      <button onClick={async () => { onDone?.(); await logout(); nav('/'); }}><Icon name="logout" />Log out</button>
    </>
  );
}

function useOutside(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('[data-menu-toggle]')) return;
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, [open, close, ref]);
}

// ───────────── shell ─────────────
export function AppLayout() {
  const { me, can } = useSession();
  const loc = useLocation();
  const u = me!.user;
  const counts = me?.counts ?? { notifications: 0, messages: 0, cart: 0 };
  const showJobs = u.account_type !== 'customer';
  const personal = u.account_type === 'personal';
  const canCreate = can('create_posts') || can('manage_products') || can('create_jobs');
  const [panel, setPanel] = useState<'search' | null>(null);
  const [menu, setMenu] = useState<'create' | 'more' | 'create-bottom' | null>(null);
  const [composer, setComposer] = useState(false);
  const [createTop, setCreateTop] = useState(300);
  const sidebarRef = useRef<HTMLElement>(null);
  const linksRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const closePanel = useCallback(() => setPanel(null), []);
  useOutside(!!menu, closeMenu, menuRef);

  useEffect(() => {
    setPanel(null);
    setMenu(null);
  }, [loc.pathname]);

  const side = useIndicator(linksRef, panel ? '.side-link.panel-active' : '.side-link.active', [loc.pathname, panel], 'y');
  const bottom = useIndicator(bottomRef, 'a.active', [loc.pathname]);
  const openCreate = useCallback(() => setComposer(true), []);
  const isReels = loc.pathname.startsWith('/reels');

  const link = (to: string, icon: ReactNode, label: string, badge = 0, end = false) => (
    <NavLink to={to} end={end} className={({ isActive }) => `side-link${isActive && !panel ? ' active' : ''}`} title={label}>
      {icon}<span className="nav-label">{label}</span><Badge n={badge} />
    </NavLink>
  );

  return (
    <div className={isReels ? 'reels-page' : undefined}>
      <aside className={`sidebar glass${panel ? ' collapsed' : ''}`} aria-label="Main navigation" ref={sidebarRef}>
        <Link to="/" className="sidebar-logo" aria-label="OmniBiz home">
          <img src="/icon.svg" className="mark" alt="" />
          <Wordmark />
        </Link>
        <div className="side-links" ref={linksRef}>
          {side && <span className="nav-indicator" style={{ height: side.size, transform: `translateY(${side.pos}px)` }} />}
          {link('/', <Icon name="home" />, 'Home', 0, true)}
          <button data-search-toggle className={`side-link${panel === 'search' ? ' active panel-active' : ''}`} onClick={() => setPanel((p) => (p ? null : 'search'))} title="Search">
            <Icon name="search" /><span className="nav-label">Search</span>
          </button>
          {link('/explore', <Icon name="compass" />, 'Explore')}
          {link('/reels', <Icon name="reels" />, 'Reels')}
          {showJobs && link('/jobs', <Icon name="briefcase" />, 'Jobs')}
          {link('/marketplace', <Icon name="bag" />, 'Shop')}
          {link('/messages', <Icon name="message" />, 'Messages', counts.messages)}
          {link('/notifications', <Icon name="bell" />, 'Notifications', counts.notifications)}
          {canCreate && (
            <button data-menu-toggle className="side-link" title="Create" onClick={(e) => {
              // Popovers are positioned inside the (filtered) sidebar, so measure relative to it.
              const r = e.currentTarget.getBoundingClientRect();
              const sb = sidebarRef.current?.getBoundingClientRect();
              setCreateTop(r.top - (sb?.top ?? 0) - 6);
              setMenu((m) => (m === 'create' ? null : 'create'));
            }}>
              <Icon name="plusSquare" /><span className="nav-label">Create</span>
            </button>
          )}
          {isBusinessType(u.account_type) && link('/dashboard', <Icon name="dashboard" />, 'Dashboard')}
          {link(`/u/${u.username}`, <Avatar user={u} size={27} />, 'Profile')}
        </div>
        <div className="sidebar-foot">
          <button data-menu-toggle className="side-link" onClick={() => setMenu((m) => (m === 'more' ? null : 'more'))} title="More">
            <Icon name="menu" /><span className="nav-label">More</span>
          </button>
        </div>
        {menu === 'create' && <div ref={menuRef}><CreateMenu onPost={openCreate} onClose={closeMenu} style={{ left: 'calc(100% + 10px)', top: createTop }} /></div>}
        {menu === 'more' && (
          <div ref={menuRef}>
            <div className="popover" style={{ left: 'calc(100% + 10px)', bottom: 10 }}>
              <MoreMenuItems onDone={closeMenu} />
            </div>
          </div>
        )}
      </aside>
      {panel === 'search' && <SearchDrawer onClose={closePanel} />}

      <header className="topbar glass">
        <Link to="/" aria-label="OmniBiz home"><Wordmark /></Link>
        <Link to="/explore" className="icon-btn" aria-label="Search and explore"><Icon name="search" /></Link>
        <Link to="/notifications" className="icon-btn" aria-label="Notifications"><Icon name="bell" /><Badge n={counts.notifications} /></Link>
        <Link to="/messages" className="icon-btn" aria-label="Messages"><Icon name="message" /><Badge n={counts.messages} /></Link>
      </header>

      <main className={`main${panel ? ' drawer-open' : ''}`}>
        {u.status === 'suspended' && (
          <div className="page" style={{ paddingBottom: 0 }}>
            <div className="banner banner-danger"><Icon name="alert" />Your account is suspended{u.suspended_reason ? `: ${u.suspended_reason}` : ''}. Most actions are disabled.</div>
          </div>
        )}
        <div key={routeKey(loc.pathname)} className="route-enter">
          <Outlet context={{ openCreate } satisfies ShellContext} />
        </div>
      </main>

      <nav className="bottom-nav glass" aria-label="Main" ref={bottomRef}>
        {bottom && <span className="nav-indicator" style={{ width: bottom.size, transform: `translateX(${bottom.pos}px)` }} />}
        <NavLink to="/" end aria-label="Home"><Icon name="home" /></NavLink>
        <NavLink to="/reels" aria-label="Reels"><Icon name="reels" /></NavLink>
        {canCreate ? (
          <div className="fab-wrap" ref={menu === 'create-bottom' ? menuRef : undefined}>
            <button data-menu-toggle className="create-fab" onClick={() => setMenu((m) => (m === 'create-bottom' ? null : 'create-bottom'))} aria-label="Create"><Icon name="plus" /></button>
            {menu === 'create-bottom' && <CreateMenu onPost={openCreate} onClose={closeMenu} />}
          </div>
        ) : <NavLink to="/explore" aria-label="Explore"><Icon name="compass" /></NavLink>}
        {personal && showJobs ? <NavLink to="/jobs" aria-label="Jobs"><Icon name="briefcase" /></NavLink> : <NavLink to="/marketplace" aria-label="Shop"><Icon name="bag" /></NavLink>}
        <NavLink to={`/u/${u.username}`} aria-label="Profile"><Avatar user={u} size={28} /></NavLink>
      </nav>

      {composer && <CreatePostModal onClose={() => setComposer(false)} />}
    </div>
  );
}

/** Mobile "More" page (reached from the profile menu button). */
export function MobileMenu() {
  const { me } = useSession();
  const u = me?.user;
  return (
    <div className="page page-narrow">
      <div className="card">
        <Link to={`/u/${u?.username}`} className="list-item">
          <Avatar user={u} size={52} />
          <div className="grow">
            <div className="bold">{u?.display_name}</div>
            <div className="small muted">@{u?.username}</div>
          </div>
          <Icon name="chevronRight" size={18} />
        </Link>
      </div>
      <div className="card mt" style={{ padding: 8 }}>
        <div className="dropdown-menu" style={{ position: 'static', animation: 'none', boxShadow: 'none', background: 'none', border: 0, backdropFilter: 'none' }}>
          <Link to="/explore"><Icon name="compass" />Explore</Link>
          <Link to="/search"><Icon name="search" />Search</Link>
          {me?.user.account_type !== 'customer' && <Link to="/jobs"><Icon name="briefcase" />Jobs</Link>}
          <Link to="/marketplace"><Icon name="bag" />Shop</Link>
          <Link to="/messages"><Icon name="message" />Messages</Link>
          <MoreMenuItems />
        </div>
      </div>
    </div>
  );
}
