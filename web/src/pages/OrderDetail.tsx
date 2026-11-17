import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Icon } from '../components/Icon.tsx';
import { Avatar, Empty, PageTitle, Select, Spinner, Stars, Textarea } from '../components/ui.tsx';
import { post } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { useApi } from '../lib/hooks.ts';
import { useAction } from '../lib/session.tsx';
import { label, money, parseTime } from '../lib/format.ts';
import { ORDER_CHIP } from './Orders.tsx';

const FLOW = ['pending', 'confirmed', 'shipped', 'delivered'];

function ReviewForm({ orderId, item, onDone }: { orderId: number; item: Json; onDone: () => void }) {
  const act = useAction();
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  return (
    <div className="stack-sm" style={{ padding: '8px 0' }}>
      <div className="row">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className="icon-btn" onClick={() => setRating(n)} aria-label={`${n} stars`} style={{ color: n <= rating ? 'var(--accent)' : 'var(--border-strong)' }}>
            <Icon name="star" fill />
          </button>
        ))}
      </div>
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="How was the product and the seller?" style={{ minHeight: 60 }} />
      <button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={async () => { if (await act(() => post(`/orders/${orderId}/reviews`, { product_id: item.product_id, rating, body }), 'Thanks for your review')) onDone(); }}>Submit review</button>
    </div>
  );
}

const DISPUTE_REASONS = [
  { v: 'not_received', l: 'I did not receive it' }, { v: 'not_as_described', l: 'Not as described' },
  { v: 'damaged', l: 'Arrived damaged' }, { v: 'wrong_item', l: 'Wrong item' }, { v: 'other', l: 'Something else' },
];

function SellerReview({ orderId, existing, onDone }: { orderId: number; existing: Json | null; onDone: () => void }) {
  const act = useAction();
  const [rating, setRating] = useState(existing?.rating ?? 5);
  const [body, setBody] = useState(existing?.body ?? '');
  const [editing, setEditing] = useState(!existing);
  if (!editing) {
    return (
      <div className="card card-pad stack-sm">
        <div className="section-title">Your seller review</div>
        <div className="small"><Stars value={existing.rating} /> {existing.body}</div>
        <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setEditing(true)}>Edit</button>
      </div>
    );
  }
  return (
    <div className="card card-pad stack-sm">
      <div className="section-title">Rate the seller</div>
      <div className="row">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className="icon-btn" onClick={() => setRating(n)} aria-label={`${n} stars`} style={{ color: n <= rating ? 'var(--accent)' : 'var(--border-strong)' }}><Icon name="star" fill /></button>
        ))}
      </div>
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="How was communication, packaging and delivery?" style={{ minHeight: 60 }} />
      <button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={async () => { if (await act(() => post(`/orders/${orderId}/seller-review`, { rating, body }), 'Thanks for rating the seller')) { setEditing(false); onDone(); } }}>Submit</button>
    </div>
  );
}

