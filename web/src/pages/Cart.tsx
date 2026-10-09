import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Icon } from '../components/Icon.tsx';
import { Avatar, Empty, ErrorBox, Field, Input, Modal, PageTitle, Placeholder, Spinner, Textarea, Verified } from '../components/ui.tsx';
import { del, patch, post } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { useApi } from '../lib/hooks.ts';
import { useSession, useToast } from '../lib/session.tsx';
import { label, money } from '../lib/format.ts';

const PAY_INFO: Record<string, string> = {
  cash_on_delivery: 'Pay the seller in cash when your order arrives.',
  mobile_money: 'Pay with M-Pesa, Tigo Pesa or Airtel Money. The seller confirms receipt before dispatch.',
  bank_transfer: 'Transfer to the seller’s bank account. Use your order reference as the payment description.',
};

function Checkout({ group, onClose, onDone }: { group: Json; onClose: () => void; onDone: (ids: number[]) => void }) {
  const { me, meta } = useSession();
  const [method, setMethod] = useState('mobile_money');
  const [address, setAddress] = useState([me?.user.city, me?.user.region].filter(Boolean).join(', '));
  const [phone, setPhone] = useState(me?.user.phone ?? '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await post('/orders/checkout', { payment_method: method, delivery_address: address, delivery_phone: phone, note, seller_id: group.seller.id });
      onDone(r.order_ids);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Checkout · ${group.seller.display_name}`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={submit} disabled={busy || address.length < 5 || !phone}>Place order · {money(group.subtotal, group.currency)}</button></>}>
      <div className="stack">
        <ErrorBox error={error} />
        <Field label="Delivery address"><Textarea value={address} onChange={(e) => setAddress(e.target.value)} style={{ minHeight: 70 }} placeholder="Street, area, city" /></Field>
        <Field label="Phone for delivery"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <div className="field">
          <span className="label">Payment method</span>
          {(meta?.payment_methods ?? []).map((m) => (
            <label key={m} className={`choice${method === m ? ' selected' : ''}`} style={{ alignItems: 'flex-start' }}>
              <input type="radio" name="pay" checked={method === m} onChange={() => setMethod(m)} style={{ marginTop: 4 }} />
              <div><div>{label(m)}</div><div className="xsmall muted" style={{ fontWeight: 400 }}>{PAY_INFO[m]}</div></div>
            </label>
          ))}
        </div>
        <Field label="Note to seller (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></Field>
      </div>
    </Modal>
  );
}

export default function Cart() {
  const { refresh } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const { data, loading, setData } = useApi('/cart');
  const [checkout, setCheckout] = useState<Json | null>(null);
  if (loading && !data) return <Spinner block />;

  const update = async (pid: number, qty: number) => {
    try {
      setData(qty ? await patch(`/cart/${pid}`, { qty }) : await del(`/cart/${pid}`));
      refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <main className="page page-mid">
      <PageTitle title="Cart" subtitle="Orders are placed separately with each seller." actions={<Link to="/orders" className="btn btn-outline"><Icon name="package" />My orders</Link>} />
      {!data?.groups.length ? (
        <div className="card"><Empty icon="cart" title="Your cart is empty"><Link to="/marketplace">Browse the marketplace</Link></Empty></div>
      ) : (
        <div className="stack">
          {data.groups.map((g: Json) => (
            <div key={g.seller.id} className="card">
              <div className="card-header">
                <Link to={`/u/${g.seller.username}`} className="row" style={{ color: 'inherit' }}><Avatar user={g.seller} size={32} square /><b>{g.seller.display_name}</b><Verified show={g.seller.verified} /></Link>
                <span className="price">{money(g.subtotal, g.currency)}</span>
              </div>
              {g.items.map((it: Json) => (
                <div key={it.product.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                  <Link to={`/marketplace/${it.product.id}`} style={{ width: 72, borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
                    {it.product.media[0] ? <img src={it.product.media[0]} alt="" style={{ aspectRatio: '1', objectFit: 'cover' }} /> : <Placeholder seed={it.product.category + it.product.name} />}
                  </Link>
                  <div className="grow stack-sm" style={{ gap: 4 }}>
                    <Link to={`/marketplace/${it.product.id}`} className="bold small" style={{ color: 'inherit' }}>{it.product.name}</Link>
                    <div className="small muted">{money(it.product.price, it.product.currency)} each{it.product.min_order_qty > 1 ? ` · min. ${it.product.min_order_qty}` : ''}</div>
                    {it.problems.map((p: string) => <span key={p} className="chip chip-danger" style={{ alignSelf: 'flex-start' }}>{p}</span>)}
                    <div className="row">
                      <div className="qty">
                        <button onClick={() => update(it.product.id, it.qty - 1)} disabled={it.qty <= it.product.min_order_qty} aria-label="Decrease">−</button>
                        <input value={it.qty} readOnly aria-label="Quantity" />
                        <button onClick={() => update(it.product.id, it.qty + 1)} aria-label="Increase">+</button>
                      </div>
                      <button className="btn btn-ghost btn-sm" onClick={() => update(it.product.id, 0)}><Icon name="trash" />Remove</button>
                    </div>
                  </div>
                  <div className="bold">{money(it.line_total, it.product.currency)}</div>
                </div>
              ))}
              <div className="card-footer row-between">
                <span className="small muted">{g.problems.length ? 'Fix the issues above to check out' : 'Delivery arranged with the seller'}</span>
                <button className="btn btn-primary" disabled={g.problems.length > 0} onClick={() => setCheckout(g)}>Checkout</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {checkout && (
        <Checkout
          group={checkout}
          onClose={() => setCheckout(null)}
          onDone={(ids) => {
            setCheckout(null);
            refresh();
            toast('Order placed! The seller has been notified.', 'success');
            nav(`/orders/${ids[0]}`);
          }}
        />
      )}
    </main>
  );
}
