import { useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router';
import { Icon } from '../../components/Icon.tsx';
import { Avatar, Empty, Field, Input, Modal, PageTitle, Select, Spinner, Tabs, Textarea, SectionSwap } from '../../components/ui.tsx';
import { Kpi, LineChart } from '../../components/Charts.tsx';
import { patch, post, qs } from '../../lib/api.ts';
import type { Json } from '../../lib/api.ts';
import { useApi, useDebounced } from '../../lib/hooks.ts';
import { useAction, useSession } from '../../lib/session.tsx';
import { ACCOUNT_LABEL, compact, label, parseTime, timeAgo } from '../../lib/format.ts';

function fillDays(rows: { day: string; n: number }[], days = 30) {
  const list: string[] = [];
  for (let i = days - 1; i >= 0; i--) list.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  const m = new Map(rows.map((r) => [r.day, r.n]));
  return { days: list, values: list.map((d) => m.get(d) ?? 0) };
}

function Overview() {
  const { data, loading } = useApi('/admin/stats');
  if (loading || !data) return <Spinner block />;
  const signups = fillDays(data.signups);
  const posts = fillDays(data.activity);
  return (
    <div className="stack">
      <div className="grid-4">
        <Kpi label="Users" value={data.users.total} />
        <Kpi label="New users (30d)" value={data.users.new_30d} />
        <Kpi label="Open jobs" value={data.content.jobs_open} />
        <Kpi label="Active products" value={data.content.products} />
        <Kpi label="Posts" value={data.content.posts} />
        <Kpi label="Applications" value={data.content.applications} />
        <Kpi label="Orders" value={data.content.orders} />
        <Kpi label="Order value" value={data.content.gmv} format={(n) => `TZS ${compact(n)}`} />
      </div>
      <div className="grid-3">
        <Link to="/admin/reports" className="card card-link kpi"><div className="label">Reports to review</div><div className="value" style={{ color: data.queues.open_reports ? 'var(--danger)' : undefined }}>{data.queues.open_reports}</div></Link>
        <Link to="/admin/verification" className="card card-link kpi"><div className="label">Pending verifications</div><div className="value">{data.queues.pending_verifications}</div></Link>
        <div className="card kpi"><div className="label">Suspicious sign-ins (7d)</div><div className="value">{data.queues.suspicious_logins_7d}</div></div>
      </div>
      <div className="card card-pad">
        <h3 style={{ marginBottom: 8 }}>Growth — last 30 days</h3>
        <LineChart title="Daily sign-ups and posts" days={signups.days} series={[{ name: 'Sign-ups', values: signups.values }, { name: 'Posts', values: posts.values }]} />
      </div>
      <div className="card">
        <div className="card-header"><h3>Accounts by type</h3></div>
        <table className="table"><tbody>{Object.entries(data.users.by_type).map(([k, v]) => <tr key={k}><td>{ACCOUNT_LABEL[k]}</td><td className="num bold">{v as number}</td></tr>)}<tr><td>Suspended</td><td className="num">{data.users.suspended}</td></tr><tr><td>Flagged content</td><td className="num">{data.content.flagged}</td></tr></tbody></table>
      </div>
    </div>
  );
}

function UserDetail({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { staffCan, me } = useSession();
  const act = useAction();
  const { data, loading, reload } = useApi(`/admin/users/${id}`);
  const [reason, setReason] = useState('');
  if (loading || !data) return <Modal title="User" onClose={onClose}><Spinner /></Modal>;
  const u = data.user;
  const done = () => { reload(); onChanged(); };
  return (
    <Modal large title={u.display_name} onClose={onClose}>
      <div className="stack">
        <div className="row">
          <Avatar user={u} size={56} />
          <div className="grow small">
            <div><b>@{u.username}</b> · {ACCOUNT_LABEL[u.account_type]} · role <b>{label(u.role)}</b></div>
            <div className="muted">{u.email} {u.email_verified ? '✓' : '(unverified)'} · {u.phone} {u.phone_verified ? '✓' : '(unverified)'}</div>
            <div className="muted">Joined {timeAgo(u.created_at)} · last sign-in {u.last_login_at ? timeAgo(u.last_login_at) : 'never'} · {u.city}</div>
          </div>
          <span className={`chip ${u.status === 'active' ? 'chip-success' : 'chip-danger'}`}>{label(u.status)}</span>
        </div>
        <div className="grid-4">{Object.entries(data.counts).map(([k, v]) => <div key={k} className="card kpi"><div className="label">{label(k)}</div><div className="value">{v as number}</div></div>)}</div>
        <Link to={`/u/${u.username}`} className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }}>Open profile</Link>
        {staffCan('users.suspend') && u.id !== me?.user.id && (
          <div className="card card-pad stack-sm">
            <h3>Account status</h3>
            {u.status === 'suspended' ? (
              <><div className="small">Suspended: {u.suspended_reason}</div><button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={async () => { if (await act(() => post(`/admin/users/${u.id}/unsuspend`), 'Account restored')) done(); }}>Restore account</button></>
            ) : (
              <div className="row"><Input placeholder="Reason for suspension" value={reason} onChange={(e) => setReason(e.target.value)} /><button className="btn btn-danger btn-sm" disabled={!reason} onClick={async () => { if (await act(() => post(`/admin/users/${u.id}/suspend`, { reason }), 'Account suspended')) done(); }}>Suspend</button></div>
            )}
          </div>
        )}
        {staffCan('*') && u.id !== me?.user.id && (
          <div className="card card-pad row-wrap">
            <span className="small bold">Staff role</span>
            <Select value={u.role} onChange={async (e) => { if (await act(() => post(`/admin/users/${u.id}/role`, { role: e.target.value }), 'Role updated')) done(); }} options={['user', 'verification', 'support', 'moderator', 'admin', 'super_admin'].map((r) => ({ value: r, label: label(r) }))} style={{ width: 'auto' }} />
          </div>
        )}
        <div className="card">
          <div className="card-header"><h3>Recent sign-ins</h3></div>
          <table className="table"><tbody>{data.logins.map((l: Json, i: number) => <tr key={i}><td className="small">{parseTime(l.created_at).toLocaleString()}</td><td className="small">{l.ip}</td><td>{l.success ? (l.suspicious ? <span className="chip chip-accent">New device</span> : <span className="chip chip-success">OK</span>) : <span className="chip chip-danger">Failed</span>}</td></tr>)}</tbody></table>
        </div>
        {data.audit.length > 0 && <div className="card card-pad stack-sm small"><h3>Admin actions</h3>{data.audit.map((a: Json) => <div key={a.id}>{a.action} · {timeAgo(a.created_at)}</div>)}</div>}
      </div>
    </Modal>
  );
}

