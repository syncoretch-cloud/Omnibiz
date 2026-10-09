import { Link } from 'react-router';
import { Avatar, Empty, PageTitle, Spinner } from '../components/ui.tsx';
import { useApi } from '../lib/hooks.ts';
import type { Json } from '../lib/api.ts';
import { label, money, timeAgo } from '../lib/format.ts';

export const ORDER_CHIP: Record<string, string> = {
  pending: 'chip-accent', confirmed: 'chip-info', shipped: 'chip-brand', delivered: 'chip-success', cancelled: 'chip-danger',
};

export function OrderList({ role }: { role: 'buyer' | 'seller' }) {
  const { data, loading } = useApi(`/orders?role=${role}`);
  if (loading) return <Spinner block />;
  if (!data?.orders.length) return <div className="card"><Empty icon="package" title="No orders yet">{role === 'buyer' ? <Link to="/marketplace">Start shopping</Link> : 'Orders from customers will appear here.'}</Empty></div>;
  return (
    <div className="card">
      {data.orders.map((o: Json) => {
        const other = role === 'buyer' ? o.seller : o.buyer;
        return (
          <Link key={o.id} to={`/orders/${o.id}`} className="list-item">
            <Avatar user={other} size={40} />
            <div className="grow">
              <div className="bold small">Order #{o.id} · {other?.display_name}</div>
              <div className="xsmall muted truncate">{o.items.map((i: Json) => `${i.qty}× ${i.name}`).join(', ')}</div>
              <div className="xsmall muted">{timeAgo(o.created_at)} · {label(o.payment_method)} · {label(o.payment_status)}</div>
            </div>
            <div className="stack-sm" style={{ alignItems: 'flex-end', gap: 4 }}>
              <span className="bold small">{money(o.subtotal, o.currency)}</span>
              <span className={`chip ${ORDER_CHIP[o.status]}`}>{label(o.status)}</span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export default function Orders() {
  return (
    <main className="page page-mid">
      <PageTitle title="My orders" subtitle="Track purchases from checkout to delivery." />
      <OrderList role="buyer" />
    </main>
  );
}
