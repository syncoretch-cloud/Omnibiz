import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import { Icon } from '../components/Icon.tsx';
import { Avatar, Empty, LoadMore, Verified } from '../components/ui.tsx';
import { PostCard } from '../components/PostCard.tsx';
import { StoriesBar } from '../components/Stories.tsx';
import { POSTED_EVENT } from '../components/CreatePost.tsx';
import type { ShellContext } from '../components/Layout.tsx';
import { isBusinessType, useAction, useSession } from '../lib/session.tsx';
import { useApi, usePaged } from '../lib/hooks.ts';
import { post } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { ACCOUNT_LABEL, salary } from '../lib/format.ts';

function SuggestionRow({ u }: { u: Json }) {
  const act = useAction();
  const { industryName } = useSession();
  const [following, setFollowing] = useState(false);
  return (
    <div className="widget-row">
      <Link to={`/u/${u.username}`}><Avatar user={u} size={38} /></Link>
      <div className="grow" style={{ lineHeight: 1.25 }}>
        <Link to={`/u/${u.username}`} className="bold small row" style={{ gap: 4, color: 'var(--text)' }}><span className="truncate">{u.display_name}</span><Verified show={u.verified} /></Link>
        <div className="xsmall muted truncate">{u.category ? industryName(u.category) : ACCOUNT_LABEL[u.account_type]}{u.city ? ` · ${u.city}` : ''}</div>
      </div>
      <button className={`btn btn-sm ${following ? 'btn-ghost' : 'btn-outline'}`} disabled={following} onClick={async () => { if (await act(() => post(`/users/${u.id}/follow`))) setFollowing(true); }}>
        {following ? <Icon name="check" /> : 'Follow'}
      </button>
    </div>
  );
}

/** Right-hand column of widget cards: you, jobs matched to you, businesses to follow, what's trending. */
function Board() {
  const { me, can, industryName } = useSession();
  const u = me!.user;
  const suggestions = useApi('/users/suggestions?limit=4');
  const jobs = useApi(can('apply_jobs') ? '/jobs/recommended?limit=3' : null);
  const tags = useApi('/posts/trending-tags');
  return (
    <aside className="board">
      <div className="card widget me-widget">
        <Link to={`/u/${u.username}`} className="row" style={{ color: 'inherit' }}>
          <Avatar user={u} size={48} />
          <div className="grow" style={{ lineHeight: 1.3 }}>
            <div className="bold truncate">{u.display_name}</div>
            <div className="xsmall muted truncate">@{u.username} · {me?.business ? industryName(me.business.category) : ACCOUNT_LABEL[u.account_type]}</div>
          </div>
        </Link>
        <div className="me-links">
          <Link to={`/u/${u.username}`}><Icon name="user" />Profile</Link>
          {isBusinessType(u.account_type) ? <Link to="/dashboard"><Icon name="chart" />Dashboard</Link> : can('manage_cv') ? <Link to="/me/cv"><Icon name="file" />My CV</Link> : <Link to="/orders"><Icon name="package" />Orders</Link>}
          <Link to="/saved"><Icon name="bookmark" />Saved</Link>
        </div>
      </div>

      {jobs.data?.items?.length > 0 && (
        <div className="card widget">
          <div className="widget-head"><span className="eyebrow"><span className="orbit" />Jobs for you</span><Link to="/jobs" className="text-btn">See all</Link></div>
          {jobs.data.items.map((j: Json) => (
            <Link key={j.id} to={`/jobs/${j.id}?src=feed`} className="widget-row">
              <Avatar user={j.company} size={38} square />
              <div className="grow" style={{ lineHeight: 1.25 }}>
                <div className="bold small truncate">{j.title}</div>
                <div className="xsmall muted truncate">{j.company?.display_name} · {salary(j)}</div>
              </div>
              {j.match && <span className="match-pill">{j.match.score}%</span>}
            </Link>
          ))}
        </div>
      )}

      {suggestions.data?.users?.length > 0 && (
        <div className="card widget">
          <div className="widget-head"><span className="eyebrow"><span className="orbit" />Businesses to follow</span><Link to="/businesses" className="text-btn">See all</Link></div>
          {suggestions.data.users.map((s: Json) => <SuggestionRow key={s.id} u={s} />)}
        </div>
      )}

      {tags.data?.tags?.length > 0 && (
        <div className="card widget">
          <div className="widget-head"><span className="eyebrow"><span className="orbit" />Trending</span></div>
          <div className="row-wrap">
            {tags.data.tags.slice(0, 8).map((t: Json) => <Link key={t.tag} to={`/search?q=${encodeURIComponent('#' + t.tag)}&type=posts`} className="chip"><Icon name="hash" />{t.tag}</Link>)}
          </div>
        </div>
      )}

      <div className="board-foot">About · Help · Jobs · Market · Businesses · Privacy · Terms<div>© 2026 OMNIBIZ</div></div>
    </aside>
  );
}

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

      <StoriesBar onCreate={openCreate} />

      <div className="home-grid">
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
        <Board />
      </div>
    </div>
  );
}
