import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../components/Icon.tsx';
import { Empty, ErrorBox, Field, Input, Modal, PageTitle, Select, Spinner, TagInput, Textarea, Visibility, VisibilitySelect } from '../components/ui.tsx';
import { del, get, patch, post, uploadDocument } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { useAction, useSession } from '../lib/session.tsx';
import { DOC_LABEL, fileSize, label, timeAgo } from '../lib/format.ts';

type FieldDef = { key: string; label: string; type?: 'text' | 'textarea' | 'select' | 'month' | 'number' | 'checkbox' | 'url'; options?: string[]; required?: boolean; span?: boolean };

const SECTIONS: { id: string; title: string; icon: string; fields: FieldDef[]; summary: (d: Json) => string; sub?: (d: Json) => string }[] = [
  { id: 'experience', title: 'Work experience', icon: 'briefcase', summary: (d) => `${d.position} · ${d.company}`, sub: (d) => `${d.start_date ?? ''} – ${d.current ? 'Present' : d.end_date ?? ''}`,
    fields: [
      { key: 'position', label: 'Position / title', required: true }, { key: 'company', label: 'Company', required: true },
      { key: 'start_date', label: 'Start', type: 'month' }, { key: 'end_date', label: 'End', type: 'month' },
      { key: 'current', label: 'I currently work here', type: 'checkbox', span: true },
      { key: 'responsibilities', label: 'Responsibilities & achievements', type: 'textarea', span: true },
    ] },
  { id: 'education', title: 'Education', icon: 'graduation', summary: (d) => d.school, sub: (d) => [label(d.level), d.program, [d.start_year, d.end_year].filter(Boolean).join('–')].filter(Boolean).join(' · '),
    fields: [
      { key: 'school', label: 'School / college / university', required: true, span: true }, { key: 'program', label: 'Programme / field of study' },
      { key: 'level', label: 'Level', type: 'select', options: ['secondary', 'certificate', 'diploma', 'bachelor', 'master', 'phd'] },
      { key: 'start_year', label: 'Start year', type: 'number' }, { key: 'end_year', label: 'End year', type: 'number' },
      { key: 'achievements', label: 'Achievements', type: 'textarea', span: true },
    ] },
  { id: 'skill', title: 'Skills', icon: 'zap', summary: (d) => d.name, sub: (d) => label(d.level),
    fields: [{ key: 'name', label: 'Skill', required: true }, { key: 'level', label: 'Level', type: 'select', options: ['beginner', 'intermediate', 'advanced', 'expert'] }] },
  { id: 'certification', title: 'Certifications', icon: 'award', summary: (d) => d.name, sub: (d) => [d.issuer, d.issued_on].filter(Boolean).join(' · '),
    fields: [{ key: 'name', label: 'Certificate name', required: true, span: true }, { key: 'issuer', label: 'Issuing organisation' }, { key: 'issued_on', label: 'Date issued', type: 'month' }, { key: 'url', label: 'Credential link', type: 'url', span: true }] },
  { id: 'language', title: 'Languages', icon: 'globe', summary: (d) => d.name, sub: (d) => label(d.proficiency),
    fields: [{ key: 'name', label: 'Language', required: true }, { key: 'proficiency', label: 'Proficiency', type: 'select', options: ['basic', 'conversational', 'fluent', 'native'] }] },
  { id: 'portfolio', title: 'Portfolio', icon: 'layers', summary: (d) => d.title, sub: (d) => d.url ?? '',
    fields: [{ key: 'title', label: 'Project title', required: true, span: true }, { key: 'url', label: 'Link (website, GitHub, video…)', type: 'url', span: true }, { key: 'description', label: 'Description', type: 'textarea', span: true }] },
];

function ItemDialog({ section, item, onClose, onSaved }: { section: (typeof SECTIONS)[number]; item?: Json; onClose: () => void; onSaved: (cv: Json) => void }) {
  const [data, setData] = useState<Json>(() => {
    if (!item) return {};
    const { id: _id, visibility: _v, ...rest } = item;
    return rest;
  });
  const [visibility, setVisibility] = useState(item?.visibility ?? 'public');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== '' && v !== undefined));
    try {
      const r = item ? await patch(`/users/me/cv/${item.id}`, { data: clean, visibility }) : await post('/users/me/cv', { section: section.id, data: clean, visibility });
      onSaved(r.cv);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal title={`${item ? 'Edit' : 'Add'} ${section.title.toLowerCase().replace(/s$/, '')}`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></>}>
      <div className="stack">
        <ErrorBox error={error} />
        <div className="form-grid">
          {section.fields.map((f) => (
            <Field key={f.key} label={f.type === 'checkbox' ? undefined : `${f.label}${f.required ? ' *' : ''}`} className={f.span ? 'span-2' : ''}>
              {f.type === 'textarea' ? <Textarea value={data[f.key] ?? ''} onChange={(e) => setData({ ...data, [f.key]: e.target.value })} />
                : f.type === 'select' ? <Select value={data[f.key] ?? ''} onChange={(e) => setData({ ...data, [f.key]: e.target.value })} placeholder="Choose…" options={f.options!.map((o) => ({ value: o, label: label(o) }))} />
                : f.type === 'checkbox' ? <label className="checkbox"><input type="checkbox" checked={!!data[f.key]} onChange={(e) => setData({ ...data, [f.key]: e.target.checked })} />{f.label}</label>
                : <Input type={f.type === 'month' ? 'month' : f.type === 'number' ? 'number' : f.type === 'url' ? 'url' : 'text'} value={data[f.key] ?? ''} onChange={(e) => setData({ ...data, [f.key]: f.type === 'number' ? (e.target.value ? Number(e.target.value) : '') : e.target.value })} disabled={f.key === 'end_date' && data.current} />}
            </Field>
          ))}
        </div>
        <Field label="Who can see this?"><VisibilitySelect value={visibility} onChange={setVisibility} /></Field>
      </div>
    </Modal>
  );
}

