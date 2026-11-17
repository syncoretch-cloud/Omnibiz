// Staff queues for account appeals and marketplace disputes.
import { useState } from 'react';
import { Empty, Input, Spinner, Tabs } from '@web/components/ui.tsx';
import { post } from '@web/lib/api.ts';
import type { Json } from '@web/lib/api.ts';
import { useApi } from '@web/lib/hooks.ts';
import { useAction } from '@web/lib/session.tsx';
import { label, money, timeAgo } from '@web/lib/format.ts';

export function Appeals() {
  const act = useAction();
  const [status, setStatus] = useState('pending');
  const { data, loading, reload } = useApi(`/admin/appeals?status=${status}`);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const decide = async (a: Json, decision: 'approve' | 'reject') => {
    if (await act(() => post(`/admin/appeals/${a.id}`, { decision, response: notes[a.id] ?? '' }), decision === 'approve' ? 'Appeal approved, account restored' : 'Appeal rejected')) reload();
  };
  return (
    <div className="stack">
      <Tabs tabs={[{ id: 'pending', label: 'Waiting' }, { id: 'approved', label: 'Approved' }, { id: 'rejected', label: 'Rejected' }]} value={status} onChange={setStatus} />
      {loading && !data ? <Spinner block /> : !data?.items.length ? <div className="card"><Empty icon="checkCircle" title="No appeals here" /></div> : data.items.map((a: Json) => (
        <div key={a.id} className="card card-pad stack-sm">
          <div className="row-between">
            <div className="row-wrap">
              <b>{a.user?.display_name}</b><span className="muted small">@{a.user?.username}</span>
              <span className={`chip ${a.account?.status === 'suspended' ? 'chip-danger' : ''}`}>{label(a.account?.status ?? 'unknown')}</span>
            </div>
            <span className="xsmall muted">{timeAgo(a.created_at)}</span>
          </div>
          <div className="small"><b>Suspended for:</b> {a.account?.suspended_reason ?? '—'}{a.account?.suspended_until ? ` (until ${a.account.suspended_until.slice(0, 10)})` : ''}</div>
          <div className="card card-pad small" style={{ background: 'var(--surface-2)' }}>{a.message}</div>
          {a.status === 'pending' ? (
            <>
              <Input placeholder="Reply to the person (they receive this by email)" value={notes[a.id] ?? ''} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} />
              <div className="row-wrap">
                <button className="btn btn-primary btn-sm" disabled={(notes[a.id] ?? '').trim().length < 2} onClick={() => decide(a, 'approve')}>Approve &amp; restore</button>
                <button className="btn btn-outline btn-sm" disabled={(notes[a.id] ?? '').trim().length < 2} onClick={() => decide(a, 'reject')}>Reject</button>
              </div>
            </>
          ) : <div className="xsmall muted">Reply: {a.response}</div>}
        </div>
      ))}
    </div>
  );
}

const REASON: Record<string, string> = { not_received: 'Not received', not_as_described: 'Not as described', damaged: 'Damaged', wrong_item: 'Wrong item', other: 'Other' };

export function Disputes() {
  const act = useAction();
  const [status, setStatus] = useState('open');
  const { data, loading, reload } = useApi(`/admin/disputes?status=${status}`);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const resolve = async (d: Json, decision: 'refund' | 'reject') => {
    if (await act(() => post(`/admin/disputes/${d.id}/resolve`, { decision, note: notes[d.id] ?? '' }), decision === 'refund' ? 'Buyer refunded' : 'Dispute rejected')) reload();
  };
  return (
    <div className="stack">
      <Tabs tabs={[{ id: 'open', label: 'Open' }, { id: 'refunded', label: 'Refunded' }, { id: 'rejected', label: 'Rejected' }]} value={status} onChange={setStatus} />
      {loading && !data ? <Spinner block /> : !data?.items.length ? <div className="card"><Empty icon="checkCircle" title="No disputes here" /></div> : data.items.map((d: Json) => (
        <div key={d.id} className="card card-pad stack-sm">
          <div className="row-between">
            <div className="row-wrap">
              <span className="chip chip-danger">{REASON[d.reason] ?? label(d.reason)}</span>
              <b>Order #{d.order_id}</b><span className="price">{money(d.subtotal, d.currency)}</span>
              <span className="chip">Payment: {label(d.payment_status)}</span><span className="chip">Payout: {label(d.payout_status)}</span>
            </div>
            <span className="xsmall muted">{timeAgo(d.created_at)}</span>
          </div>
          <div className="small muted">{d.items.map((i: Json) => `${i.qty} × ${i.name}`).join(', ')}</div>
          <div className="small"><b>Buyer</b> {d.buyer?.display_name} (@{d.buyer?.username}) · <b>Seller</b> {d.seller?.display_name} (@{d.seller?.username})</div>
          <div className="card card-pad small" style={{ background: 'var(--surface-2)' }}><b>Buyer says:</b> {d.details}</div>
          {d.seller_reply && <div className="card card-pad small" style={{ background: 'var(--surface-2)' }}><b>Seller replied:</b> {d.seller_reply}</div>}
          {d.status === 'open' ? (
            <>
              <Input placeholder="Decision note (both sides receive this)" value={notes[d.id] ?? ''} onChange={(e) => setNotes({ ...notes, [d.id]: e.target.value })} />
              <div className="row-wrap">
                <button className="btn btn-danger btn-sm" disabled={(notes[d.id] ?? '').trim().length < 2} onClick={() => resolve(d, 'refund')}>Refund buyer</button>
                <button className="btn btn-outline btn-sm" disabled={(notes[d.id] ?? '').trim().length < 2} onClick={() => resolve(d, 'reject')}>Reject &amp; pay seller</button>
              </div>
            </>
          ) : <div className="xsmall muted">Decision: {d.resolution}</div>}
        </div>
      ))}
    </div>
  );
}
