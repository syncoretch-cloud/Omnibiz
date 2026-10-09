import { useState } from 'react';
import { Link } from 'react-router';
import { Icon } from './Icon.tsx';
import { Avatar, Stars, Verified } from './ui.tsx';
import { Artwork, productIcon } from './Artwork.tsx';
import { del, post } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { useAction, useSession } from '../lib/session.tsx';
import { ACCOUNT_LABEL, STAGE_LABEL, label, money, salary, timeAgo } from '../lib/format.ts';

export function SaveButton({ type, id, saved: initial, className = 'save-btn' }: { type: string; id: number; saved: boolean; className?: string }) {
  const { can } = useSession();
  const act = useAction();
  const [saved, setSaved] = useState(initial);
  if (!can('save')) return null;
  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const next = !saved;
    setSaved(next);
    const ok = await act(() => (next ? post('/saves', { target_type: type, target_id: id }) : del('/saves', { target_type: type, target_id: id })));
    if (!ok) setSaved(!next);
  };
  return (
    <button className={`${className}${saved ? ' on' : ''}`} onClick={toggle} aria-label={saved ? 'Unsave' : 'Save'} aria-pressed={saved}>
      <Icon name={type === 'product' ? 'heart' : 'bookmark'} fill={saved} />
    </button>
  );
}

export function ProductCard({ p, compare }: { p: Json; compare?: { selected: boolean; toggle: () => void } }) {
  const { productCategoryName } = useSession();
  return (
    <Link to={`/marketplace/${p.id}`} className="card card-link product-card">
      <div className="thumb">
        {p.media?.[0] ? <img src={p.media[0]} alt="" loading="lazy" /> : <Artwork variant="thumb" seed={`product-${p.id}-${p.category}`} icon={productIcon(p.category)} />}
        {p.sale_type === 'wholesale' && <span className="chip chip-accent">Wholesale</span>}
        {p.sale_type === 'service' && <span className="chip chip-info">Service</span>}
        <SaveButton type="product" id={p.id} saved={p.saved} />
      </div>
      <div className="body">
        <div className="bold small clamp-2">{p.name}</div>
        <div className="price">{money(p.price, p.currency)}</div>
        {p.sale_type === 'wholesale' && <div className="xsmall muted">Min. order {p.min_order_qty} · {p.quantity != null ? `${p.quantity} available` : 'stock on request'}</div>}
        <div className="xsmall muted truncate">{productCategoryName(p.category)}</div>
        <div className="row xsmall muted" style={{ gap: 4, marginTop: 'auto' }}>
          <span className="truncate">{p.seller?.display_name}</span>
          <Verified show={p.seller?.verified} />
          {p.city && <span className="truncate">· {p.city}</span>}
        </div>
        {p.rating && <div className="xsmall"><Stars value={p.rating.avg} /> <span className="muted">({p.rating.count})</span></div>}
        {p.distance_km != null && <div className="xsmall muted">{p.distance_km} km away</div>}
        {p.availability === 'out_of_stock' && <span className="chip chip-danger" style={{ alignSelf: 'flex-start' }}>Out of stock</span>}
        {p.availability === 'low_stock' && <span className="chip chip-accent" style={{ alignSelf: 'flex-start' }}>Low stock</span>}
        {compare && (
          <label className="checkbox xsmall" onClick={(e) => e.stopPropagation()} style={{ marginTop: 4 }}>
            <input type="checkbox" checked={compare.selected} onChange={compare.toggle} onClick={(e) => e.stopPropagation()} /> Compare
          </label>
        )}
      </div>
    </Link>
  );
}

