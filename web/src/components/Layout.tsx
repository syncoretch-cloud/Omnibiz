import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { Icon } from './Icon.tsx';
import { Avatar, Portal } from './ui.tsx';
import { Board } from './Board.tsx';
import { CreatePostModal } from './CreatePost.tsx';
import { StoryCreator } from './StoryCreator.tsx';
import { isBusinessType, useSession } from '../lib/session.tsx';
import { get } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { useDebounced } from '../lib/hooks.ts';

export interface ShellContext {
  openCreate: () => void;
}

/** The OmniBiz logo artwork, large (sign-in and onboarding). */
export function Wordmark({ className = '' }: { className?: string }) {
  return <span className={`brand-mark brand-mark-lg ${className}`}><img src="/brand/omnibiz-logo.png" alt="OmniBiz" /></span>;
}

export function Ambient() {
  return <div className="ambient" aria-hidden="true" />;
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

// ───────────── create sheet & account menu ─────────────
/** Slide-up sheet of things to create, sized for thumbs. */
function CreateSheet({ onPost, onStory, onClose }: { onPost: () => void; onStory: () => void; onClose: () => void }) {
  const { can } = useSession();
  const nav = useNavigate();
  const go = (to: string) => { onClose(); nav(to); };
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  const options: [boolean, string, string, string, () => void][] = [
    [can('create_posts'), 'image', 'Post', 'Photos, video, music or a text update', () => { onClose(); onPost(); }],
    [can('create_posts'), 'clock', 'Story', 'Gone after 24 hours', () => { onClose(); onStory(); }],
    [can('manage_products'), 'bag', 'Product', 'List something to sell', () => go('/dashboard/products?new=1')],
    [can('create_jobs'), 'briefcase', 'Job', 'Hire for a vacancy', () => go('/dashboard/jobs?new=1')],
    [can('publish_announcements'), 'megaphone', 'Announcement', 'Price changes, launches, openings', () => go('/dashboard/announcements')],
  ];
  return (
    <Portal>
      <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className="sheet" role="dialog" aria-label="Create">
          <span className="sheet-grip" aria-hidden="true" />
          <h3 className="sheet-title">Create</h3>
          <div className="create-options">
            {options.filter(([ok]) => ok).map(([, icon, title, hint, run]) => (
              <button key={title} className="create-option" onClick={run}>
                <span className="create-option-icon"><Icon name={icon} /></span>
                <span className="bold">{title}</span>
                <span className="xsmall muted">{hint}</span>
              </button>
            ))}
          </div>
          <button className="btn btn-ghost btn-block" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Portal>
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
      <hr />
      <button onClick={async () => { onDone?.(); await logout(); nav('/'); }}><Icon name="logout" />Log out</button>
    </>
  );
}

/// ───────────── shell: navigation · content · context panels ─────────────
/** Top-level destinations: on phones these show the brand in the top bar; other pages show a back arrow and a title. */
const ROOTS: Record<string, string> = { '/': 'Home', '/explore': 'Discover', '/reels': 'Reels', '/jobs': 'Jobs', '/marketplace': 'Market', '/notifications': 'Notifications', '/messages': 'Messages' };
const TITLES: [RegExp, string][] = [
  [/^\/posts\//, 'Post'], [/^\/jobs\/\d+/, 'Job'], [/^\/marketplace\/compare/, 'Compare'], [/^\/marketplace\/\d+/, 'Product'],
  [/^\/messages\/\d+/, 'Messages'], [/^\/businesses/, 'Businesses'], [/^\/cart/, 'Cart'], [/^\/orders\/\d+/, 'Order'], [/^\/orders/, 'Orders'],
  [/^\/search/, 'Search'], [/^\/saved/, 'Saved'], [/^\/me\/cv/, 'My CV'], [/^\/settings/, 'Settings'], [/^\/dashboard/, 'Dashboard'],
  [/^\/admin/, 'Admin'], [/^\/menu/, 'Account'],
];
function pageTitle(pathname: string) {
  if (ROOTS[pathname]) return ROOTS[pathname];
  const profile = /^\/u\/([^/]+)/.exec(pathname);
  if (profile) return `@${decodeURIComponent(profile[1])}`;
  return TITLES.find(([re]) => re.test(pathname))?.[1] ?? '';
}
/** Pages that need the full width: the context panel steps aside for them. */
const WIDE = [/^\/reels/, /^\/messages/, /^\/marketplace/, /^\/businesses/, /^\/dashboard/, /^\/admin/, /^\/settings/, /^\/cart/, /^\/orders/, /^\/me\/cv/];

export function AppLayout() {
  const { me, can } = useSession();
  const loc = useLocation();
  const nav = useNavigate();
  const u = me!.user;
  const counts = me?.counts ?? { notifications: 0, messages: 0, cart: 0 };
  const showJobs = u.account_type !== 'customer';
  const personal = u.account_type === 'personal';
  const biz = isBusinessType(u.account_type);
  const canCreate = can('create_posts') || can('manage_products') || can('create_jobs');
  const [search, setSearch] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [composer, setComposer] = useState(false);
  const [storying, setStorying] = useState(false);
  const [meMenu, setMeMenu] = useState(false);
  const meRef = useRef<HTMLDivElement>(null);
  const closeSearch = useCallback(() => setSearch(false), []);
  const closeSheet = useCallback(() => setSheet(false), []);

  useEffect(() => {
    setSearch(false);
    setSheet(false);
    setMeMenu(false);
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

  // The account menu closes on any click outside it.
  useEffect(() => {
    if (!meMenu) return;
    const close = (e: MouseEvent) => meRef.current && !meRef.current.contains(e.target as Node) && setMeMenu(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [meMenu]);

  const openCreate = useCallback(() => setComposer(true), []);
  const create = () => setSheet(true);
  const isReels = loc.pathname.startsWith('/reels');
  const root = loc.pathname in ROOTS;
  const wide = WIDE.some((re) => re.test(loc.pathname));
  const title = pageTitle(loc.pathname);
  // Back goes to the previous screen in the app, or Home when the page was opened directly.
  const back = () => ((window.history.state?.idx ?? 0) > 0 ? nav(-1) : nav('/'));
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);

  const link = (to: string, icon: ReactNode, label: string, badge = 0) => (
    <NavLink to={to} end={to === '/'} className="nav-link" title={label}>
      {icon}<span className="nav-label">{label}</span><Badge n={badge} />
    </NavLink>
  );

  return (
    <div className={`shell${wide ? ' no-side' : ''}${isReels ? ' reels-page' : ''}`}>
      {/* phones: top bar */}
      <header className="topbar glass">
        {root ? (
          <Link to="/" className="brand-mark" aria-label="OmniBiz home"><img className="brand-word" src="/brand/omnibiz-logo-sm.png" alt="OmniBiz" /></Link>
        ) : (
          <>
            <button className="icon-btn topbar-back" onClick={back} aria-label="Back"><Icon name="arrowLeft" /></button>
            <span className="topbar-title truncate">{title}</span>
          </>
        )}
        <button className="icon-btn" onClick={() => setSearch(true)} aria-label="Search"><Icon name="search" /></button>
        <Link to="/notifications" className="icon-btn" aria-label="Notifications"><Icon name="bell" /><Badge n={counts.notifications} /></Link>
        <Link to="/messages" className="icon-btn" aria-label="Messages"><Icon name="message" /><Badge n={counts.messages} /></Link>
        <Link to="/menu" className="topbar-me" aria-label="Your account"><Avatar user={u} size={30} /></Link>
      </header>

      {/* tablets and computers: navigation panel */}
      <aside className="panel panel-nav" aria-label="Main navigation">
        <Link to="/" className="brand-mark" aria-label="OmniBiz home"><img className="brand-word" src="/brand/omnibiz-logo-sm.png" alt="OmniBiz" /><img className="brand-o" src="/brand/omnibiz-mark.png" alt="" /></Link>
        <nav className="nav-list">
          {link('/', <Icon name="home" />, 'Home')}
          {link('/explore', <Icon name="compass" />, 'Discover')}
          {link('/reels', <Icon name="reels" />, 'Reels')}
          {showJobs && link('/jobs', <Icon name="briefcase" />, 'Jobs')}
          {link('/marketplace', <Icon name="bag" />, 'Market')}
          {link('/businesses', <Icon name="building" />, 'Businesses')}
          <span className="nav-sep" />
          {link('/messages', <Icon name="message" />, 'Messages', counts.messages)}
          {link('/notifications', <Icon name="bell" />, 'Notifications', counts.notifications)}
          {biz && link('/dashboard', <Icon name="dashboard" />, 'Dashboard')}
          {can('manage_cv') && link('/me/cv', <Icon name="file" />, 'My CV')}
          {link('/saved', <Icon name="bookmark" />, 'Saved')}
        </nav>
        {canCreate && <button className="btn btn-primary nav-create" onClick={create} title="Create"><Icon name="plus" /><span className="nav-label">Create</span></button>}
        <div className="nav-me" ref={meRef}>
          <button className="nav-me-btn" onClick={() => setMeMenu((m) => !m)} aria-expanded={meMenu} aria-label="Account menu">
            <Avatar user={u} size={36} />
            <span className="nav-label nav-me-text"><b className="truncate">{u.display_name}</b><span className="truncate">@{u.username}</span></span>
            <span className="nav-label"><Icon name="more" /></span>
          </button>
          {meMenu && (
            <div className="popover nav-me-menu">
              <Link to={`/u/${u.username}`} onClick={() => setMeMenu(false)}><Icon name="user" />View profile</Link>
              <MoreMenuItems onDone={() => setMeMenu(false)} />
            </div>
          )}
        </div>
      </aside>

      {/* content panel; on phones it is simply the page */}
      <main className="panel-main" id="app-scroll">
        <header className="panel-head">
          {!root && <button className="icon-btn" onClick={back} aria-label="Back"><Icon name="arrowLeft" /></button>}
          <h2 className="panel-title truncate">{title}</h2>
          <button className="search-trigger" onClick={() => setSearch(true)} aria-label="Search">
            <Icon name="search" /><span className="search-text">Search people, jobs, shops…</span><kbd className="kbd">{mac ? '⌘' : 'Ctrl'} K</kbd>
          </button>
        </header>
        {u.status === 'suspended' && (
          <div className="page" style={{ paddingBottom: 0 }}>
            <div className="banner banner-danger"><Icon name="alert" />Your account is suspended{u.suspended_reason ? `: ${u.suspended_reason}` : ''}. Most actions are disabled.</div>
          </div>
        )}
        <div key={routeKey(loc.pathname)} className="route-enter">
          <Outlet context={{ openCreate } satisfies ShellContext} />
        </div>
      </main>

      {/* computers: context panel */}
      {!wide && <aside className="panel panel-side" aria-label="For you"><Board /></aside>}

      {/* phones: bottom tabs */}
      <nav className="dock glass" aria-label="Main">
        <NavLink to="/" end><Icon name="home" /><span className="dock-label">Home</span></NavLink>
        <NavLink to="/explore"><Icon name="compass" /><span className="dock-label">Discover</span></NavLink>
        {canCreate && <button className="create-fab" onClick={create} aria-label="Create"><Icon name="plus" /></button>}
        <NavLink to="/reels"><Icon name="reels" /><span className="dock-label">Reels</span></NavLink>
        {personal && showJobs
          ? <NavLink to="/jobs"><Icon name="briefcase" /><span className="dock-label">Jobs</span></NavLink>
          : <NavLink to="/marketplace"><Icon name="bag" /><span className="dock-label">Market</span></NavLink>}
      </nav>

      {sheet && <CreateSheet onPost={openCreate} onStory={() => setStorying(true)} onClose={closeSheet} />}
      {search && <SearchPalette onClose={closeSearch} />}
      {composer && <CreatePostModal onClose={() => setComposer(false)} />}
      {storying && <StoryCreator onClose={() => setStorying(false)} />}
    </div>
  );
}

/** Account page, reached from the avatar in the top bar. */
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