function ProfileForm() {
  const { me, meta, setMe } = useSession();
  const act = useAction();
  const p = me!.profile!;
  const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v || '[]') : v ?? []);
  const [f, setF] = useState<Json>({
    full_name: p.full_name ?? '', headline: p.headline ?? '', summary: p.summary ?? '', open_to_work: !!p.open_to_work,
    preferred_industries: parse(p.preferred_industries), preferred_locations: parse(p.preferred_locations), job_types: parse(p.job_types),
    expected_salary: p.expected_salary ?? '', field_visibility: typeof p.field_visibility === 'string' ? JSON.parse(p.field_visibility || '{}') : p.field_visibility ?? {},
  });
  const save = async () => {
    const r = await act(() => patch('/users/me/profile', { ...f, expected_salary: f.expected_salary === '' ? null : Number(f.expected_salary) }), 'Profile saved');
    if (r) setMe(r);
  };
  const fv = f.field_visibility;
  return (
    <div className="card card-pad stack">
      <h3>Professional profile</h3>
      <div className="form-grid">
        <Field label="Full name"><Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field label="Headline" hint="e.g. Software Developer · React & Node.js"><Input value={f.headline} onChange={(e) => setF({ ...f, headline: e.target.value })} maxLength={160} /></Field>
        <Field label="Professional summary" className="span-2"><Textarea value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} maxLength={3000} /></Field>
        <label className="checkbox span-2"><input type="checkbox" checked={f.open_to_work} onChange={(e) => setF({ ...f, open_to_work: e.target.checked })} /> <span><b>Open to work</b> — let OmniBiz notify me about matching vacancies</span></label>
        <Field label="Preferred industries">
          <TagInput value={f.preferred_industries.map((s: string) => meta?.industries.find((c) => c.slug === s)?.name ?? s)} onChange={(v) => setF({ ...f, preferred_industries: v.map((n) => meta?.industries.find((c) => c.name === n)?.slug ?? n) })} suggestions={meta?.industries.map((c) => c.name)} placeholder="Type and press Enter" />
        </Field>
        <Field label="Preferred job locations"><TagInput value={f.preferred_locations} onChange={(v) => setF({ ...f, preferred_locations: v })} suggestions={meta?.cities.map((c) => c.name)} placeholder="e.g. Arusha" /></Field>
        <Field label="Job types" className="span-2">
          <div className="row-wrap">
            {meta?.employment_types.map((t) => {
              const on = f.job_types.includes(t);
              return <button key={t} type="button" className={`chip${on ? ' active' : ''}`} onClick={() => setF({ ...f, job_types: on ? f.job_types.filter((x: string) => x !== t) : [...f.job_types, t] })}>{label(t)}</button>;
            })}
          </div>
        </Field>
        <Field label="Expected monthly salary (TZS, private)"><Input type="number" min={0} value={f.expected_salary} onChange={(e) => setF({ ...f, expected_salary: e.target.value })} /></Field>
      </div>
      <div>
        <div className="label" style={{ marginBottom: 8 }}>Contact details visibility</div>
        <div className="grid-3">
          {[['email', 'Email'], ['phone', 'Phone'], ['dob', 'Date of birth']].map(([k, l]) => (
            <Field key={k} label={l}><VisibilitySelect value={fv[k] ?? (k === 'dob' ? 'private' : 'recruiters')} onChange={(v) => setF({ ...f, field_visibility: { ...fv, [k]: v } })} /></Field>
          ))}
        </div>
      </div>
      <div className="form-actions"><button className="btn btn-primary" onClick={save}>Save profile</button></div>
    </div>
  );
}

