import { useEffect } from 'react';
import { Link, useOutletContext } from 'react-router';
import { Icon } from '../components/Icon.tsx';
import { Empty, LoadMore } from '../components/ui.tsx';
import { PostCard } from '../components/PostCard.tsx';
import { StoriesBar } from '../components/Stories.tsx';
import { POSTED_EVENT } from '../components/CreatePost.tsx';
import type { ShellContext } from '../components/Layout.tsx';
import { isBusinessType, useSession } from '../lib/session.tsx';
import { usePaged } from '../lib/hooks.ts';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function Home() {
  const { me, can } = useSession();
  const { openCreate } = useOutletContext<ShellContext>();
  const feed = usePaged('/posts/feed');
  const { setItems } = feed;
  const u = me!.user;
  const counts = me?.counts ?? { notifications: 0, messages: 0, cart: 0 };
  const first = (u.display_name ?? u.username).split(' ')[0];
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const status = [
    counts.notifications ? `${counts.notifications} new notification${counts.notifications === 1 ? '' : 's'}` : '',
    counts.messages ? `${counts.messages} unread message${counts.messages === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ') || 'You’re all caught up.';

  // New posts from the Create dialog appear at the top immediately.
  useEffect(() => {
    const onPosted = (e: Event) => setItems((items) => [(e as CustomEvent).detail, ...items]);
    window.addEventListener(POSTED_EVENT, onPosted);
    return () => window.removeEventListener(POSTED_EVENT, onPosted);
  }, [setItems]);

  return (
    <div className="page page-home">
      <header className="today">
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
      </header>

      <StoriesBar />

      <section className="feed">
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
        {feed.items.map((p) => <PostCard key={p.id} post={p} showReason />)}
        {feed.loading && !feed.items.length && Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="card post">
            <div className="row" style={{ marginBottom: 14 }}><span className="skeleton" style={{ width: 42, height: 42, borderRadius: '50%' }} /><span className="skeleton" style={{ width: 160, height: 12 }} /></div>
            <div className="skeleton" style={{ height: 180, borderRadius: 18 }} />
          </div>
        ))}
        {!feed.loading && !feed.items.length && (
          <div className="card"><Empty icon="layers" title="Your feed is empty">Follow businesses and people to fill your feed.</Empty></div>
        )}
        <LoadMore hasMore={feed.hasMore} loading={feed.loading && feed.items.length > 0} onClick={feed.loadMore} />
      </section>
    </div>
  );
}