function DisputeCard({ order, dispute, seller, onDone }: { order: Json; dispute: Json | null; seller: boolean; onDone: () => void }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('not_received');
  const [details, setDetails] = useState('');
  const [reply, setReply] = useState('');
  const eligible = !seller && !dispute && ['confirmed', 'shipped', 'delivered'].includes(order.status) && order.payout_status !== 'refunded';
  if (!dispute && !eligible) return null;
  if (!dispute) {
    return (
      <div className="card card-pad stack-sm">
        <div className="section-title">Problem with this order?</div>
        {!open ? <button className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}><Icon name="alert" />Open a dispute</button> : (
          <>
            <Select value={reason} onChange={(e) => setReason(e.target.value)} options={DISPUTE_REASONS.map((r) => ({ value: r.v, label: r.l }))} aria-label="Reason" />
            <Textarea value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Tell us what went wrong (at least 10 characters)" style={{ minHeight: 80 }} />
            <p className="xsmall muted">The seller&apos;s payout is held while our team looks at it.</p>
            <div className="row-wrap">
              <button className="btn btn-primary btn-sm" disabled={details.trim().length < 10} onClick={async () => { if (await act(() => post(`/orders/${order.id}/dispute`, { reason, details }), 'Dispute opened')) onDone(); }}>Send</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </>
        )}
      </div>
    );
  }
  const status = dispute.status === 'open' ? 'Under review' : dispute.status === 'refunded' ? 'Refunded' : 'Closed, no refund';
  return (
    <div className="card card-pad stack-sm">
      <div className="row-between"><div className="section-title">Dispute</div><span className={`chip ${dispute.status === 'open' ? 'chip-accent' : dispute.status === 'refunded' ? 'chip-success' : ''}`}>{status}</span></div>
      <div className="small"><b>{label(dispute.reason)}:</b> {dispute.details}</div>
      {dispute.seller_reply && <div className="small"><b>Seller replied:</b> {dispute.seller_reply}</div>}
      {dispute.resolution && <div className="small"><b>Decision:</b> {dispute.resolution}</div>}
      {seller && dispute.status === 'open' && !dispute.seller_reply && (
        <>
          <Textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Your side of the story" style={{ minHeight: 70 }} />
          <button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }} disabled={reply.trim().length < 2} onClick={async () => { if (await act(() => post(`/orders/${order.id}/dispute/reply`, { reply }), 'Reply sent')) onDone(); }}>Send reply</button>
        </>
      )}
    </div>
  );
}