function Documents({ docs, setDocs }: { docs: Json[]; setDocs: (d: Json[]) => void }) {
  const act = useAction();
  const ref = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState('cv');
  const [visibility, setVisibility] = useState('private');
  const [busy, setBusy] = useState(false);
  const upload = async (files: FileList | null) => {
    if (!files?.[0]) return;
    setBusy(true);
    const d = await act(() => uploadDocument(files[0], kind, visibility), 'Document uploaded');
    setBusy(false);
    if (d) setDocs([d, ...docs]);
    if (ref.current) ref.current.value = '';
  };
  const remove = async (id: number) => {
    if (confirm('Delete this document?') && (await act(() => del(`/documents/${id}`)))) setDocs(docs.filter((d) => d.id !== id));
  };
  const changeVis = async (id: number, v: string) => {
    if (await act(() => patch(`/documents/${id}`, { visibility: v }))) setDocs(docs.map((d) => (d.id === id ? { ...d, visibility: v } : d)));
  };
  return (
    <div className="card">
      <div className="card-header"><h3>Documents</h3><span className="xsmall muted">CVs, certificates, IDs — PDF/Word/images up to 25 MB</span></div>
      <div className="card-body row-wrap">
        <Select value={kind} onChange={(e) => setKind(e.target.value)} options={['cv', 'certificate', 'portfolio', 'cover_letter', 'id', 'academic', 'other'].map((k) => ({ value: k, label: DOC_LABEL[k] }))} style={{ width: 'auto' }} aria-label="Document type" />
        <VisibilitySelect value={visibility} onChange={setVisibility} />
        <button className="btn btn-primary btn-sm" onClick={() => ref.current?.click()} disabled={busy}><Icon name="upload" />{busy ? 'Uploading…' : 'Upload'}</button>
        <input ref={ref} type="file" hidden accept=".pdf,.doc,.docx,image/*" onChange={(e) => upload(e.target.files)} />
      </div>
      {docs.map((d) => (
        <div key={d.id} className="list-item">
          <Icon name="file" />
          <div className="grow">
            <a href={d.url} target="_blank" rel="noreferrer" className="small bold">{d.name}</a>
            <div className="xsmall muted">{DOC_LABEL[d.kind]} · {fileSize(d.size)} · {timeAgo(d.created_at)}</div>
          </div>
          <VisibilitySelect value={d.visibility} onChange={(v) => changeVis(d.id, v)} />
          <button className="icon-btn" onClick={() => remove(d.id)} aria-label="Delete"><Icon name="trash" /></button>
        </div>
      ))}
      {!docs.length && <Empty icon="file" title="No documents yet">Upload your CV and certificates once, then attach them to any application.</Empty>}
    </div>
  );
}

export default function CvEditor() {
  const { me, can } = useSession();
  const act = useAction();
  const [cv, setCv] = useState<Json | null>(null);
  const [docs, setDocs] = useState<Json[]>([]);
  const [dialog, setDialog] = useState<{ section: (typeof SECTIONS)[number]; item?: Json } | null>(null);
  useEffect(() => {
    get('/users/me/cv').then((r) => { setCv(r.cv); setDocs(r.documents); }).catch(() => setCv({}));
  }, []);
  if (!can('manage_cv')) return <main className="page page-narrow"><div className="card"><Empty icon="lock" title="CV builder is for personal accounts" /></div></main>;
  if (!cv) return <Spinner block />;

  const remove = async (id: number) => {
    const r = await act(() => del(`/users/me/cv/${id}`));
    if (r) setCv(r.cv);
  };

  return (
    <main className="page page-mid">
      <PageTitle title="My CV & professional profile" subtitle="Recruiters see public and “recruiters only” sections. Private items are only visible to you." actions={<Link to={`/u/${me?.user.username}`} className="btn btn-outline"><Icon name="eye" />Preview profile</Link>} />
      <div className="stack">
        <ProfileForm />
        {SECTIONS.map((s) => (
          <div key={s.id} className="card">
            <div className="card-header">
              <h3 className="row"><Icon name={s.icon} size={18} />{s.title}</h3>
              <button className="btn btn-outline btn-sm" onClick={() => setDialog({ section: s })}><Icon name="plus" />Add</button>
            </div>
            {(cv[s.id] ?? []).map((item: Json) => (
              <div key={item.id} className="list-item">
                <div className="grow">
                  <div className="small bold">{s.summary(item)}</div>
                  {s.sub && s.sub(item) && <div className="xsmall muted">{s.sub(item)}</div>}
                </div>
                <Visibility value={item.visibility} />
                <button className="icon-btn" onClick={() => setDialog({ section: s, item })} aria-label="Edit"><Icon name="edit" /></button>
                <button className="icon-btn" onClick={() => remove(item.id)} aria-label="Delete"><Icon name="trash" /></button>
              </div>
            ))}
            {!(cv[s.id] ?? []).length && <div className="card-body small muted">Nothing added yet.</div>}
          </div>
        ))}
        <Documents docs={docs} setDocs={setDocs} />
      </div>
      {dialog && <ItemDialog section={dialog.section} item={dialog.item} onClose={() => setDialog(null)} onSaved={(c) => { setCv(c); setDialog(null); }} />}
    </main>
  );
}
