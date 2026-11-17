import { useState } from 'react';
import { Icon } from '../components/Icon.tsx';
import { Spinner } from '../components/ui.tsx';
import { post } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { useApi } from '../lib/hooks.ts';
import { useAction, useSession } from '../lib/session.tsx';
import { money, parseTime } from '../lib/format.ts';

const LIMIT_LABEL: Record<string, string> = { products: 'products', jobs: 'open jobs' };

function Meter({ name, used, max }: { name: string; used: number; max: number | null | undefined }) {
  if (max === undefined) return null;
  const pct = max === null ? 0 : Math.min(100, Math.round((used / max) * 100));
  return (
    <div className="meter">
      <div className="meter-row"><span>{LIMIT_LABEL[name] ?? name}</span><span className="muted">{used} of {max === null ? 'unlimited' : max}</span></div>
      <div className="meter-bar"><i style={{ width: `${pct}%` }} className={pct >= 100 ? 'full' : undefined} /></div>
    </div>
  );
}

/** Settings → Plan: what you're on, what you've used, and the plans you can move to. */
export function PlanSettings() {
  const { me } = useSession();
  const act = useAction();
  const { data, loading, reload } = useApi('/subscriptions');
  const [period, setPeriod] = useState('monthly');
  if (loading || !data) return <Spinner block />;
  const current: Json = data.plan;
  const paid = data.plans.filter((p: Json) => p.price > 0).length > 0;
  const choose = async (p: Json) => {
    if (await act(() => post('/subscriptions/subscribe', { plan_id: p.id, period }), `You are on the ${p.name} plan`)) reload();
  };
  const cancel = async () => {
    if (await act(() => post('/subscriptions/cancel'), 'Back on the free plan')) reload();
  };
  return (
    <div className="stack">
      <div className="card card-pad stack">
        <div>
          <h3>Your plan</h3>
          <p className="small muted">
            You are on <b>{current.name}</b>{data.subscription ? <> ({data.subscription.period === 'yearly' ? 'yearly' : data.subscription.period === 'quarterly' ? '3-month' : 'monthly'} billing, {money(data.subscription.price, current.currency)})</> : null}{data.subscription?.renews_at ? <> · renews {parseTime(data.subscription.renews_at).toLocaleDateString()}</> : null}.
          </p>
        </div>
        {(['products', 'jobs'] as const).map((k) => <Meter key={k} name={k} used={data.usage[k]} max={current.limits[k]} />)}
        {data.subscription && <div className="form-actions"><button className="btn btn-ghost" onClick={cancel}>Cancel subscription</button></div>}
      </div>
      {paid ? (
        <>
          <div className="row-wrap">
            {(data.plans.find((p: Json) => p.payment_plans.length)?.payment_plans ?? []).map((pp: Json) => (
              <button key={pp.period} className={`chip${period === pp.period ? ' active' : ''}`} onClick={() => setPeriod(pp.period)}>
                {pp.label}{pp.saving > 0 && <> · save {Math.round((pp.saving / (pp.total + pp.saving)) * 100)}%</>}
              </button>
            ))}
          </div>
          <div className="plan-grid">
            {data.plans.map((p: Json) => {
              const pay = p.payment_plans.find((x: Json) => x.period === period);
              return (
              <div key={p.id} className={`card card-pad plan${p.highlight ? ' plan-hot' : ''}${p.id === current.id ? ' plan-current' : ''}`}>
                {p.highlight && <span className="chip chip-brand">Most popular</span>}
                <h3>{p.name}</h3>
                <div className="plan-price">{pay ? <>{money(pay.per_month, p.currency)}<small> / month</small></> : 'Free'}</div>
                {pay && pay.months > 1 && <p className="xsmall muted">{money(pay.total, p.currency)} billed every {pay.months} months{pay.saving > 0 ? ` · you save ${money(pay.saving, p.currency)}` : ''}</p>}
                <p className="small muted">{p.tagline}</p>
                <ul className="plan-features">{p.features.map((f: string) => <li key={f}><Icon name="check" />{f}</li>)}</ul>
                {p.id === current.id && (!pay || (data.subscription?.period ?? 'monthly') === period)
                  ? <button className="btn" disabled>Current plan</button>
                  : <button className={`btn ${p.price > current.price ? 'btn-primary' : ''}`} onClick={() => choose(p)}>{p.price > current.price ? 'Upgrade' : 'Switch'} to {p.name}</button>}
              </div>
              );
            })}
          </div>
          {data.billing === 'test' && <p className="small muted">Payments are not connected yet, so choosing a paid plan switches it on without charging you.</p>}
        </>
      ) : (
        <div className="card card-pad"><p className="small muted">{me?.user.account_type === 'personal' ? 'Personal accounts are free for now. Paid options will appear here when they launch.' : 'Plans for your account type will appear here soon.'}</p></div>
      )}
    </div>
  );
}
