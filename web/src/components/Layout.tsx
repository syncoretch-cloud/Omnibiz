import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { Icon } from './Icon.tsx';
import { Avatar, Modal, Portal } from './ui.tsx';
import { CreatePostModal } from './CreatePost.tsx';
import { StoryCreator } from './StoryCreator.tsx';
import { isBusinessType, useSession, useToast } from '../lib/session.tsx';
import { get } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { REFRESH_EVENT, useDebounced, useScrollHide } from '../lib/hooks.ts';
import { tick, thump } from '../lib/haptics.ts';
import { warm } from '../lib/prefetch.ts';
import { SHORTCUTS, useShortcuts } from '../lib/shortcuts.tsx';

export interface ShellContext {
  openCreate: () => void;
  openSearch: () => void;
}

/** The OmniBiz logo artwork, large (sign-in and onboarding). */
export function Wordmark({ className = '' }: { className?: string }) {
  return <span className={`brand-mark brand-mark-lg ${className}`}><img src="/brand/omnibiz-logo.png" alt="OmniBiz" /></span>;
}

export function Ambient() {
  return <div className="ambient" aria-hidden="true" />;
}

const Badge = ({ n }: { n: number }) => (n > 0 ? <span className="badge-dot">{n > 99 ? '99+' : n}</span> : null);

/** Route-level enter animation; nested areas (dashboard/settings) animate their own sections. */
function routeKey(pathname: string) {
  const first = pathname.split('/')[1] ?? '';
  return ['dashboard', 'settings'].includes(first) ? first : pathname;
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
      {can('manage_cv') && <Link to={`/u/${me?.user.username}?tab=about`} onClick={onDone}><Icon name="file" />My CV & documents</Link>}
      <Link to="/businesses" onClick={onDone}><Icon name="building" />Businesses & map</Link>
      <Link to="/saved" onClick={onDone}><Icon name="bookmark" />Saved</Link>
      {can('purchase') && <Link to="/cart" onClick={onDone}><Icon name="cart" />Cart{counts.cart > 0 && <span className="chip chip-brand" style={{ marginLeft: 'auto', height: 22 }}>{counts.cart}</span>}</Link>}
      {can('purchase') && <Link to="/orders" onClick={onDone}><Icon name="package" />My orders</Link>}
      {isStaff && <a href={import.meta.env.VITE_ADMIN_URL ?? 'http://localhost:5180'} target="_blank" rel="noreferrer" onClick={onDone}><Icon name="shield" />OmniBiz Manager</a>}
      <Link to="/settings" onClick={onDone}><Icon name="settings" />Settings</Link>
      <hr />
      <button onClick={async () => { onDone?.(); await logout(); nav('/'); }}><Icon name="logout" />Log out</button>
    </>
  );
}

