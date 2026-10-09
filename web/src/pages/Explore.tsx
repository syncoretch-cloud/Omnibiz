import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Icon } from '../components/Icon.tsx';
import { Artwork, jobArt, postArt, productArt } from '../components/Artwork.tsx';
import { Empty, LoadMore } from '../components/ui.tsx';
import { rememberSearch } from '../components/Layout.tsx';
import { usePaged } from '../lib/hooks.ts';
import type { Json } from '../lib/api.ts';
import { isBusinessType, useSession } from '../lib/session.tsx';
import { compact, money, salary } from '../lib/format.ts';

export function Tile({ item, tall }: { item: Json; tall?: boolean }) {
  const type = item.type as 'post' | 'product' | 'job';
  const p = item.post ?? item.product ?? item.job;
  const media = type !== 'job' ? p.media?.[0] : undefined;
  const art = type === 'post' ? postArt(p) : type === 'product' ? productArt(p, false) : jobArt(p);
  return (
    <Link to={`/reels?start=${encodeURIComponent(item.key)}`} className={`tile${tall ? ' tall' : ''}`}>
      {media && !/\.(mp4|webm)$/i.test(media) ? <img src={media} alt="" loading="lazy" /> : <Artwork variant="tile" {...art} price={type === 'post' ? art.price : undefined} sub={undefined} />}
      <span className="tile-type"><Icon name={type === 'product' ? 'bag' : type === 'job' ? 'briefcase' : p.media?.length > 1 ? 'layers' : 'reels'} /></span>
      <span className="tile-over">
        {type === 'post' && <><span><Icon name="heart" fill />{compact(p.like_count)}</span><span><Icon name="comment" fill />{compact(p.comment_count)}</span></>}
        {type === 'product' && <span><Icon name="tag" />{money(p.price, p.currency)}</span>}
        {type === 'job' && <span><Icon name="cash" />{salary(p)}</span>}
      </span>
    </Link>
  );
}

export default function Explore() {
  const { me, can } = useSession();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const list = usePaged('/reels');
  const biz = isBusinessType(me?.user.account_type);
  const shortcuts: [string, string, string][] = [
    ...(me?.user.account_type !== 'customer' ? [['/jobs', 'briefcase', 'Jobs'] as [string, string, string]] : []),
    ['/marketplace', 'bag', 'Shop'],
    ['/marketplace?sale_type=wholesale', 'truck', 'Wholesale'],
    ['/marketplace?sale_type=service', 'zap', 'Services'],
    ['/businesses', 'building', 'Businesses'],
    ['/businesses?view=map', 'mapPin', 'Near me'],
    ['/saved', 'bookmark', 'Saved'],
    ...(biz ? [['/dashboard', 'dashboard', 'Dashboard'] as [string, string, string]] : []),
    ...(can('manage_cv') ? [['/me/cv', 'file', 'My CV'] as [string, string, string]] : []),
  ];
  return (
    <main className="page page-mid">
      <form className="input-icon" onSubmit={(e) => { e.preventDefault(); if (q.trim()) { rememberSearch(q.trim()); nav(`/search?q=${encodeURIComponent(q.trim())}`); } }} style={{ marginBottom: 14 }}>
        <Icon name="search" />
        <input className="input search-input" placeholder="Search people, jobs, shops, products…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
      </form>
      <div className="filter-bar" style={{ marginBottom: 14 }}>
        {shortcuts.map(([to, icon, text]) => <Link key={to} to={to} className="chip" style={{ height: 34, padding: '0 14px' }}><Icon name={icon} />{text}</Link>)}
      </div>
      <div className="explore-grid">
        {list.items.map((it, i) => <Tile key={it.key} item={it} tall={i % 10 === 2 || i % 10 === 5} />)}
        {list.loading && !list.items.length && Array.from({ length: 9 }, (_, i) => <div key={i} className="tile skeleton" />)}
      </div>
      {!list.loading && !list.items.length && <div className="card"><Empty icon="compass" title="Nothing to explore yet" /></div>}
      <div className="mt"><LoadMore hasMore={list.hasMore} loading={list.loading && list.items.length > 0} onClick={list.loadMore} /></div>
    </main>
  );
}