export default function OrderDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const act = useAction();
  const { data, loading, error, reload } = useApi(`/orders/${id}`);
  const [reviewing, setReviewing] = useState<number | null>(null);
  if (loading && !data) return <Spinner block />;
  if (error) return <main className="page page-narrow"><div className="card"><Empty icon="alert" title="Order not found" /></div></main>;
  const o = data.order;
  const seller = data.role === 'seller';
  const other = seller ? o.buyer : o.seller;
  const step = FLOW.indexOf(o.status);

  const setStatus = async (status: string) => {
    if (status === 'cancelled' && !confirm('Cancel this order?')) return;
    if (await act(() => post(`/orders/${o.id}/status`, { status }), `Order ${status}`)) reload();
  };
  const message = async () => {
    const r = await act(() => post('/messages/start', { user_id: other.id, context: { type: 'order', id: o.id, title: `Order #${o.id}` } }));
    if (r) nav(`/messages/${r.conversation_id}`);
  };

  const actions: [string, string, string][] = seller
    ? ({ pending: [['confirmed', 'Confirm order', 'btn-primary'], ['cancelled', 'Decline', 'btn-ghost']], confirmed: [['shipped', 'Mark as shipped', 'btn-primary'], ['cancelled', 'Cancel', 'btn-ghost']], shipped: [['delivered', 'Mark as delivered', 'btn-primary']] } as Record<string, [string, string, string][]>)[o.status] ?? []
    : ({ pending: [['cancelled', 'Cancel order', 'btn-ghost']], shipped: [['delivered', 'I received my order', 'btn-primary']] } as Record<string, [string, string, string][]>)[o.status] ?? [];

  return (
    <main className="page page-mid">
      <PageTitle title={`Order #${o.id}`} subtitle={`Placed ${parseTime(o.created_at).toLocaleString()}`} back={seller ? '/dashboard/orders' : '/orders'} actions={<span className={`chip ${ORDER_CHIP[o.status]}`}>{label(o.status)}</span>} />
      <div className="layout-2">
        <div className="stack">
          {o.status !== 'cancelled' && (
            <div className="card card-pad stack-sm">
              <div className="steps">{FLOW.map((s, i) => <div key={s} className={`step ${i <= step ? 'done' : ''}`} />)}</div>
              <div className="row-between xsmall muted">{FLOW.map((s) => <span key={s}>{label(s)}</span>)}</div>
            </div>
          )}
          <div className="card">
            <div className="card-header"><h3>Items</h3><span className="price">{money(o.subtotal, o.currency)}</span></div>
            {o.items.map((it: Json) => (
              <div key={it.id}>
                <div className="list-item">
                  <div className="grow">
                    {it.product_id ? <Link to={`/marketplace/${it.product_id}`} className="bold small">{it.name}</Link> : <span className="bold small">{it.name}</span>}
                    <div className="xsmall muted">{it.qty} × {money(it.unit_price, o.currency)}</div>
                  </div>
                  <b className="small">{money(it.qty * it.unit_price, o.currency)}</b>
                  {!seller && o.status === 'delivered' && it.product_id && (data.reviewed.includes(it.product_id)
                    ? <span className="chip chip-success">Reviewed</span>
                    : <button className="btn btn-outline btn-sm" onClick={() => setReviewing(it.product_id)}>Review</button>)}
                </div>
                {reviewing === it.product_id && <div style={{ padding: '0 16px' }}><ReviewForm orderId={o.id} item={it} onDone={() => { setReviewing(null); reload(); }} /></div>}
              </div>
            ))}
          </div>
          {actions.length > 0 && (
            <div className="card card-pad row-wrap">
              {actions.map(([s, text, cls]) => <button key={s} className={`btn ${cls}`} onClick={() => setStatus(s)}>{text}</button>)}
              {seller && o.payment_status !== 'paid' && o.payment_method !== 'cash_on_delivery' && o.status !== 'cancelled' && (
                <button className="btn btn-outline" onClick={async () => { if (await act(() => post(`/orders/${o.id}/payment-received`), 'Payment recorded')) reload(); }}>Payment received</button>
              )}
            </div>
          )}
          {!seller && o.status === 'delivered' && <SellerReview orderId={o.id} existing={data.seller_review} onDone={reload} />}
          <DisputeCard order={o} dispute={data.dispute} seller={seller} onDone={reload} />
          <div className="card">
            <div className="card-header"><h3>Tracking</h3></div>
            <div className="card-body">
              <ul className="timeline">
                {data.events.map((e: Json, i: number) => (
                  <li key={i}><div className="small bold">{label(e.status)}{e.note ? ` — ${e.note}` : ''}</div><div className="xsmall muted">{parseTime(e.created_at).toLocaleString()}</div></li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <aside className="stack">
          <div className="card card-pad stack-sm">
            <div className="section-title">{seller ? 'Buyer' : 'Seller'}</div>
            <Link to={`/u/${other?.username}`} className="row" style={{ color: 'inherit' }}><Avatar user={other} size={40} /><b>{other?.display_name}</b></Link>
            <button className="btn btn-outline btn-sm" onClick={message}><Icon name="message" />Message</button>
          </div>
          <div className="card card-pad stack-sm small">
            <div className="section-title">Delivery</div>
            <div className="pre">{o.delivery_address}</div>
            <div className="muted">{o.delivery_phone}</div>
            {o.note && <div><b>Note:</b> {o.note}</div>}
          </div>
          <div className="card card-pad stack-sm small">
            <div className="section-title">Payment</div>
            <div>{label(o.payment_method)} · <b>{label(o.payment_status)}</b></div>
            {seller && o.status !== 'cancelled' && (
              <div className="small">Payout: <b>{label(o.payout_status)}</b>{o.payout_status === 'held' && o.status === 'delivered' && !data.dispute ? ' — releases automatically a few days after delivery, or as soon as the buyer confirms' : o.payout_status === 'held' ? ' — paid out once the buyer has received the order' : ''}</div>
            )}
            {data.transactions.map((t: Json) => <div key={t.reference} className="xsmall muted">Ref <span className="kbd">{t.reference}</span> · {label(t.status)}</div>)}
          </div>
        </aside>
      </div>
    </main>
  );
}