/// ───────────── shell: navigation · content · context panels ─────────────
/** Top-level destinations: on phones these show the brand in the top bar; other pages show a back arrow and a title. */
const ROOTS: Record<string, string> = { '/': 'Home', '/explore': 'Discover', '/jobs': 'Jobs', '/marketplace': 'Market', '/notifications': 'Notifications', '/messages': 'Messages' };
const TITLES: [RegExp, string][] = [
  [/^\/posts\//, 'Post'], [/^\/jobs\/\d+/, 'Job'], [/^\/marketplace\/compare/, 'Compare'], [/^\/marketplace\/\d+/, 'Product'],
  [/^\/messages\/\d+/, 'Messages'], [/^\/businesses/, 'Businesses'], [/^\/cart/, 'Cart'], [/^\/orders\/\d+/, 'Order'], [/^\/orders/, 'Orders'],
  [/^\/search/, 'Search'], [/^\/saved/, 'Saved'], [/^\/me\/cv/, 'My CV'], [/^\/settings/, 'Settings'], [/^\/dashboard/, 'Dashboard'],
  [/^\/menu/, 'Account'],
];
function pageTitle(pathname: string) {
  if (ROOTS[pathname]) return ROOTS[pathname];
  const profile = /^\/u\/([^/]+)/.exec(pathname);
  if (profile) return `@${decodeURIComponent(profile[1])}`;
  return TITLES.find(([re]) => re.test(pathname))?.[1] ?? '';
}

export function AppLayout() {
  const { me, can } = useSession();
  const loc = useLocation();
  const nav = useNavigate();
  const u = me!.user;
  const counts = me?.counts ?? { notifications: 0, messages: 0, cart: 0 };
  const showJobs = u.account_type !== 'customer';
  const biz = isBusinessType(u.account_type);
  const canCreate = can('create_posts') || can('manage_products') || can('create_jobs');
  const [search, setSearch] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [composer, setComposer] = useState(false);
  const [storying, setStorying] = useState(false);
  // The "More" menu at the bottom of the rail (settings, saved, orders, log out).
  const [meMenu, setMeMenu] = useState(false);
  const meRef = useRef<HTMLDivElement>(null);
  const [help, setHelp] = useState(false);
  const toast = useToast();
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

  // The menu closes on any click outside it, or Esc.
  useEffect(() => {
    if (!meMenu) return;
    const close = (e: MouseEvent) => meRef.current && !meRef.current.contains(e.target as Node) && setMeMenu(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMeMenu(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [meMenu]);

  const openCreate = useCallback(() => setComposer(true), []);

  // The browser tab shows where you are and how much is waiting for you: "(3) Messages · OmniBiz".
  const unread = counts.notifications + counts.messages;
  useEffect(() => {
    const t = pageTitle(loc.pathname);
    document.title = `${unread > 0 ? `(${unread > 99 ? '99+' : unread}) ` : ''}${t && t !== 'Home' ? `${t} · ` : ''}OmniBiz`;
  }, [loc.pathname, unread]);

  // Say so when the connection drops or comes back, as a browser would.
  useEffect(() => {
    const off = () => toast('You’re offline. Changes will fail until you reconnect.', 'error');
    const on = () => toast('Back online', 'success');
    window.addEventListener('offline', off);
    window.addEventListener('online', on);
    return () => { window.removeEventListener('offline', off); window.removeEventListener('online', on); };
  }, [toast]);

  // Phones: the bars slip away while you read down the page and return the moment you scroll up.
  const hidden = useScrollHide();
  const create = () => setSheet(true);
  useShortcuts({ search: () => setSearch(true), create: () => (canCreate ? setSheet(true) : undefined), help: () => setHelp(true), jobs: showJobs });
  const root = loc.pathname in ROOTS;
  const title = pageTitle(loc.pathname);
  // Back goes to the previous screen in the app, or Home when the page was opened directly.
  const back = () => ((window.history.state?.idx ?? 0) > 0 ? nav(-1) : nav('/'));
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);

  // Tapping the tab you are already on takes you back to the top; on Home it also refreshes the feed (like every social app).
  const retap = (to: string) => (e: React.MouseEvent) => {
    tick();
    if (loc.pathname !== to) return;
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.getElementById('app-scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
    if (to === '/') window.dispatchEvent(new Event(REFRESH_EVENT));
  };
  const link = (to: string, icon: ReactNode, label: string, badge = 0, key = label.toLowerCase()) => (
    <NavLink to={to} end={to === '/'} className="nav-link" aria-label={label} data-label={label} data-icon={key} onClick={retap(to)} {...warm(to)}>
      {icon}<span className="nav-label">{label}</span><Badge n={badge} />
    </NavLink>
  );

  return (
    <div className={`shell${hidden ? ' chrome-hidden' : ''}`}>
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
        <Link to="/notifications" className={`icon-btn${counts.notifications > 0 ? ' has-new' : ''}`} data-icon="bell" aria-label="Notifications" onClick={tick} {...warm('/notifications')}><span key={counts.notifications} className="icon-anim"><Icon name="bell" /></span><Badge n={counts.notifications} /></Link>
        <Link to="/messages" className={`icon-btn${counts.messages > 0 ? ' has-new' : ''}`} data-icon="message" aria-label="Messages" onClick={tick} {...warm('/messages')}><span key={counts.messages} className="icon-anim"><Icon name="message" /></span><Badge n={counts.messages} /></Link>
        <Link to="/menu" className="topbar-me" aria-label="Your account"><Avatar user={u} size={30} /></Link>
      </header>

      {/* tablets and computers: navigation panel */}
      <aside className="panel panel-nav" aria-label="Main navigation">
        <Link to="/" className="brand-mark" aria-label="OmniBiz home"><img className="brand-word" src="/brand/omnibiz-logo-sm.png" alt="OmniBiz" /><img className="brand-o" src="/brand/omnibiz-mark.png" alt="" /></Link>
        {canCreate && <button className="btn btn-primary nav-create" onClick={() => { thump(); create(); }} aria-label="Create" data-label="Create"><Icon name="plus" /><span className="nav-label">Create</span></button>}
        <nav className="nav-list">
          {link('/', <Icon name="home" />, 'Home')}
          {link('/explore', <Icon name="compass" />, 'Discover')}
          <span className="nav-sep" />
          {showJobs && link('/jobs', <Icon name="briefcase" />, 'Jobs')}
          {link('/marketplace', <Icon name="bag" />, 'Market')}
          {link('/businesses', <Icon name="building" />, 'Businesses')}
          <span className="nav-sep" />
          {link('/messages', <Icon name="message" />, 'Messages', counts.messages)}
          {link('/notifications', <Icon name="bell" />, 'Notifications', counts.notifications)}
          <span className="nav-sep" />
          {biz && link('/dashboard', <Icon name="dashboard" />, 'Dashboard')}
          {link('/saved', <Icon name="bookmark" />, 'Saved')}
        </nav>
        <div className="nav-me" ref={meRef}>
          {/* Profile: the page opens in the middle, the rail stays where it is */}
          <NavLink to={`/u/${u.username}`} className="nav-link nav-avatar" aria-label="Profile" data-label="Profile" data-icon="profile" onClick={retap(`/u/${u.username}`)} {...warm(`/u/${u.username}`)}>
            <Avatar user={u} size={30} />
          </NavLink>
          <button className={`nav-link${meMenu ? ' open' : ''}`} onClick={() => { tick(); setMeMenu((m) => !m); }} aria-expanded={meMenu} aria-label="More" data-label="More" data-icon="more">
            <Icon name="menu" />
          </button>
          {meMenu && (
            <div className="popover nav-me-menu">
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
          <Outlet context={{ openCreate, openSearch: () => setSearch(true) } satisfies ShellContext} />
        </div>
      </main>


      {/* phones: bottom tabs */}
      <nav className="dock glass" aria-label="Main">
        <NavLink to="/" end data-icon="home" onClick={retap('/')}><Icon name="home" /><span className="dock-label">Home</span></NavLink>
        <NavLink to="/explore" data-icon="discover" onClick={retap('/explore')} {...warm('/explore')}><Icon name="compass" /><span className="dock-label">Discover</span></NavLink>
        {canCreate && <button className="create-fab" onClick={() => { thump(); create(); }} aria-label="Create"><Icon name="plus" /></button>}
        <NavLink to="/marketplace" data-icon="market" onClick={retap('/marketplace')} {...warm('/marketplace')}><Icon name="bag" /><span className="dock-label">Market</span></NavLink>
        {showJobs && <NavLink to="/jobs" data-icon="jobs" onClick={retap('/jobs')} {...warm('/jobs')}><Icon name="briefcase" /><span className="dock-label">Jobs</span></NavLink>}
      </nav>

      {sheet && <CreateSheet onPost={openCreate} onStory={() => setStorying(true)} onClose={closeSheet} />}
      {search && <SearchPalette onClose={closeSearch} />}
      {composer && <CreatePostModal onClose={() => setComposer(false)} />}
      {storying && <StoryCreator onClose={() => setStorying(false)} />}
      {help && (
        <Modal title="Keyboard shortcuts" onClose={() => setHelp(false)}>
          <div className="shortcuts">
            {SHORTCUTS.map(([keys, what]) => (
              <div key={keys} className="shortcut"><span>{what}</span><span className="row" style={{ gap: 4 }}>{keys.split(' ').map((k, i) => (k === '/' && keys.includes(' / ') ? <span key={i} className="muted">or</span> : k === 'then' ? <span key={i} className="muted xsmall">then</span> : <kbd key={i} className="kbd">{k}</kbd>))}</span></div>
            ))}
          </div>
        </Modal>
      )}
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
