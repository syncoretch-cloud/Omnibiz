import { useState } from 'react';
import { Link } from 'react-router';
import { Icon } from './Icon.tsx';
import { Avatar, Verified } from './ui.tsx';
import { isBusinessType, useAction, useSession } from '../lib/session.tsx';
import { useApi } from '../lib/hooks.ts';
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

/** The context panel: you, jobs matched to you, businesses to follow and what's trending. */
export function Board() {
  const { me, can, industryName } = useSession();
  const u = me!.user;
  const suggestions = useApi('/users/suggestions?limit=4');
  const jobs = useApi(can('apply_jobs') ? '/jobs/recommended?limit=3' : null);
  const tags = useApi('/posts/trending-tags');
  return (
    <div className="board">
      <div className="widget me-widget">
        <Link to={`/u/${u.username}`} className="row" style={{ color: 'inherit' }}>
          <Avatar user={u} size={48} />
          <div className="grow" style={{ lineHeight: 1.3, minWidth: 0 }}>
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
        <div className="widget">
          <div className="widget-head"><span className="eyebrow">Jobs for you</span><Link to="/jobs" className="text-btn">See all</Link></div>
          {jobs.data.items.map((j: Json) => (
            <Link key={j.id} to={`/jobs/${j.id}?src=feed`} className="widget-row">
              <Avatar user={j.company} size={38} square />
              <div className="grow" style={{ lineHeight: 1.25, minWidth: 0 }}>
                <div className="bold small truncate">{j.title}</div>
                <div className="xsmall muted truncate">{j.company?.display_name} · {salary(j)}</div>
              </div>
              {j.match && <span className="match-pill">{j.match.score}%</span>}
            </Link>
          ))}
        </div>
      )}

      {suggestions.data?.users?.length > 0 && (
        <div className="widget">
          <div className="widget-head"><span className="eyebrow">Businesses to follow</span><Link to="/businesses" className="text-btn">See all</Link></div>
          {suggestions.data.users.map((s: Json) => <SuggestionRow key={s.id} u={s} />)}
        </div>
      )}

      {tags.data?.tags?.length > 0 && (
        <div className="widget">
          <div className="widget-head"><span className="eyebrow">Trending</span></div>
          <div className="row-wrap">
            {tags.data.tags.slice(0, 8).map((t: Json) => <Link key={t.tag} to={`/search?q=${encodeURIComponent('#' + t.tag)}&type=posts`} className="chip"><Icon name="hash" />{t.tag}</Link>)}
          </div>
        </div>
      )}

      <div className="board-foot">About · Help · Jobs · Market · Businesses · Privacy · Terms<div>© 2026 OMNIBIZ</div></div>
    </div>
  );
}