function Users() {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const dq = useDebounced(q, 300);
  const { data, loading, reload } = useApi(`/admin/users${qs({ q: dq, type, status, limit: 100 })}`);
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="stack">
      <div className="card card-pad row-wrap">
        <div className="input-icon grow"><Icon name="search" /><Input placeholder="Search username, email, phone or name" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Select value={type} onChange={(e) => setType(e.target.value)} placeholder="All types" options={Object.entries(ACCOUNT_LABEL).map(([v, l]) => ({ value: v, label: l }))} style={{ width: 'auto' }} />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Any status" options={['active', 'suspended']} style={{ width: 'auto' }} />
      </div>
      {loading && !data ? <Spinner block /> : (
        <div className="card table-wrap">
          <div className="card-header"><span className="small muted">{data?.total ?? 0} users</span></div>
          <table className="table">
            <thead><tr><th>User</th><th>Type</th><th>Role</th><th>Status</th><th>Verified</th><th className="num">Reports</th><th>Joined</th></tr></thead>
            <tbody>
              {data?.users.map((u: Json) => (
                <tr key={u.id} className="clickable" onClick={() => setOpen(u.id)}>
                  <td><div className="small bold">{u.display_name}</div><div className="xsmall muted">@{u.username} · {u.email}</div></td>
                  <td className="small">{ACCOUNT_LABEL[u.account_type]}</td>
                  <td className="small">{u.role === 'user' ? '—' : label(u.role)}</td>
                  <td><span className={`chip ${u.status === 'active' ? 'chip-success' : 'chip-danger'}`}>{label(u.status)}</span></td>
                  <td className="small">{u.email_verified ? 'Email ' : ''}{u.phone_verified ? 'Phone ' : ''}{u.verified ? '· Business ✓' : ''}</td>
                  <td className="num">{u.reports || ''}</td>
                  <td className="small">{timeAgo(u.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <UserDetail id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}

function Content() {
  const act = useAction();
  const [type, setType] = useState<'posts' | 'products' | 'jobs' | 'comments'>('posts');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const { data, loading, reload } = useApi(`/admin/content/${type}${qs({ status, q: dq, limit: 100 })}`);
  const active = type === 'jobs' ? 'open' : 'active';
  return (
    <div className="stack">
      <Tabs tabs={[{ id: 'posts', label: 'Posts' }, { id: 'products', label: 'Products' }, { id: 'jobs', label: 'Jobs' }, { id: 'comments', label: 'Comments' }]} value={type} onChange={setType} />
      <div className="row-wrap">
        <div className="input-icon grow"><Icon name="search" /><Input placeholder="Search text" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Any status" options={[active, 'flagged', 'removed', ...(type === 'products' ? ['archived'] : type === 'jobs' ? ['closed'] : [])]} style={{ width: 'auto' }} />
      </div>
      {loading && !data ? <Spinner block /> : (
        <div className="card">
          {data?.items.map((it: Json) => (
            <div key={it.id} className="list-item" style={{ alignItems: 'flex-start' }}>
              <Avatar user={it.owner} size={32} />
              <div className="grow">
                <div className="small clamp-2">{it.text}</div>
                <div className="xsmall muted">{it.owner?.display_name} · {timeAgo(it.created_at)}{it.reports ? ` · ${it.reports} report${it.reports > 1 ? 's' : ''}` : ''}</div>
              </div>
              <span className={`chip ${it.status === active ? 'chip-success' : it.status === 'flagged' ? 'chip-accent' : 'chip-danger'}`}>{label(it.status)}</span>
              {it.status === 'removed' || it.status === 'flagged'
                ? <button className="btn btn-ghost btn-sm" onClick={async () => { if (await act(() => post(`/admin/content/${type}/${it.id}/restore`), 'Restored')) reload(); }}>Restore</button>
                : null}
              {it.status !== 'removed' && <button className="btn btn-outline btn-sm" onClick={async () => { if (confirm('Remove this content?') && (await act(() => post(`/admin/content/${type}/${it.id}/remove`, {}), 'Removed'))) reload(); }}>Remove</button>}
            </div>
          ))}
          {!data?.items.length && <Empty title="Nothing here" />}
        </div>
      )}
    </div>
  );
}

function Reports() {
  const act = useAction();
  const [status, setStatus] = useState('open');
  const { data, loading, reload } = useApi(`/admin/reports?status=${status}`);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const resolve = async (r: Json, decision: string) => {
    if (await act(() => post('/admin/reports/resolve', { target_type: r.target_type, target_id: r.target_id, decision, resolution: notes[`${r.target_type}:${r.target_id}`] }), 'Report resolved')) reload();
  };
  return (
    <div className="stack">
      <Tabs tabs={[{ id: 'open', label: 'Open' }, { id: 'actioned', label: 'Actioned' }, { id: 'dismissed', label: 'Dismissed' }]} value={status} onChange={setStatus} />
      {loading && !data ? <Spinner block /> : !data?.items.length ? <div className="card"><Empty icon="checkCircle" title="No reports here" /></div> : data.items.map((r: Json) => {
        const key = `${r.target_type}:${r.target_id}`;
        return (
          <div key={key} className="card card-pad stack-sm">
            <div className="row-between">
              <div className="row-wrap">
                <span className="chip chip-danger">{r.count} report{r.count > 1 ? 's' : ''}</span>
                <span className="chip">{label(r.target_type)} #{r.target_id}</span>
                {r.reasons.map((x: string) => <span key={x} className="chip chip-accent">{label(x)}</span>)}
                {r.preview?.status && <span className="chip">{label(r.preview.status)}</span>}
              </div>
              <span className="xsmall muted">first reported {timeAgo(r.first_at)}</span>
            </div>
            <div className="card card-pad small" style={{ background: 'var(--surface-2)' }}>
              {r.preview?.text ?? <i>Content no longer exists</i>}
              {r.preview?.link && <div><Link to={r.preview.link} className="xsmall">Open in context →</Link></div>}
            </div>
            {r.details.filter((d: Json) => d.details).map((d: Json, i: number) => <div key={i} className="xsmall muted">“{d.details}”</div>)}
            {status === 'open' && (
              <>
                <Input placeholder="Resolution note (sent to audit log)" value={notes[key] ?? ''} onChange={(e) => setNotes({ ...notes, [key]: e.target.value })} />
                <div className="row-wrap">
                  {['post', 'comment', 'product', 'job'].includes(r.target_type) && <button className="btn btn-danger btn-sm" onClick={() => resolve(r, 'remove_content')}>Remove content</button>}
                  <button className="btn btn-outline btn-sm" onClick={() => resolve(r, 'suspend_user')}>Suspend owner</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => resolve(r, 'dismiss')}>Dismiss{r.preview?.status === 'flagged' ? ' & restore' : ''}</button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Verification() {
  const act = useAction();
  const [status, setStatus] = useState('pending');
  const { data, loading, reload } = useApi(`/admin/verifications?status=${status}`);
  const [notes, setNotes] = useState<Record<number, string>>({});
  return (
    <div className="stack">
      <Tabs tabs={[{ id: 'pending', label: 'Pending' }, { id: 'approved', label: 'Approved' }, { id: 'rejected', label: 'Rejected' }]} value={status} onChange={setStatus} />
      {loading && !data ? <Spinner block /> : !data?.items.length ? <div className="card"><Empty icon="shieldCheck" title="No requests" /></div> : data.items.map((v: Json) => (
        <div key={v.id} className="card card-pad stack-sm">
          <div className="row">
            <Avatar user={v.user} size={44} square />
            <div className="grow">
              <Link to={`/u/${v.user?.username}`} className="bold">{v.business?.name}</Link>
              <div className="xsmall muted">{label(v.business?.kind)} · {v.business?.category} · {v.business?.address} · requested {timeAgo(v.created_at)}</div>
            </div>
          </div>
          <div className="row-wrap small">
            <span className={`chip ${v.checks?.email_verified ? 'chip-success' : 'chip-danger'}`}>Email {v.checks?.email_verified ? '✓' : '✗'}</span>
            <span className={`chip ${v.checks?.phone_verified ? 'chip-success' : 'chip-danger'}`}>Phone {v.checks?.phone_verified ? '✓' : '✗'}</span>
            <span className={`chip ${v.business?.has_registration_number ? 'chip-success' : ''}`}>Registration no. {v.business?.has_registration_number ? 'on file' : 'missing'}</span>
            {v.business?.website && <a href={v.business.website} target="_blank" rel="noreferrer" className="chip">Website</a>}
          </div>
          {v.notes && <div className="small">“{v.notes}”</div>}
          <div className="row-wrap">{v.documents.map((d: Json) => <a key={d.id} href={d.url} target="_blank" rel="noreferrer" className="chip chip-info"><Icon name="file" />{d.name}</a>)}</div>
          {status === 'pending' ? (
            <div className="row-wrap">
              <Input placeholder="Notes to the business (required when rejecting)" value={notes[v.id] ?? ''} onChange={(e) => setNotes({ ...notes, [v.id]: e.target.value })} style={{ flex: 1, minWidth: 200 }} />
              <button className="btn btn-primary btn-sm" onClick={async () => { if (await act(() => post(`/admin/verifications/${v.id}`, { decision: 'approve', notes: notes[v.id] }), 'Business verified')) reload(); }}><Icon name="check" />Approve</button>
              <button className="btn btn-outline btn-sm" disabled={!notes[v.id]} onClick={async () => { if (await act(() => post(`/admin/verifications/${v.id}`, { decision: 'reject', notes: notes[v.id] }), 'Request rejected')) reload(); }}>Reject</button>
            </div>
          ) : v.review_notes && <div className="xsmall muted">Reviewer: {v.review_notes}</div>}
        </div>
      ))}
    </div>
  );
}

function Categories() {
  const act = useAction();
  const { data, reload } = useApi('/admin/categories');
  const [name, setName] = useState('');
  const [scope, setScope] = useState('industry');
  return (
    <div className="stack">
      <div className="card card-pad row-wrap">
        <Select value={scope} onChange={(e) => setScope(e.target.value)} options={[{ value: 'industry', label: 'Industry / interest' }, { value: 'product', label: 'Product category' }]} style={{ width: 'auto' }} />
        <Input placeholder="New category name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <button className="btn btn-primary" disabled={!name.trim()} onClick={async () => { if (await act(() => post('/admin/categories', { scope, name }), 'Category added')) { setName(''); reload(); } }}>Add</button>
      </div>
      {['industry', 'product'].map((s) => (
        <div key={s} className="card">
          <div className="card-header"><h3>{s === 'industry' ? 'Industries & interests' : 'Product categories'}</h3></div>
          {data?.categories.filter((c: Json) => c.scope === s).map((c: Json) => (
            <div key={c.id} className="list-item">
              <div className="grow small"><b>{c.name}</b> <span className="muted">· {c.slug}</span></div>
              <label className="checkbox small"><input type="checkbox" checked={!!c.active} onChange={async (e) => { if (await act(() => patch(`/admin/categories/${c.id}`, { active: e.target.checked }))) reload(); }} />Active</label>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Broadcast() {
  const { meta } = useSession();
  const act = useAction();
  const [f, setF] = useState({ title: '', body: '', link: '', account_type: '', city: '', interest: '' });
  return (
    <div className="card card-pad stack">
      <h3>Send a platform notification</h3>
      <p className="small muted">Targeted, not blasted: narrow the audience by account type, city or interest.</p>
      <div className="form-grid">
        <Field label="Title" className="span-2"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={160} /></Field>
        <Field label="Message" className="span-2"><Textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
        <Field label="Link (optional, in-app path)"><Input value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} placeholder="/jobs" /></Field>
        <Field label="Account type"><Select value={f.account_type} onChange={(e) => setF({ ...f, account_type: e.target.value })} placeholder="Everyone" options={Object.entries(ACCOUNT_LABEL).map(([v, l]) => ({ value: v, label: l }))} /></Field>
        <Field label="City"><Select value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} placeholder="All cities" options={(meta?.cities ?? []).map((c) => c.name)} /></Field>
        <Field label="Interest"><Select value={f.interest} onChange={(e) => setF({ ...f, interest: e.target.value })} placeholder="Any" options={(meta?.industries ?? []).map((c) => ({ value: c.slug, label: c.name }))} /></Field>
      </div>
      <div className="form-actions">
        <button className="btn btn-primary" disabled={!f.title} onClick={async () => {
          const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
          const r = await act(() => post('/admin/broadcast', body));
          if (r) { alert(`Sent to ${r.sent} users`); setF({ ...f, title: '', body: '' }); }
        }}><Icon name="send" />Send</button>
      </div>
    </div>
  );
}

function Audit() {
  const { data, loading } = useApi('/admin/audit?limit=100');
  if (loading) return <Spinner block />;
  return (
    <div className="card table-wrap">
      <table className="table">
        <thead><tr><th>When</th><th>Staff</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
        <tbody>{data?.items.map((a: Json) => (
          <tr key={a.id}>
            <td className="small">{parseTime(a.created_at).toLocaleString()}</td>
            <td className="small">{a.actor?.display_name}</td>
            <td><span className="chip">{a.action}</span></td>
            <td className="small">{a.target_type ? `${a.target_type} #${a.target_id}` : '—'}</td>
            <td className="xsmall muted" style={{ maxWidth: 320 }}>{a.details ? JSON.stringify(a.details) : ''}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export default function Admin() {
  const { me, staffCan } = useSession();
  if (!me?.staff_permissions.length) return <Navigate to="/" replace />;
  const links: [string, string, string, string][] = [
    ['', 'Overview', 'chart', 'stats'], ['users', 'Users', 'users', 'users.view'], ['content', 'Content', 'layers', 'content'],
    ['reports', 'Reports', 'flag', 'reports'], ['verification', 'Verification', 'shieldCheck', 'verification'],
    ['categories', 'Categories', 'tag', 'categories'], ['broadcast', 'Broadcast', 'megaphone', 'broadcast'], ['audit', 'Audit log', 'file', 'audit'],
  ];
  const allowed = links.filter(([, , , p]) => staffCan(p));
  return (
    <main className="page">
      <PageTitle title="Admin portal" subtitle={`Signed in as ${label(me.user.role)}`} />
      <div className="layout-side">
        <aside className="card sticky-side">
          <nav className="side-nav">{allowed.map(([to, text, icon]) => <NavLink key={to} to={`/admin${to ? '/' + to : ''}`} end={!to}><Icon name={icon} />{text}</NavLink>)}</nav>
        </aside>
        <section>
          <SectionSwap><Routes>
            <Route index element={staffCan('stats') ? <Overview /> : <Navigate to={allowed[0]?.[0] ?? '/'} replace />} />
            {staffCan('users.view') && <Route path="users" element={<Users />} />}
            {staffCan('content') && <Route path="content" element={<Content />} />}
            {staffCan('reports') && <Route path="reports" element={<Reports />} />}
            {staffCan('verification') && <Route path="verification" element={<Verification />} />}
            {staffCan('categories') && <Route path="categories" element={<Categories />} />}
            {staffCan('broadcast') && <Route path="broadcast" element={<Broadcast />} />}
            {staffCan('audit') && <Route path="audit" element={<Audit />} />}
            <Route path="*" element={<Empty icon="lock" title="You don't have access to this section" />} />
          </Routes></SectionSwap>
        </section>
      </div>
    </main>
  );
}
