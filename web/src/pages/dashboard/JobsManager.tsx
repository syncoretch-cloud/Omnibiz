import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Icon } from '../../components/Icon.tsx';
import { Empty, ErrorBox, Field, Input, Modal, Select, Spinner, TagInput, Textarea } from '../../components/ui.tsx';
import { get, patch, post } from '../../lib/api.ts';
import type { Json } from '../../lib/api.ts';
import { useAction, useSession } from '../../lib/session.tsx';
import { DOC_LABEL, dateLabel, label, salary } from '../../lib/format.ts';

const DOC_OPTIONS = ['cv', 'certificate', 'portfolio', 'cover_letter', 'id', 'academic'];

function JobForm({ job, onClose, onSaved }: { job?: Json; onClose: () => void; onSaved: () => void }) {
  const { me, meta } = useSession();
  const [f, setF] = useState<Json>(() => job ? { ...job } : {
    title: '', department: '', industry: me?.business?.category ?? '', city: me?.user.city ?? '', location_text: '', remote: false,
    employment_type: 'full_time', description: '', responsibilities: '', skills: [], education_req: 'none', education_field: '', experience_years: 0,
    salary_min: '', salary_max: '', currency: 'TZS', salary_period: 'month', deadline: '', positions: 1, required_docs: ['cv'], additional: '', announce: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setF((x: Json) => ({ ...x, [k]: v }));

  const save = async () => {
    setBusy(true);
    setError(null);
    const body: Json = { ...f, salary_min: f.salary_min === '' ? null : Number(f.salary_min), salary_max: f.salary_max === '' ? null : Number(f.salary_max), experience_years: Number(f.experience_years) || 0, positions: Number(f.positions) || 1 };
    for (const k of ['id', 'company', 'saved', 'application_stage', 'accepting', 'location', 'created_at', 'distance_km', 'status']) delete body[k];
    if (job) delete body.announce;
    if (!body.deadline) body.deadline = null;
    try {
      if (job) await patch(`/jobs/${job.id}`, body);
      else await post('/jobs', body);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal large title={job ? 'Edit vacancy' : 'Post a vacancy'} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>{job ? 'Save changes' : 'Publish vacancy'}</button></>}>
      <div className="stack">
        <ErrorBox error={error} />
        {!job && <div className="banner banner-info small"><Icon name="target" />When you publish, OmniBiz notifies job seekers whose skills, education, experience and location match — not everyone.</div>}
        <div className="form-grid">
          <Field label="Job title *" className="span-2"><Input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Software Developer" /></Field>
          <Field label="Department"><Input value={f.department ?? ''} onChange={(e) => set('department', e.target.value)} /></Field>
          <Field label="Industry"><Select value={f.industry ?? ''} onChange={(e) => set('industry', e.target.value)} options={(meta?.industries ?? []).map((c) => ({ value: c.slug, label: c.name }))} /></Field>
          <Field label="Employment type *"><Select value={f.employment_type} onChange={(e) => set('employment_type', e.target.value)} options={(meta?.employment_types ?? []).map((t) => ({ value: t, label: label(t) }))} /></Field>
          <Field label="Number of positions"><Input type="number" min={1} value={f.positions} onChange={(e) => set('positions', e.target.value)} /></Field>
          <Field label="City"><Input value={f.city ?? ''} onChange={(e) => set('city', e.target.value)} list="job-cities" disabled={f.remote} /><datalist id="job-cities">{meta?.cities.map((c) => <option key={c.name} value={c.name} />)}</datalist></Field>
          <Field label="Location details"><Input value={f.location_text ?? ''} onChange={(e) => set('location_text', e.target.value)} placeholder="e.g. Njiro office" /></Field>
          <label className="checkbox span-2"><input type="checkbox" checked={!!f.remote} onChange={(e) => set('remote', e.target.checked)} />This is a remote role</label>
          <Field label="Job description *" className="span-2"><Textarea value={f.description} onChange={(e) => set('description', e.target.value)} style={{ minHeight: 140 }} /></Field>
          <Field label="Responsibilities" hint="One per line" className="span-2"><Textarea value={f.responsibilities ?? ''} onChange={(e) => set('responsibilities', e.target.value)} /></Field>
          <Field label="Required skills" className="span-2" hint="Used to match and notify candidates"><TagInput value={f.skills} onChange={(v) => set('skills', v)} placeholder="e.g. JavaScript, React" /></Field>
          <Field label="Minimum education"><Select value={f.education_req} onChange={(e) => set('education_req', e.target.value)} options={(meta?.education_levels ?? []).map((l) => ({ value: l, label: l === 'none' ? 'No minimum' : label(l) }))} /></Field>
          <Field label="Field of study"><Input value={f.education_field ?? ''} onChange={(e) => set('education_field', e.target.value)} placeholder="e.g. Computer Science" /></Field>
          <Field label="Years of experience"><Input type="number" min={0} value={f.experience_years} onChange={(e) => set('experience_years', e.target.value)} /></Field>
          <Field label="Application deadline"><Input type="date" value={f.deadline ?? ''} onChange={(e) => set('deadline', e.target.value)} /></Field>
          <Field label="Salary from"><Input type="number" min={0} value={f.salary_min ?? ''} onChange={(e) => set('salary_min', e.target.value)} /></Field>
          <Field label="Salary to"><Input type="number" min={0} value={f.salary_max ?? ''} onChange={(e) => set('salary_max', e.target.value)} /></Field>
          <Field label="Currency"><Select value={f.currency} onChange={(e) => set('currency', e.target.value)} options={meta?.currencies ?? ['TZS']} /></Field>
          <Field label="Per"><Select value={f.salary_period} onChange={(e) => set('salary_period', e.target.value)} options={['hour', 'day', 'month', 'year']} /></Field>
          <Field label="Documents required" className="span-2">
            <div className="row-wrap">
              {DOC_OPTIONS.map((d) => {
                const on = f.required_docs.includes(d);
                return <button key={d} type="button" className={`chip${on ? ' active' : ''}`} onClick={() => set('required_docs', on ? f.required_docs.filter((x: string) => x !== d) : [...f.required_docs, d])}>{DOC_LABEL[d]}</button>;
              })}
            </div>
          </Field>
          <Field label="Additional requirements" className="span-2"><Textarea value={f.additional ?? ''} onChange={(e) => set('additional', e.target.value)} style={{ minHeight: 60 }} /></Field>
          {!job && <label className="checkbox span-2"><input type="checkbox" checked={f.announce} onChange={(e) => set('announce', e.target.checked)} />Post a hiring announcement to my followers' feeds</label>}
        </div>
      </div>
    </Modal>
  );
}

export function JobsManager() {
  const act = useAction();
  const { me } = useSession();
  const [params, setParams] = useSearchParams();
  const [jobs, setJobs] = useState<Json[] | null>(null);
  const [full, setFull] = useState<Json[]>([]);
  const load = () => {
    get('/recruitment/overview').then((r) => setJobs(r.jobs));
    get(`/jobs?company=${me!.user.id}&limit=50`).then((r) => setFull(r.items));
  };
  useEffect(() => {
    load();
  }, [me]);
  const editId = Number(params.get('edit'));
  const editing = editId ? full.find((j) => j.id === editId) : undefined;
  const creating = params.get('new') === '1';
  const close = () => setParams({});

  const setStatus = async (id: number, status: string) => {
    if (await act(() => patch(`/jobs/${id}`, { status }), status === 'closed' ? 'Vacancy closed' : 'Vacancy reopened')) load();
  };

  return (
    <div className="stack">
      <div className="row-between">
        <h2>Vacancies</h2>
        <button className="btn btn-primary" onClick={() => setParams({ new: '1' })}><Icon name="plus" />Post a vacancy</button>
      </div>
      {!jobs ? <Spinner block /> : !jobs.length ? (
        <div className="card"><Empty icon="briefcase" title="No vacancies yet">Post a job and OmniBiz will notify matching candidates.</Empty></div>
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>Vacancy</th><th className="num">Views</th><th className="num">Applicants</th><th>Deadline</th><th>Status</th><th /></tr></thead>
            <tbody>
              {jobs.map((j) => {
                const fj = full.find((x) => x.id === j.id);
                return (
                  <tr key={j.id}>
                    <td><Link to={`/jobs/${j.id}`} className="bold small">{j.title}</Link>{fj && <div className="xsmall muted">{fj.remote ? 'Remote' : fj.city} · {salary(fj)}</div>}</td>
                    <td className="num small">{j.view_count}</td>
                    <td className="num"><Link to={`/dashboard/recruitment/jobs/${j.id}`} className="bold">{j.applications}</Link>{j.new_applications > 0 && <span className="chip chip-accent" style={{ marginLeft: 6 }}>{j.new_applications} new</span>}</td>
                    <td className="small">{j.deadline ? dateLabel(j.deadline) : '—'}</td>
                    <td><span className={`chip ${j.status === 'open' ? 'chip-success' : j.status === 'flagged' ? 'chip-danger' : ''}`}>{label(j.status)}</span></td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 2 }}>
                        <Link to={`/dashboard/recruitment/jobs/${j.id}`} className="btn btn-outline btn-sm">Pipeline</Link>
                        <button className="icon-btn" disabled={!fj} onClick={() => setParams({ edit: String(j.id) })} aria-label="Edit"><Icon name="edit" /></button>
                        {j.status === 'open' ? <button className="btn btn-ghost btn-sm" onClick={() => setStatus(j.id, 'closed')}>Close</button> : j.status === 'closed' ? <button className="btn btn-ghost btn-sm" onClick={() => setStatus(j.id, 'open')}>Reopen</button> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {(creating || editing) && <JobForm job={editing} onClose={close} onSaved={() => { close(); load(); }} />}
    </div>
  );
}
