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
    <div className="rail-row">
      <Link to={`/u/${u.username}`}><Avatar user={u} size={40} /></Link>
      <div className="grow" style={{ lineHeight: 1.25 }}>
        <Link to={`/u/${u.username}`} className="bold small row" style={{ gap: 4, color: 'var(--text)' }}><span className="truncate">{u.username}</span><Verified show={u.verified} /></Link>
        <div className="xsmall muted truncate">{u.category ? industryName(u.category) : ACCOUNT_LABEL[u.account_type]}{u.city ? ` · ${u.city}` : ''}</div>
      </div>
      <button className="text-btn" disabled={following} onClick={async () => { if (await act(() => post(`/users/${u.id}/follow`))) setFollowing(true); }}>
        {following ? 'Following' : 'Follow'}
      </button>
    </div>
  );
}

function Rail() {
  const { me, can, industryName } = useSession();
  const u = me!.user;
  const suggestions = useApi('/users/suggestions?limit=5');
  const jobs = useApi(can('apply_jobs') ? '/jobs/recommended?limit=3' : null);
  const tags = useApi('/posts/trending-tags');
  return (
    <aside className="rail">
      <div className="rail-me">
        <Link to={`/u/${u.username}`}><Avatar user={u} size={52} /></Link>
        <div className="grow" style={{ lineHeight: 1.3 }}>
          <Link to={`/u/${u.username}`} className="bold small" style={{ color: 'var(--text)' }}>{u.username}</Link>
          <div className="small muted truncate">{u.display_name}{me?.business ? ` · ${industryName(me.business.category)}` : ''}</div>
        </div>
        <Link to="/settings" className="text-btn">Settings</Link>
      </div>

      {suggestions.data?.users?.length > 0 && (
        <div>
          <div className="rail-head"><b>Suggested for you</b><Link to="/businesses" className="text-btn" style={{ color: 'var(--text)' }}>See all</Link></div>
          <div style={{ marginTop: 6 }}>{suggestions.data.users.map((s: Json) => <SuggestionRow key={s.id} u={s} />)}</div>
        </div>
      )}

      {jobs.data?.items?.length > 0 && (
        <div>
          <div className="rail-head"><b>Jobs for you</b><Link to="/jobs" className="text-btn" style={{ color: 'var(--text)' }}>See all</Link></div>
          <div style={{ marginTop: 6 }}>
            {jobs.data.items.map((j: Json) => (
              <Link key={j.id} to={`/jobs/${j.id}?src=feed`} className="rail-row">
                <Avatar user={j.company} size={40} square />
                <div className="grow" style={{ lineHeight: 1.25 }}>
                  <div className="bold small truncate">{j.title}</div>
                  <div className="xsmall muted truncate">{j.company?.display_name} · {salary(j)}</div>
                </div>
                {j.match && <span className="chip chip-success">{j.match.score}%</span>}
              </Link>
            ))}
          </div>
        </div>
      )}

      {tags.data?.tags?.length > 0 && (
        <div>
          <div className="rail-head"><b>Trending</b></div>
          <div className="row-wrap" style={{ marginTop: 8 }}>
            {tags.data.tags.slice(0, 8).map((t: Json) => <Link key={t.tag} to={`/search?q=${encodeURIComponent('#' + t.tag)}&type=posts`} className="chip"><Icon name="hash" />{t.tag}</Link>)}
          </div>
        </div>
      )}

      <div className="rail-foot">
        About · Help · Jobs · Shop · Businesses · Privacy · Terms · Locations
        <div style={{ marginTop: 10, letterSpacing: '0.08em' }}>© 2026 OMNIBIZ</div>
      </div>
    </aside>
  );
}

export function Home() {
  const { me } = useSession();
  const { openCreate } = useOutletContext<ShellContext>();
  const feed = usePaged('/posts/feed');
  const { setItems } = feed;
  const u = me!.user;

  // New posts from the Create dialog appear at the top immediately.
  useEffect(() => {
    const onPosted = (e: Event) => setItems((items) => [(e as CustomEvent).detail, ...items]);
    window.addEventListener(POSTED_EVENT, onPosted);
    return () => window.removeEventListener(POSTED_EVENT, onPosted);
  }, [setItems]);

  return (
    <main className="page">
      <div className="home-grid">
        <section className="feed">
          <StoriesBar onCreate={openCreate} />
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
            <div key={i} className="card ig-post">
              <div className="row" style={{ marginBottom: 12 }}><span className="skeleton" style={{ width: 40, height: 40, borderRadius: '50%' }} /><span className="skeleton" style={{ width: 160, height: 12 }} /></div>
              <div className="skeleton" style={{ aspectRatio: '4 / 5', borderRadius: 20 }} />
            </div>
          ))}
          {!feed.loading && !feed.items.length && (
            <div className="card"><Empty icon="layers" title="Your feed is empty">Follow businesses and people to fill your feed.</Empty></div>
          )}
          <LoadMore hasMore={feed.hasMore} loading={feed.loading && feed.items.length > 0} onClick={feed.loadMore} />
        </section>
        <Rail />
      </div>
    </main>
  );
}
