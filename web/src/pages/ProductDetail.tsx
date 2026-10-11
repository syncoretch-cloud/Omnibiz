import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon.tsx';
import { Avatar, Empty, Spinner, Stars, Verified } from '../components/ui.tsx';
import { Artwork, productArt } from '../components/Artwork.tsx';
import { ProductCard, SaveButton } from '../components/Cards.tsx';
import { MapView } from '../components/MapView.tsx';
import { ReportDialog } from '../components/Report.tsx';
import { post } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { useApi } from '../lib/hooks.ts';
import { useAction, useSession } from '../lib/session.tsx';
import { label, money, timeAgo } from '../lib/format.ts';

export default function ProductDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { me, can, refresh, productCategoryName } = useSession();
  const act = useAction();
  const { data, loading, error } = useApi(`/products/${id}${params.get('src') ? `?src=${params.get('src')}` : ''}`);
  const [img, setImg] = useState(0);
  const [qty, setQty] = useState<number | null>(null);
  const [reporting, setReporting] = useState(false);

  if (loading && !data) return <Spinner block />;
  if (error) return <main className="page page-narrow"><div className="card"><Empty icon="alert" title="Product not available">{error.message}</Empty></div></main>;
  const p = data.product;
  const owner = me?.user.id === p.seller?.id;
  const q = qty ?? p.min_order_qty;

  const addToCart = async () => {
    if (await act(() => post('/cart', { product_id: p.id, qty: q }), 'Added to cart')) refresh();
  };
  const contact = async () => {
    const r = await act(() => post('/messages/start', { user_id: p.seller.id, context: { type: 'product', id: p.id, title: p.name } }));
    if (r) nav(`/messages/${r.conversation_id}`);
  };
  const specs = Object.entries(p.specs as Record<string, string>);

  return (
    <main className="page">
      <div className="layout-2">
        <div className="stack">
          <div className="card card-pad">
            <div className="product-hero">
              <div>
                <div className="gallery-main">
                  {p.media.length ? (/\.(mp4|webm)$/i.test(p.media[img]) ? <video src={p.media[img]} controls style={{ width: '100%', height: '100%' }} /> : <img src={p.media[img]} alt={p.name} />) : <Artwork variant="tile" {...productArt(p)} />}
                </div>
                {p.media.length > 1 && (
                  <div className="gallery-thumbs">
                    {p.media.map((m: string, i: number) => <button key={m} className={i === img ? 'on' : ''} onClick={() => setImg(i)}><img src={m} alt="" /></button>)}
                  </div>
                )}
              </div>
              <div className="stack-sm">
                <div className="row-wrap">
                  <span className="chip">{productCategoryName(p.category)}</span>
                  {p.sale_type !== 'retail' && <span className={`chip ${p.sale_type === 'wholesale' ? 'chip-accent' : 'chip-info'}`}>{label(p.sale_type)}</span>}
                  <span className={`chip ${p.availability === 'out_of_stock' ? 'chip-danger' : p.availability === 'low_stock' ? 'chip-accent' : 'chip-success'}`}>{label(p.availability)}</span>
                </div>
                <h1>{p.name}</h1>
                {p.rating && <div className="small"><Stars value={p.rating.avg} /> {p.rating.avg} · {p.rating.count} review{p.rating.count === 1 ? '' : 's'}</div>}
                <div className="price-lg">{money(p.price, p.currency)}{p.sale_type === 'wholesale' && <span className="small muted" style={{ fontWeight: 500 }}> / unit</span>}</div>
                {p.sale_type === 'wholesale' && (
                  <div className="card card-pad small stack-sm" style={{ background: 'var(--accent-soft)', border: 0 }}>
                    <div><b>Minimum order:</b> {p.min_order_qty} units</div>
                    {p.quantity != null && <div><b>Available:</b> {p.quantity.toLocaleString()} units</div>}
                    {p.packaging && <div><b>Packaging:</b> {p.packaging}</div>}
                    <div><b>Minimum order value:</b> {money(p.price * p.min_order_qty, p.currency)}</div>
                  </div>
                )}
                {p.sale_type === 'retail' && p.quantity != null && <div className="small muted">{p.quantity} in stock</div>}
                <div className="small muted row" style={{ gap: 4 }}><Icon name="mapPin" size={14} />{p.city ?? 'Location on request'} · listed {timeAgo(p.created_at)}</div>

                {!owner && (
                  <div className="stack-sm" style={{ marginTop: 8 }}>
                    {can('purchase') && p.sale_type !== 'service' && p.availability !== 'out_of_stock' && (
                      <div className="row-wrap">
                        <div className="qty">
                          <button onClick={() => setQty(Math.max(p.min_order_qty, q - 1))} aria-label="Decrease">−</button>
                          <input value={q} onChange={(e) => setQty(Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1))} aria-label="Quantity" />
                          <button onClick={() => setQty(q + 1)} aria-label="Increase">+</button>
                        </div>
                        <button className="btn btn-primary" onClick={addToCart} disabled={q < p.min_order_qty}><Icon name="cart" />Add to cart · {money(p.price * q, p.currency)}</button>
                      </div>
                    )}
                    <div className="row-wrap">
                      {can('message') && <button className={`btn ${p.sale_type === 'service' ? 'btn-primary' : 'btn-outline'}`} onClick={contact}><Icon name="message" />Contact seller</button>}
                      <SaveButton type="product" id={p.id} saved={p.saved} className="btn btn-outline btn-icon" />
                      <button className="btn btn-ghost btn-icon" onClick={() => setReporting(true)} aria-label="Report"><Icon name="flag" /></button>
                    </div>
                  </div>
                )}
                {owner && <Link to={`/dashboard/products?edit=${p.id}`} className="btn btn-outline"><Icon name="edit" />Edit listing</Link>}
              </div>
            </div>
          </div>

          {p.description && <div className="card card-pad-lg"><h3 style={{ marginBottom: 8 }}>Description</h3><p className="pre">{p.description}</p></div>}
          {specs.length > 0 && (
            <div className="card">
              <div className="card-header"><h3>Specifications</h3></div>
              <table className="spec-table"><tbody>{specs.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>
            </div>
          )}
          {(p.delivery_info || p.delivery_options.length > 0 || p.contact_method) && (
            <div className="card card-pad-lg stack-sm">
              <h3>Delivery & contact</h3>
              {p.delivery_options.length > 0 && <div className="row-wrap">{p.delivery_options.map((o: string) => <span key={o} className="chip"><Icon name={o === 'delivery' ? 'truck' : 'store'} />{label(o)}</span>)}</div>}
              {p.delivery_info && <p className="small pre">{p.delivery_info}</p>}
              {p.contact_method && <p className="small muted">Preferred contact: {p.contact_method}</p>}
            </div>
          )}
          <div className="card">
            <div className="card-header"><h3>Reviews</h3></div>
            {data.reviews.length ? data.reviews.map((r: Json) => (
              <div key={r.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                <Avatar user={r} size={36} />
                <div className="grow">
                  <div className="small"><b>{r.display_name}</b> · <Stars value={r.rating} /> <span className="xsmall muted">{timeAgo(r.created_at)}</span></div>
                  {r.body && <div className="small">{r.body}</div>}
                </div>
              </div>
            )) : <Empty icon="star" title="No reviews yet">Reviews come from verified buyers after delivery.</Empty>}
          </div>
          {data.similar.length > 0 && (
            <div className="stack-sm">
              <h3>Similar products</h3>
              <div className="grid-cards">{data.similar.map((s: Json) => <ProductCard key={s.id} p={s} />)}</div>
            </div>
          )}
        </div>
        <aside className="stack">
          <div className="card card-pad stack-sm">
            <div className="section-title">Sold by</div>
            <Link to={`/u/${p.seller?.username}?src=product`} className="row" style={{ color: 'inherit' }}>
              <Avatar user={p.seller} size={48} square />
              <div className="grow">
                <div className="bold row" style={{ gap: 4 }}>{p.seller?.display_name}<Verified show={p.seller?.verified} /></div>
                <div className="xsmall muted">{label(p.seller?.account_type)} · {p.seller?.city}</div>
              </div>
            </Link>
            <Link to={`/u/${p.seller?.username}`} className="btn btn-outline btn-sm">Visit store</Link>
          </div>
          {p.location && <MapView className="map map-sm" center={[p.location.lat, p.location.lng]} zoom={13} pins={[{ id: p.id, lat: p.location.lat, lng: p.location.lng, title: p.seller?.display_name ?? '', color: '#6d324f', letter: '•' }]} />}
          <div className="banner banner-info small"><Icon name="shield" />Pay only after confirming with the seller. Report anything suspicious.</div>
        </aside>
      </div>
      {reporting && <ReportDialog targetType="product" targetId={p.id} onClose={() => setReporting(false)} />}
    </main>
  );
}
