import { useState } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router';
import { Icon } from '../../components/Icon.tsx';
import { Empty, PageTitle, Select, Spinner, Verified, SectionSwap } from '../../components/ui.tsx';
import { BarList, Kpi, LineChart } from '../../components/Charts.tsx';
import { post } from '../../lib/api.ts';
import type { Json } from '../../lib/api.ts';
import { useApi } from '../../lib/hooks.ts';
import { useAction, useSession } from '../../lib/session.tsx';
import { label, money } from '../../lib/format.ts';
import { OrderList } from '../Orders.tsx';
import { ProductsManager } from './Products.tsx';
import { JobsManager } from './JobsManager.tsx';
import { RecruitmentOverview, Pipeline, Candidate } from './Recruitment.tsx';
import { Announcements } from './Announcements.tsx';

function Assistant() {
  const act = useAction();
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<Json | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = async (question: string) => {
    setQ(question);
    setBusy(true);
    const r = await act(() => post('/analytics/ask', { question }));
    setBusy(false);
    if (r) setAnswer(r);
  };
  const examples = ['Show me my best-performing products this month', 'How many followers did I gain this week?', 'Where do my job applications come from?', 'What did people search to find me?'];
  return (
    <div className="card">
      <div className="card-header"><h3 className="row"><Icon name="sparkles" size={18} />Business assistant</h3></div>
      <div className="card-body stack-sm">
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (q.trim()) ask(q); }}>
          <input className="input search-input" placeholder="Ask about your performance…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn btn-primary" disabled={busy || !q.trim()}>Ask</button>
        </form>
        <div className="row-wrap">{examples.map((e) => <button key={e} className="chip" onClick={() => ask(e)}>{e}</button>)}</div>
        {busy && <Spinner />}
        {answer && !busy && (
          <div className="stack-sm">
            <p>{answer.answer}</p>
            {answer.table?.length > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr>{Object.keys(answer.table[0]).map((k) => <th key={k} className={typeof answer.table[0][k] === 'number' ? 'num' : ''}>{label(k)}</th>)}</tr></thead>
                  <tbody>{answer.table.map((row: Json, i: number) => <tr key={i}>{Object.entries(row).map(([k, v]) => <td key={k} className={typeof v === 'number' ? 'num' : ''}>{String(v)}</td>)}</tr>)}</tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Overview() {
  const { me } = useSession();
  const [days, setDays] = useState('30');
  const { data, loading } = useApi(`/analytics/overview?days=${days}`);
  const company = me?.user.account_type === 'company';
  if (loading && !data) return <Spinner block />;
  if (!data) return null;
  const t = data.totals;
  return (
    <div className="stack">
      <div className="row-between">
        <h2>Performance</h2>
        <Select value={days} onChange={(e) => setDays(e.target.value)} options={[{ value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }]} style={{ width: 'auto' }} aria-label="Date range" />
      </div>
      <div className="grid-4">
        <Kpi label="Profile views" value={t.profile_view.value} previous={t.profile_view.previous} />
        <Kpi label="Product views" value={t.product_view.value} previous={t.product_view.previous} />
        <Kpi label="Post reach" value={t.post_impression.value} previous={t.post_impression.previous} />
        <Kpi label="Search appearances" value={t.search_appearance.value} previous={t.search_appearance.previous} />
        <Kpi label="Customer inquiries" value={t.inquiry.value} previous={t.inquiry.previous} />
        <Kpi label="New followers" value={data.followers.new ?? 0} />
        <Kpi label="Engagement" value={data.engagement.likes + data.engagement.comments + data.engagement.reposts} />
        {company ? <Kpi label="Job applications" value={t.application.value} previous={t.application.previous} /> : <Kpi label={`Sales (${data.sales.orders} orders)`} value={data.sales.revenue} format={(n) => money(n, data.sales.currency ?? 'TZS')} />}
      </div>
      <div className="card card-pad">
        <h3 style={{ marginBottom: 8 }}>Visibility over time</h3>
        <LineChart
          title="Daily profile views and product views"
          days={data.series.days}
          series={[
            { name: 'Profile views', values: data.series.profile_view },
            { name: 'Product views', values: data.series.product_view },
          ]}
        />
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-header"><h3>Insights</h3></div>
          <div className="card-body">{data.insights.map((s: string) => <div key={s} className="insight small"><Icon name="zap" />{s}</div>)}</div>
        </div>
        <Assistant />
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-header"><h3>Top products by views</h3><Link to="/dashboard/products" className="small">Manage</Link></div>
          <div className="card-body">
            <BarList valueLabel="views" rows={data.topProducts.map((p: Json) => ({ key: p.id, value: p.views, label: <Link to={`/marketplace/${p.id}`}>{p.name}</Link> }))} />
            {data.topProducts.length > 0 && (
              <div className="table-wrap mt">
                <table className="table">
                  <thead><tr><th>Product</th><th className="num">Saves</th><th className="num">Inquiries</th><th className="num">Sold</th></tr></thead>
                  <tbody>{data.topProducts.slice(0, 5).map((p: Json) => <tr key={p.id}><td className="truncate" style={{ maxWidth: 180 }}>{p.name}</td><td className="num">{p.saves}</td><td className="num">{p.inquiries}</td><td className="num">{p.units_sold}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3>How people find you</h3></div>
          <div className="card-body stack">
            <div>
              <div className="section-title" style={{ marginBottom: 6 }}>Top search terms</div>
              <BarList valueLabel="appearances" rows={data.searchTerms.map((s: Json) => ({ key: s.term, value: s.n, label: `“${s.term}”` }))} />
            </div>
            <div>
              <div className="section-title" style={{ marginBottom: 6 }}>View sources</div>
              <BarList valueLabel="views" rows={data.viewSources.map((s: Json) => ({ key: s.source, value: s.n, label: label(s.source) }))} />
            </div>
            {company && data.applicationSources.length > 0 && (
              <div>
                <div className="section-title" style={{ marginBottom: 6 }}>Application sources</div>
                <BarList valueLabel="applications" rows={data.applicationSources.map((s: Json) => ({ key: s.source, value: s.n, label: label(s.source) }))} />
              </div>
            )}
          </div>
        </div>
      </div>
      {data.topPosts.length > 0 && (
        <div className="card">
          <div className="card-header"><h3>Top posts by reach</h3></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Post</th><th className="num">Reach</th><th className="num">Likes</th><th className="num">Comments</th></tr></thead>
              <tbody>{data.topPosts.map((p: Json) => <tr key={p.id}><td><Link to={`/posts/${p.id}`} className="clamp-2">{p.body || '(media post)'}</Link></td><td className="num">{p.reach}</td><td className="num">{p.like_count}</td><td className="num">{p.comment_count}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { me } = useSession();
  const b = me!.business!;
  const company = me!.user.account_type === 'company';
  return (
    <main className="page">
      <PageTitle
        title={<span className="row" style={{ gap: 6 }}>{b.name}<Verified show={!!b.verified} /></span>}
        subtitle={`${label(me!.user.account_type)} dashboard`}
        actions={<Link to={`/u/${me!.user.username}`} className="btn btn-outline btn-sm"><Icon name="eye" />View public profile</Link>}
      />
      {!b.verified && b.verification_status !== 'pending' && (
        <div className="banner banner-info small" style={{ marginBottom: 16 }}>
          <Icon name="shieldCheck" /><span className="grow">Get the Verified Business badge to build trust and rank higher in search.</span>
          <Link to="/settings/business" className="btn btn-sm btn-primary">Get verified</Link>
        </div>
      )}
      <div className="layout-side">
        <aside className="card sticky-side">
          <nav className="side-nav">
            <NavLink to="/dashboard" end><Icon name="chart" />Analytics</NavLink>
            <NavLink to="/dashboard/products"><Icon name="tag" />Products & services</NavLink>
            {company && <NavLink to="/dashboard/jobs"><Icon name="briefcase" />Vacancies</NavLink>}
            {company && <NavLink to="/dashboard/recruitment"><Icon name="users" />Recruitment</NavLink>}
            <NavLink to="/dashboard/announcements"><Icon name="megaphone" />Announcements</NavLink>
            <NavLink to="/dashboard/orders"><Icon name="package" />Orders</NavLink>
            <NavLink to="/settings/business"><Icon name="settings" />Business profile</NavLink>
          </nav>
        </aside>
        <section>
          <SectionSwap><Routes>
            <Route index element={<Overview />} />
            <Route path="products" element={<ProductsManager />} />
            <Route path="jobs" element={company ? <JobsManager /> : <Empty title="Vacancies are for company accounts" />} />
            <Route path="recruitment" element={<RecruitmentOverview />} />
            <Route path="recruitment/jobs/:id" element={<Pipeline />} />
            <Route path="recruitment/applications/:id" element={<Candidate />} />
            <Route path="announcements" element={<Announcements />} />
            <Route path="orders" element={<div className="stack"><h2>Customer orders</h2><OrderList role="seller" /></div>} />
          </Routes></SectionSwap>
        </section>
      </div>
    </main>
  );
}
