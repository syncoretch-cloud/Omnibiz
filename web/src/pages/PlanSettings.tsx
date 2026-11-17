import { useState } from 'react';
import { Icon } from '../components/Icon.tsx';
import { Spinner } from '../components/ui.tsx';
import { post } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { useApi } from '../lib/hooks.ts';
import { useAction, useSession } from '../lib/session.tsx';
import { money, parseTime } from '../lib/format.ts';

const LIMIT_LABEL: Record<string, string> = { products: 'products', jobs: 'open jobs' };
const PLACEMENT = ['Standard', 'Priority', 'Top priority'];
const BILLING_WORD: Record<string, string> = { monthly: 'monthly', quarterly: '3-month', yearly: 'yearly' };

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

const Yes = () => <Icon name="check" />;
const No = () => <span className="muted">—</span>;

/** Settings → Plan: what you're on, and every plan side by side with what it includes and what paying longer saves. */
export function PlanSettings() {
  const { me } = useSession();
  const act = useAction();
  const { data, loading, reload } = useApi('/subscriptions');
  const [period, setPeriod] = useState('monthly');
  if (loading || !data) return <Spinner block />;
  const current: Json = data.plan;
  const plans: Json[] = data.plans;
  const paid = plans.some((p) => p.price > 0);
  const periods: Json[] = plans.find((p) => p.payment_plans.length)?.payment_plans ?? [];
  const choose = async (p: Json) => {
    if (await act(() => post('/subscriptions/subscribe', { plan_id: p.id, period }), `You are on the ${p.name} plan`)) reload();
  };
  const cancel = async () => {
    if (await act(() => post('/subscriptions/cancel'), 'Back on the free plan')) reload();
  };
  const pay = (p: Json, code = period) => p.payment_plans.find((x: Json) => x.period === code);
  const isCurrent = (p: Json) => p.id === current.id && (!pay(p) || (data.subscription?.period ?? 'monthly') === period);
  const limitCell = (p: Json, k: string) => (p.limits[k] === undefined ? <No /> : p.limits[k] === null ? 'Unlimited' : p.limits[k]);
  const limitRows = (['products', 'jobs'] as const).filter((k) => plans.some((p) => p.limits[k] !== undefined));
  const saving = (pp: Json) => Math.round((pp.saving / (pp.total + pp.saving)) * 100);

  return (
    <div className="stack">
      <div className="card card-pad stack">
        <div>
          <h3>Your plan</h3>
          <p className="small muted">
            You are on <b>{current.name}</b>
            {data.subscription ? <> ({BILLING_WORD[data.subscription.period] ?? 'monthly'} billing, {money(data.subscription.price, current.currency)})</> : null}
            {data.subscription?.renews_at ? <> · renews {parseTime(data.subscription.renews_at).toLocaleDateString()}</> : null}.
          </p>
        </div>
        {(['products', 'jobs'] as const).map((k) => <Meter key={k} name={k} used={data.usage[k]} max={current.limits[k]} />)}
        {data.subscription && <div className="form-actions"><button className="btn btn-ghost" onClick={cancel}>Cancel subscription</button></div>}
      </div>

      {paid ? (
        <>
          <div className="card card-pad stack-sm">
            <h3>Choose a plan</h3>
            <p className="small muted">Accounts on a higher plan, and verified accounts, are shown first in the marketplace, jobs, business directory and search. Free accounts are still listed, after them.</p>
            <div className="row-wrap">
              {periods.map((pp) => (
                <button key={pp.period} className={`chip${period === pp.period ? ' active' : ''}`} onClick={() => setPeriod(pp.period)}>
                  {pp.label}{pp.saving > 0 && <> · save {saving(pp)}%</>}
                </button>
              ))}
            </div>
          </div>

          <div className="plan-grid">
            {plans.map((p) => {
              const pp = pay(p);
              return (
                <div key={p.id} className={`card card-pad plan${p.highlight ? ' plan-hot' : ''}${isCurrent(p) ? ' plan-current' : ''}`}>
                  {p.highlight && <span className="chip chip-brand">Most popular</span>}
                  <h3>{p.name}</h3>
                  <div className="plan-price">{pp ? <>{money(pp.per_month, p.currency)}<small> / month</small></> : 'Free'}</div>
                  {pp && pp.months > 1 && <p className="xsmall muted">{money(pp.total, p.currency)} every {pp.months} months · you save {money(pp.saving, p.currency)}</p>}
                  <p className="small muted">{p.tagline}</p>
                  {isCurrent(p)
                    ? <button className="btn btn-block" disabled>Your current plan</button>
                    : <button className={`btn btn-block ${p.price > current.price ? 'btn-primary' : ''}`} onClick={() => choose(p)}>{p.price > current.price ? 'Upgrade' : 'Switch'} to {p.name}</button>}
                  <ul className="plan-features">{p.features.map((f: string) => <li key={f}><Icon name="check" />{f}</li>)}</ul>
                </div>
              );
            })}
          </div>

          <div className="card">
            <div className="card-pad"><h3>Compare plans</h3></div>
            <div className="table-wrap">
              <table className="table plan-compare">
                <thead>
                  <tr><th />{plans.map((p) => <th key={p.id} className={p.id === current.id ? 'is-current' : undefined}>{p.name}{p.id === current.id ? ' (yours)' : ''}</th>)}</tr>
                </thead>
                <tbody>
                  <tr><td>Price per month</td>{plans.map((p) => <td key={p.id}>{pay(p) ? money(pay(p).per_month, p.currency) : 'Free'}</td>)}</tr>
                  {limitRows.map((k) => <tr key={k}><td>Active {LIMIT_LABEL[k]}</td>{plans.map((p) => <td key={p.id}>{limitCell(p, k)}</td>)}</tr>)}
                  <tr><td>Placement in marketplace, jobs &amp; search</td>{plans.map((p) => <td key={p.id}>{PLACEMENT[p.boost] ?? PLACEMENT[0]}</td>)}</tr>
                  <tr><td>“Featured” badge on products</td>{plans.map((p) => <td key={p.id}>{p.boost >= 2 ? <Yes /> : <No />}</td>)}</tr>
                  <tr><td>Discount on the verified-badge fee</td>{plans.map((p) => <td key={p.id}>{p.perks.verification_discount > 0 ? `${p.perks.verification_discount}% off` : <No />}</td>)}</tr>
                  <tr><td>Analytics</td>{plans.map((p) => <td key={p.id}>{p.perks.analytics ? <Yes /> : <No />}</td>)}</tr>
                  <tr><td>Support</td>{plans.map((p) => <td key={p.id}>{p.perks.support === 'priority' ? 'Priority' : 'Standard'}</td>)}</tr>
                  {periods.filter((pp) => pp.months > 1).map((pp) => (
                    <tr key={pp.period}>
                      <td>Pay {pp.label.toLowerCase()} upfront<div className="xsmall muted">save {saving(pp)}%</div></td>
                      {plans.map((p) => <td key={p.id}>{pay(p, pp.period) ? money(pay(p, pp.period).total, p.currency) : <No />}</td>)}
                    </tr>
                  ))}
                  <tr><td /> {plans.map((p) => (
                    <td key={p.id}>
                      {isCurrent(p) ? <span className="chip chip-success">Current</span> : <button className="btn btn-sm btn-outline" onClick={() => choose(p)}>Choose</button>}
                    </td>
                  ))}</tr>
                </tbody>
              </table>
            </div>
          </div>
          {data.billing === 'test' && <p className="small muted">Payments are not connected yet, so choosing a paid plan switches it on without charging you.</p>}
        </>
      ) : (
        <div className="card card-pad"><p className="small muted">{me?.user.account_type === 'personal' ? 'Personal accounts are free for now. Paid options will appear here when they launch.' : 'Plans for your account type will appear here soon.'}</p></div>
      )}
    </div>
  );
}
