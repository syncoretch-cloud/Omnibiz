import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { Icon } from './Icon.tsx';
import { Avatar, Portal, useIndicator } from './ui.tsx';
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

// ───────────── search palette (Ctrl/⌘ K) ─────────────
const RECENT_KEY = 'omnibiz-recent-searches';
function readRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; }
}
export function rememberSearch(q: string) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...readRecent().filter((x) => x !== q)].slice(0, 8))); } catch { /* storage unavailable */ }
}

function SearchPalette({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Json[]>([]);
  const [recent, setRecent] = useState(readRecent);
  const dq = useDebounced(q, 180);
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
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  const go = (term: string) => {
    if (!term.trim()) return;
    rememberSearch(term.trim());
    nav(`/search?q=${encodeURIComponent(term.trim())}`);
    onClose();
  };
  return (
    <Portal>
      <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className="palette" role="dialog" aria-label="Search">
          <form onSubmit={(e) => { e.preventDefault(); go(q); }} className="palette-input">
            <Icon name="search" />
            <input autoFocus placeholder="Search people, jobs, shops, products…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
            <button type="button" className="kbd" onClick={onClose}>Esc</button>
          </form>
          <div className="suggest-box palette-list">
            {q.trim().length >= 2 ? (
              <>
                {items.map((s) => (
                  <Link key={s.href} to={s.href} onClick={() => { rememberSearch(q.trim()); onClose(); }}>
                    {s.kind === 'job' ? <span className="palette-icon"><Icon name="briefcase" /></span>
                      : s.kind === 'product' ? <span className="palette-icon"><Icon name="bag" /></span>
                      : <Avatar user={{ display_name: s.label, avatar_url: s.avatar_url, account_type: s.kind === 'business' ? 'company' : 'personal' }} size={38} />}
                    <div className="grow">
                      <div className="truncate bold small">{s.label}</div>
                      <div className="truncate xsmall muted">{s.sub}</div>
                    </div>
                  </Link>
                ))}
                <a href="#" onClick={(e) => { e.preventDefault(); go(q); }}>
                  <span className="palette-icon"><Icon name="search" /></span>
                  <span className="small">See all results for “<b>{q.trim()}</b>”</span>
                </a>
              </>
            ) : (
              <>
                <div className="row-between" style={{ padding: '2px 10px 6px' }}>
                  <span className="eyebrow">Recent</span>
                  {recent.length > 0 && <button className="text-btn" onClick={() => { try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ } setRecent([]); }}>Clear all</button>}
                </div>
                {recent.length ? recent.map((r) => (
                  <a key={r} href="#" onClick={(e) => { e.preventDefault(); go(r); }}>
                    <span className="palette-icon"><Icon name="clock" /></span>
                    <span className="small grow">{r}</span>
                  </a>
                )) : <p className="muted small center" style={{ padding: 24 }}>Try “solar wholesalers in Dar es Salaam” or “junior developer jobs”.</p>}
              </>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}

// ───────────── create & account menus ─────────────
function CreateMenu({ onPost, onClose }: { onPost: () => void; onClose: () => void }) {
  const { can } = useSession();
  const nav = useNavigate();
  const go = (to: string) => { onClose(); nav(to); };
  return (
    <div className="popover" onMouseDown={(e) => e.stopPropagation()}>
      {can('create_posts') && <button onClick={() => { onClose(); onPost(); }}><Icon name="image" />Post an update</button>}
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
  const [search, setSearch] = useState(false);
  const [menu, setMenu] = useState<'create' | 'me' | 'create-dock' | null>(null);
  const [composer, setComposer] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const closeSearch = useCallback(() => setSearch(false), []);
  useOutside(!!menu, closeMenu, menuRef);

  useEffect(() => {
    setSearch(false);
    setMenu(null);
  }, [loc.pathname]);

  // Ctrl/⌘ K opens search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearch((s) => !s);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const active = useIndicator(navRef, 'a.active', [loc.pathname]);
  const openCreate = useCallback(() => setComposer(true), []);
  const isReels = loc.pathname.startsWith('/reels');
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const sections: [string, string, string][] = [
    ['/', 'home', 'Home'],
    ['/explore', 'compass', 'Discover'],
    ['/reels', 'reels', 'Reels'],
    ...(showJobs ? [['/jobs', 'briefcase', 'Jobs'] as [string, string, string]] : []),
    ['/marketplace', 'bag', 'Market'],
  ];

  return (
    <div className={`shell${isReels ? ' reels-page' : ''}`}>
      <header className="appbar glass">
        <Link to="/" className="appbar-brand" aria-label="OmniBiz home"><Wordmark /></Link>
        <nav className="appbar-nav" aria-label="Main navigation" ref={navRef}>
          {active && <span className="appbar-indicator" style={{ width: active.size, transform: `translateX(${active.pos}px)` }} />}
          {sections.map(([to, icon, label]) => (
            <NavLink key={to} to={to} end={to === '/'} title={label}><Icon name={icon} /><span className="nav-label">{label}</span></NavLink>
          ))}
        </nav>
        <div className="appbar-actions">
          <button className="search-trigger" onClick={() => setSearch(true)} aria-label="Search">
            <Icon name="search" /><span className="search-text">Search OmniBiz</span><kbd className="kbd">{mac ? '⌘' : 'Ctrl'} K</kbd>
          </button>
          {canCreate && (
            <div className="menu-anchor" ref={menu === 'create' ? menuRef : undefined}>
              <button data-menu-toggle className="btn btn-primary create-btn" onClick={() => setMenu((m) => (m === 'create' ? null : 'create'))} aria-label="Create">
                <Icon name="plus" /><span className="create-label">Create</span>
              </button>
              {menu === 'create' && <CreateMenu onPost={openCreate} onClose={closeMenu} />}
            </div>
          )}
          <NavLink to="/messages" className="appbar-icon" aria-label="Messages" title="Messages"><Icon name="message" /><Badge n={counts.messages} /></NavLink>
          <NavLink to="/notifications" className="appbar-icon" aria-label="Notifications" title="Notifications"><Icon name="bell" /><Badge n={counts.notifications} /></NavLink>
          <div className="menu-anchor" ref={menu === 'me' ? menuRef : undefined}>
            <button data-menu-toggle className="appbar-me" onClick={() => setMenu((m) => (m === 'me' ? null : 'me'))} aria-label="Account menu" aria-expanded={menu === 'me'}>
              <Avatar user={u} size={34} />
            </button>
            {menu === 'me' && (
              <div className="popover">
                <Link to={`/u/${u.username}`} className="popover-profile" onClick={closeMenu}>
                  <Avatar user={u} size={40} />
                  <div className="grow"><div className="bold small truncate">{u.display_name}</div><div className="xsmall muted">View your profile</div></div>
                </Link>
                <hr />
                <MoreMenuItems onDone={closeMenu} />
              </div>
            )}
          </div>
        </div>
      </header>

      <header className="topbar glass">
        <Link to="/" aria-label="OmniBiz home"><Wordmark /></Link>
        <button className="icon-btn" onClick={() => setSearch(true)} aria-label="Search"><Icon name="search" /></button>
        <Link to="/notifications" className="icon-btn" aria-label="Notifications"><Icon name="bell" /><Badge n={counts.notifications} /></Link>
        <Link to="/messages" className="icon-btn" aria-label="Messages"><Icon name="message" /><Badge n={counts.messages} /></Link>
        <Link to="/menu" className="topbar-me" aria-label="Your account"><Avatar user={u} size={30} /></Link>
      </header>

      <main className="main">
        {u.status === 'suspended' && (
          <div className="page" style={{ paddingBottom: 0 }}>
            <div className="banner banner-danger"><Icon name="alert" />Your account is suspended{u.suspended_reason ? `: ${u.suspended_reason}` : ''}. Most actions are disabled.</div>
          </div>
        )}
        <div key={routeKey(loc.pathname)} className="route-enter">
          <Outlet context={{ openCreate } satisfies ShellContext} />
        </div>
      </main>

      <nav className="dock glass" aria-label="Main">
        <NavLink to="/" end><Icon name="home" /><span className="dock-label">Home</span></NavLink>
        <NavLink to="/explore"><Icon name="compass" /><span className="dock-label">Discover</span></NavLink>
        {canCreate && (
          <div className="dock-create" ref={menu === 'create-dock' ? menuRef : undefined}>
            <button data-menu-toggle className="create-fab" onClick={() => setMenu((m) => (m === 'create-dock' ? null : 'create-dock'))} aria-label="Create"><Icon name="plus" /></button>
            {menu === 'create-dock' && <CreateMenu onPost={openCreate} onClose={closeMenu} />}
          </div>
        )}
        <NavLink to="/reels"><Icon name="reels" /><span className="dock-label">Reels</span></NavLink>
        {personal && showJobs
          ? <NavLink to="/jobs"><Icon name="briefcase" /><span className="dock-label">Jobs</span></NavLink>
          : <NavLink to="/marketplace"><Icon name="bag" /><span className="dock-label">Market</span></NavLink>}
      </nav>

      {search && <SearchPalette onClose={closeSearch} />}
      {composer && <CreatePostModal onClose={() => setComposer(false)} />}
    </div>
  );
}

/** Mobile account page (reached from the avatar in the top bar). */
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
            <div className="small muted">@{u?.username} · View profile</div>
          </div>
          <Icon name="chevronRight" size={18} />
        </Link>
      </div>
      <div className="card mt" style={{ padding: 8 }}>
        <div className="dropdown-menu" style={{ position: 'static', animation: 'none', boxShadow: 'none', background: 'none', border: 0, backdropFilter: 'none' }}>
          <Link to="/explore"><Icon name="compass" />Discover</Link>
          <Link to="/search"><Icon name="search" />Search</Link>
          {me?.user.account_type !== 'customer' && <Link to="/jobs"><Icon name="briefcase" />Jobs</Link>}
          <Link to="/marketplace"><Icon name="bag" />Market</Link>
          <Link to="/notifications"><Icon name="bell" />Notifications</Link>
          <Link to="/messages"><Icon name="message" />Messages</Link>
          <MoreMenuItems />
        </div>
      </div>
    </div>
  );
}