export function JobCard({ j, match }: { j: Json; match?: Json }) {
  const { industryName } = useSession();
  return (
    <Link to={`/jobs/${j.id}`} className="card card-link job-card">
      <Avatar user={j.company} size={52} square />
      <div className="grow stack-sm" style={{ gap: 4 }}>
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <div className="grow">
            <div className="bold">{j.title}</div>
            <div className="small row" style={{ gap: 4 }}>{j.company?.display_name} <Verified show={j.company?.verified} /></div>
          </div>
          <SaveButton type="job" id={j.id} saved={j.saved} className="icon-btn" />
        </div>
        <div className="job-meta">
          <span><Icon name="mapPin" />{j.remote ? 'Remote' : j.city ?? j.location_text ?? '—'}{j.distance_km != null ? ` · ${j.distance_km} km` : ''}</span>
          <span><Icon name="clock" />{label(j.employment_type)}</span>
          <span><Icon name="cash" />{salary(j)}</span>
        </div>
        <div className="row-wrap" style={{ marginTop: 4 }}>
          {match && <span className={`chip ${match.score >= 75 ? 'chip-success' : 'chip-brand'}`}><Icon name="target" />{match.score}% match</span>}
          {j.application_stage && <span className="chip chip-info"><Icon name="check" />{STAGE_LABEL[j.application_stage]}</span>}
          {j.industry && <span className="chip">{industryName(j.industry)}</span>}
          {j.deadline && <span className="chip">Apply by {new Date(j.deadline).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>}
          <span className="xsmall muted">{timeAgo(j.created_at)}</span>
        </div>
        {match?.missing?.length > 0 && <div className="xsmall muted">Missing: {match.missing.join(', ')}</div>}
      </div>
    </Link>
  );
}

export function BusinessCard({ b, onFollow }: { b: Json; onFollow?: () => void }) {
  const { industryName, can, me } = useSession();
  const act = useAction();
  const [following, setFollowing] = useState(!!b.following);
  const follow = async (e: React.MouseEvent) => {
    e.preventDefault();
    const next = !following;
    if (await act(() => (next ? post(`/users/${b.id}/follow`) : del(`/users/${b.id}/follow`)))) {
      setFollowing(next);
      if (next) onFollow?.();
    }
  };
  return (
    <Link to={`/u/${b.username}?src=directory`} className="card card-link card-pad stack-sm">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Avatar user={b} size={52} square />
        <div className="grow">
          <div className="bold row" style={{ gap: 4 }}><span className="truncate">{b.display_name ?? b.name}</span><Verified show={b.verified} /></div>
          <div className="xsmall muted">{ACCOUNT_LABEL[b.kind ?? b.account_type]} · {industryName(b.category)}</div>
          <div className="xsmall muted row" style={{ gap: 4 }}><Icon name="mapPin" size={13} />{b.city ?? '—'}{b.distance_km != null ? ` · ${b.distance_km} km` : ''}</div>
        </div>
      </div>
      {b.description && <div className="small muted clamp-2">{b.description}</div>}
      {b.services?.length > 0 && <div className="row-wrap">{b.services.slice(0, 3).map((s: string) => <span key={s} className="chip">{s}</span>)}</div>}
      <div className="row-between">
        <span className="xsmall muted">{b.followers != null ? `${b.followers} follower${b.followers === 1 ? '' : 's'}` : ''}{b.rating ? ` · ★ ${b.rating.avg}` : ''}</span>
        {can('follow') && me?.user.id !== b.id && (
          <button className={`btn btn-sm ${following ? 'btn-outline' : 'btn-brand-outline'}`} onClick={follow} aria-pressed={following}>
            {following ? <><Icon name="check" />Following</> : <><Icon name="plus" />Follow</>}
          </button>
        )}
      </div>
    </Link>
  );
}

export function PersonRow({ u, right }: { u: Json; right?: React.ReactNode }) {
  return (
    <Link to={`/u/${u.username}`} className="list-item">
      <Avatar user={u} size={40} />
      <div className="grow">
        <div className="bold small row" style={{ gap: 4 }}><span className="truncate">{u.display_name}</span><Verified show={u.verified} /></div>
        <div className="xsmall muted truncate">{u.headline ?? ACCOUNT_LABEL[u.account_type]}{u.city ? ` · ${u.city}` : ''}</div>
      </div>
      {right}
    </Link>
  );
}
