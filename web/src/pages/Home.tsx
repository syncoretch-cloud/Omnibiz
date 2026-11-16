import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import { Icon } from '../components/Icon.tsx';
import { Empty, LoadMore, PullIndicator } from '../components/ui.tsx';
import { PostCard } from '../components/PostCard.tsx';
import { StoriesBar } from '../components/Stories.tsx';
import { POSTED_EVENT } from '../components/CreatePost.tsx';
import type { ShellContext } from '../components/Layout.tsx';
import { isBusinessType, useSession, useToast } from '../lib/session.tsx';
import { REFRESH_EVENT, usePaged, usePullToRefresh } from '../lib/hooks.ts';
import { buzz } from '../lib/haptics.ts';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** What the feed shows. "For you" is the ranked feed; the others are posts of one kind from any business. */
const FEEDS = [
  { id: 'foryou', label: 'For you', icon: 'sparkles', path: '/posts/feed', empty: 'Follow businesses and people to fill your feed.' },
  { id: 'hiring', label: 'Hiring', icon: 'briefcase', path: '/posts?kind=hiring', empty: 'No vacancies posted just now.' },
  { id: 'offers', label: 'Offers', icon: 'tag', path: '/posts?kind=promotion,offer', empty: 'No promotions or offers yet.' },
  { id: 'products', label: 'Products', icon: 'bag', path: '/posts?kind=product,service', empty: 'No new products or services yet.' },
  { id: 'news', label: 'News', icon: 'megaphone', path: '/posts?kind=news,event,update', empty: 'No news or events yet.' },
] as const;

export function Home() {
  const { me, can } = useSession();
  const { openCreate, openSearch } = useOutletContext<ShellContext>();
  const [feedId, setFeedId] = useState<(typeof FEEDS)[number]['id']>('foryou');
  const current = FEEDS.find((f) => f.id === feedId)!;
  const feed = usePaged(current.path);
  const { setItems, reload } = feed;
  const toast = useToast();
  const refresh = async () => { buzz(); reload(); };
  const pull = usePullToRefresh(refresh);
  const u = me!.user;
  const counts = me?.counts ?? { notifications: 0, messages: 0, cart: 0 };
  const first = (u.display_name ?? u.username).split(' ')[0];
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const status = [
    counts.notifications ? `${counts.notifications} new notification${counts.notifications === 1 ? '' : 's'}` : '',
    counts.messages ? `${counts.messages} unread message${counts.messages === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ') || 'You’re all caught up.';
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);

  // New posts from the Create dialog appear at the top immediately.
  useEffect(() => {
    const onPosted = (e: Event) => feedId === 'foryou' && setItems((items) => [(e as CustomEvent).detail, ...items]);
    window.addEventListener(POSTED_EVENT, onPosted);
    return () => window.removeEventListener(POSTED_EVENT, onPosted);
  }, [setItems, feedId]);

  // Re-tapping Home refreshes too.
  useEffect(() => {
    const on = () => { reload(); toast('Feed refreshed'); };
    window.addEventListener(REFRESH_EVENT, on);
    return () => window.removeEventListener(REFRESH_EVENT, on);
  }, [reload, toast]);

  return (
    <div className="page page-home" style={pull.state === 'idle' ? undefined : { transform: `translateY(${pull.pull * 0.55}px)`, transition: pull.state === 'refreshing' ? 'transform 0.3s var(--ease-out)' : 'none' }}>
      <PullIndicator {...pull} />
      <header className="home-hero">
        <div className="today">
          <div>
            <span className="eyebrow"><span className="orbit" />{today}</span>
            <h1 className="today-title">{greeting()}, <em>{first}</em></h1>
            <p className="muted small">{status}</p>
          </div>
          <div className="today-actions">
            {can('create_posts') && <button className="btn btn-primary" onClick={openCreate}><Icon name="edit" />Share an update</button>}
            {u.account_type === 'personal' && <Link to="/jobs" className="btn btn-outline"><Icon name="briefcase" />Find jobs</Link>}
            {u.account_type === 'customer' && <Link to="/marketplace" className="btn btn-outline"><Icon name="bag" />Browse market</Link>}
          </div>
        </div>
        <button className="home-search" onClick={openSearch} aria-label="Search">
          <Icon name="search" />
          <span>Search people, jobs, shops and products</span>
          <kbd className="kbd">{mac ? '⌘' : 'Ctrl'} K</kbd>
        </button>
        <div className="tabs home-pills" role="tablist" aria-label="Feed">
          {FEEDS.map((f) => (
            <button key={f.id} role="tab" aria-selected={feedId === f.id} className={`tab has-icon${feedId === f.id ? ' active' : ''}`} onClick={() => setFeedId(f.id)}>
              <Icon name={f.icon} /><span className="tab-text">{f.label}</span>
            </button>
          ))}
        </div>
      </header>

      <StoriesBar />

      {feedId === 'foryou' && (
        <div className="feed-notes">
          {u.account_type === 'personal' && !me?.profile?.headline && (
            <div className="banner banner-info">
              <Icon name="sparkles" />
              <div className="grow small">Build your CV to get matched to jobs automatically.</div>
              <Link to="/me/cv" className="btn btn-sm btn-primary">Build CV</Link>
            </div>
          )}
          {isBusinessType(u.account_type) && !me?.business?.description && (
            <div className="banner banner-info">
              <Icon name="building" />
              <div className="grow small">Complete your business profile so customers can find you.</div>
              <Link to="/settings/business" className="btn btn-sm btn-primary">Complete</Link>
            </div>
          )}
        </div>
      )}

      <section className="feed" aria-label={current.label}>
        <div className="feed-grid">
          {feed.items.map((p) => <PostCard key={p.id} post={p} gallery />)}
          {feed.loading && !feed.items.length && Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="card post gallery skeleton-card">
              <div className="skeleton" style={{ height: [220, 300, 180, 260, 200, 280][i] }} />
              <div className="row" style={{ margin: '12px 14px' }}><span className="skeleton" style={{ width: 28, height: 28, borderRadius: '50%' }} /><span className="skeleton" style={{ width: 120, height: 12 }} /></div>
            </div>
          ))}
        </div>
        {!feed.loading && !feed.items.length && (
          <div className="card"><Empty icon="layers" title={feedId === 'foryou' ? 'Your feed is empty' : `Nothing in ${current.label} yet`}>{current.empty}</Empty></div>
        )}
        <LoadMore hasMore={feed.hasMore} loading={feed.loading && feed.items.length > 0} onClick={feed.loadMore} />
      </section>
    </div>
  );
}
