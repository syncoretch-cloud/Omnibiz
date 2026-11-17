import { Link, useParams } from 'react-router';
import { Icon } from '../components/Icon.tsx';
import { ProductCard } from '../components/Cards.tsx';
import { Avatar, Empty, PageTitle, Spinner, Stars, Verified } from '../components/ui.tsx';
import { post } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { useApi } from '../lib/hooks.ts';
import { useAction, useSession } from '../lib/session.tsx';
import { ACCOUNT_LABEL, timeAgo } from '../lib/format.ts';
import { useNavigate } from 'react-router';

/** A seller's storefront: who they are, how buyers rate them, and everything they sell. */
export default function Shop() {
  const { username } = useParams();
  const { me, can } = useSession();
  const nav = useNavigate();
  const act = useAction();
  const { data, loading, error } = useApi(`/shops/${username}`);
  if (loading && !data) return <Spinner block />;
  if (error || !data) return <main className="page page-narrow"><div className="card"><Empty icon="store" title="Store not found" /></div></main>;
  const s = data.seller;
  const total = data.reviews.length ? Object.values(data.rating_spread as Record<string, number>).reduce((a, b) => a + b, 0) : 0;
  const message = async () => {
    const r = await act(() => post('/messages/start', { user_id: s.id }));
    if (r) nav(`/messages/${r.conversation_id}`);
  };
  return (
    <main className="page page-wide">
      <PageTitle title={s.display_name} back="/marketplace" />
      <div className="layout-side">
        <aside className="stack">
          <div className="card card-pad stack-sm">
            <div className="row">
              <Avatar user={s} size={64} square />
              <div>
                <div className="bold row" style={{ gap: 4 }}>{s.display_name}<Verified show={s.verified} /></div>
                <div className="xsmall muted">{ACCOUNT_LABEL[s.account_type] ?? s.account_type}{s.city ? ` · ${s.city}` : ''}</div>
              </div>
            </div>
            {data.business?.description && <p className="small">{data.business.description}</p>}
            <div className="row-wrap small">
              {s.rating ? <span><Stars value={s.rating.avg} /> <b>{s.rating.avg}</b> <span className="muted">({s.rating.count} review{s.rating.count === 1 ? '' : 's'})</span></span> : <span className="muted">No seller reviews yet</span>}
            </div>
            <div className="small muted">{data.completed_orders} completed order{data.completed_orders === 1 ? '' : 's'}</div>
            <div className="row-wrap">
              <Link to={`/u/${s.username}`} className="btn btn-outline btn-sm">Profile</Link>
              {me && can('message') && me.user.id !== s.id && <button className="btn btn-outline btn-sm" onClick={message}><Icon name="message" />Message</button>}
            </div>
          </div>
          {total > 0 && (
            <div className="card card-pad stack-sm">
              <div className="section-title">Ratings</div>
              {[5, 4, 3, 2, 1].map((n) => {
                const c = data.rating_spread[n] ?? 0;
                return <div key={n} className="meter-row small"><span>{n} ★</span><div className="meter-bar" style={{ flex: 1, margin: '0 8px' }}><i style={{ width: `${(c / total) * 100}%` }} /></div><span className="muted">{c}</span></div>;
              })}
            </div>
          )}
        </aside>
        <section className="stack">
          <h3>Products &amp; services ({data.products.length})</h3>
          {data.products.length ? <div className="grid-cards">{data.products.map((p: Json) => <ProductCard key={p.id} p={p} />)}</div> : <div className="card"><Empty icon="store" title="Nothing for sale right now" /></div>}
          <h3>What buyers say</h3>
          {data.reviews.length ? (
            <div className="card">
              {data.reviews.map((r: Json) => (
                <div key={r.id} className="list-item">
                  <div className="grow">
                    <div className="small"><b>{r.reviewer?.display_name}</b> · <Stars value={r.rating} /> <span className="xsmall muted">{timeAgo(r.created_at)}</span></div>
                    {r.body && <div className="small">{r.body}</div>}
                  </div>
                </div>
              ))}
            </div>
          ) : <div className="card"><Empty icon="star" title="No reviews yet">Buyers can rate the seller after an order is delivered.</Empty></div>}
        </section>
      </div>
    </main>
  );
}
