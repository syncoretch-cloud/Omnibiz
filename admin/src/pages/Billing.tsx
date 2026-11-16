import { useState } from 'react';
import { Empty, Field, Input, Modal, Spinner, Tabs, Textarea, Avatar } from '@web/components/ui.tsx';
import { patch } from '@web/lib/api.ts';
import type { Json } from '@web/lib/api.ts';
import { useApi } from '@web/lib/hooks.ts';
import { useAction } from '@web/lib/session.tsx';
import { ACCOUNT_LABEL, money, timeAgo } from '@web/lib/format.ts';

function PlanEditor({ plan, onClose, onSaved }: { plan: Json; onClose: () => void; onSaved: () => void }) {
  const act = useAction();
  const [f, setF] = useState({
    name: plan.name as string,
    tagline: (plan.tagline ?? '') as string,
    price: String(plan.price),
    features: (plan.features as string[]).join('\n'),
    products: plan.limits.products === undefined ? '' : plan.limits.products === null ? 'unlimited' : String(plan.limits.products),
    jobs: plan.limits.jobs === undefined ? '' : plan.limits.jobs === null ? 'unlimited' : String(plan.limits.jobs),
    active: !!plan.active,
    highlight: !!plan.highlight,
  });
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const limit = (v: string) => (v.trim() === '' ? undefined : /^unl/i.test(v) ? null : Number(v));
  const save = async () => {
    const limits: Json = {};
    for (const k of ['products', 'jobs'] as const) {
      const v = limit(f[k]);
      if (v !== undefined) limits[k] = v;
    }
    const body = { name: f.name, tagline: f.tagline, price: Number(f.price) || 0, features: f.features.split('\n').map((x) => x.trim()).filter(Boolean), limits, active: f.active, highlight: f.highlight };
    if (await act(() => patch(`/admin/billing/plans/${plan.id}`, body), 'Plan saved')) { onSaved(); onClose(); }
  };
  return (
    <Modal title={`${ACCOUNT_LABEL[plan.audience]} · ${plan.name}`} onClose={onClose}>
      <div className="stack">
        <Field label="Name"><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Tagline"><Input value={f.tagline} onChange={(e) => set('tagline', e.target.value)} /></Field>
        <Field label={`Price per month (${plan.currency})`} hint="0 makes it the free plan for this account type."><Input inputMode="decimal" value={f.price} onChange={(e) => set('price', e.target.value)} /></Field>
        <div className="form-grid">
          <Field label="Product limit" hint="A number, “unlimited”, or empty for not applicable."><Input value={f.products} onChange={(e) => set('products', e.target.value)} /></Field>
          <Field label="Open jobs limit"><Input value={f.jobs} onChange={(e) => set('jobs', e.target.value)} /></Field>
        </div>
        <Field label="Features" hint="One per line."><Textarea value={f.features} onChange={(e) => set('features', e.target.value)} style={{ minHeight: 110 }} /></Field>
        <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} /> Available to subscribe</label>
        <label className="check"><input type="checkbox" checked={f.highlight} onChange={(e) => set('highlight', e.target.checked)} /> Show as “Most popular”</label>
        <div className="form-actions"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Save plan</button></div>
      </div>
    </Modal>
  );
}

function Plans() {
  const { data, loading, reload } = useApi('/admin/billing/plans');
  const [editing, setEditing] = useState<Json | null>(null);
  if (loading || !data) return <Spinner block />;
  const groups = ['personal', 'customer', 'company', 'wholesaler', 'retailer'];
  return (
    <div className="stack">
      {groups.map((g) => (
        <div key={g} className="card">
          <div className="card-pad"><h3>{ACCOUNT_LABEL[g]}</h3></div>
          {data.items.filter((p: Json) => p.audience === g).map((p: Json) => (
            <div key={p.id} className="list-item">
              <div className="grow">
                <div className="bold">{p.name} {!p.active && <span className="chip">Off</span>}</div>
                <div className="xsmall muted">{p.price > 0 ? `${money(p.price, p.currency)} / month` : 'Free'} · {p.subscribers} subscriber{p.subscribers === 1 ? '' : 's'}</div>
              </div>
              <button className="btn btn-outline btn-sm" onClick={() => setEditing(p)}>Edit</button>
            </div>
          ))}
        </div>
      ))}
      {editing && <PlanEditor plan={editing} onClose={() => setEditing(null)} onSaved={reload} />}
    </div>
  );
}

function Subscribers() {
  const { data, loading } = useApi('/admin/billing/subscribers');
  if (loading || !data) return <Spinner block />;
  return (
    <div className="stack">
      <div className="card card-pad"><div className="label small muted">Active subscriptions value</div><div className="value" style={{ fontSize: '1.6rem', fontWeight: 700 }}>{money(data.monthly_total)} <small className="muted">/ month</small></div></div>
      <div className="card">
        {data.items.map((s: Json) => (
          <div key={s.id} className="list-item">
            <Avatar user={s.user} size={32} />
            <div className="grow"><div className="bold">{s.user?.display_name}</div><div className="xsmall muted">{s.plan_name} · since {timeAgo(s.started_at)}</div></div>
            <div className="small">{money(s.price)}</div>
          </div>
        ))}
        {!data.items.length && <Empty title="No paid subscribers yet" />}
      </div>
    </div>
  );
}

export function Billing() {
  const [tab, setTab] = useState<'plans' | 'subscribers'>('plans');
  return (
    <div className="stack">
      <Tabs tabs={[{ id: 'plans', label: 'Plans' }, { id: 'subscribers', label: 'Subscribers' }]} value={tab} onChange={setTab} />
      {tab === 'plans' ? <Plans /> : <Subscribers />}
    </div>
  );
}
