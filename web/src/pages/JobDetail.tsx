import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon.tsx';
import { Avatar, Empty, ErrorBox, Field, MatchRing, Modal, Spinner, Textarea, Verified } from '../components/ui.tsx';
import { JobCard, SaveButton } from '../components/Cards.tsx';
import { ReportDialog } from '../components/Report.tsx';
import { ApiError, get, post, uploadDocument } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { useApi } from '../lib/hooks.ts';
import { useAction, useSession, useToast } from '../lib/session.tsx';
import { DOC_LABEL, STAGE_LABEL, dateLabel, fileSize, label, salary, timeAgo } from '../lib/format.ts';

function MatchCard({ match }: { match: Json }) {
  const b = match.breakdown;
  const rows: [string, number, number][] = [
    ['Skills', b.skills, 45], ['Education', b.education, 15], ['Experience', b.experience, 15], ['Location', b.location, 15], ['Industry', b.industry, 10],
  ];
  return (
    <div className="card">
      <div className="card-header"><h3 className="row"><Icon name="sparkles" size={18} />Your match</h3></div>
      <div className="card-body stack">
        <div className="row">
          <MatchRing score={match.score} />
          <div className="small">
            {match.score >= 75 ? 'Strong match — your profile fits this role well.' : match.score >= 50 ? 'Good match — a few gaps to address in your application.' : 'Partial match — consider highlighting transferable experience.'}
          </div>
        </div>
        <div className="stack-sm">
          {rows.map(([name, v, max]) => (
            <div key={name}>
              <div className="row-between xsmall"><span>{name}</span><span className="muted">{v}/{max}</span></div>
              <div className="match-bar"><div style={{ width: `${(v / max) * 100}%` }} /></div>
            </div>
          ))}
        </div>
        {match.matchedSkills.length + match.partialSkills.length + match.missingSkills.length > 0 && (
          <div className="row-wrap">
            {match.matchedSkills.map((s: string) => <span key={s} className="chip chip-success"><Icon name="check" />{s}</span>)}
            {match.partialSkills.map((s: string) => <span key={s} className="chip chip-info" title="Mentioned in your experience">~ {s}</span>)}
            {match.missingSkills.map((s: string) => <span key={s} className="chip chip-danger"><Icon name="x" />{s}</span>)}
          </div>
        )}
        {match.strengths.length > 0 && <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{match.strengths.map((s: string) => <li key={s}>{s}</li>)}</ul>}
        {match.gaps.length > 0 && <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>{match.gaps.map((s: string) => <li key={s}>{s}</li>)}</ul>}
        <Link to="/me/cv" className="btn btn-outline btn-sm">Improve my CV</Link>
      </div>
    </div>
  );
}

/** Application flow (spec §14): requirements → details → documents → review → submit. */
function ApplyWizard({ job, onClose, onDone, source }: { job: Json; onClose: () => void; onDone: () => void; source: string }) {
  const { me } = useSession();
  const toast = useToast();
  const [step, setStep] = useState(1);
  const [docs, setDocs] = useState<Json[] | null>(null);
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const [cover, setCover] = useState('');
  const [answers, setAnswers] = useState({ availability: '', expected_salary: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const required: string[] = job.required_docs;
  const docKinds = required.filter((k) => k !== 'cover_letter');

  useEffect(() => {
    get('/documents').then((r) => {
      setDocs(r.documents);
      const pre: Record<string, number> = {};
      for (const k of docKinds) {
        const d = r.documents.find((x: Json) => x.kind === k);
        if (d) pre[k] = d.id;
      }
      setChosen(pre);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upload = async (files: FileList | null) => {
    if (!files?.[0] || !uploadingKind) return;
    try {
      const d = await uploadDocument(files[0], uploadingKind, 'private');
      setDocs((x) => [d, ...(x ?? [])]);
      setChosen((c) => ({ ...c, [uploadingKind]: d.id }));
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setUploadingKind(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const missing = docKinds.filter((k) => !chosen[k] && !(k === 'portfolio'));
  const coverRequired = required.includes('cover_letter');

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await post(`/jobs/${job.id}/apply`, {
        cover_letter: cover || undefined,
        answers: Object.fromEntries(Object.entries(answers).filter(([, v]) => v)),
        document_ids: [...new Set(Object.values(chosen))],
        source,
      });
      setStep(5);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError && e.details?.missing ? `Still missing: ${e.details.missing.map((m) => DOC_LABEL[m] ?? m).join(', ')}` : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const titles = ['Application requirements', 'Your details', 'Documents', 'Review application', 'Application submitted'];
  const footer =
    step === 5 ? <button className="btn btn-primary" onClick={onClose}>Done</button> : (
      <>
        {step > 1 && <button className="btn btn-ghost" onClick={() => setStep(step - 1)}>Back</button>}
        {step < 4 && <button className="btn btn-primary" disabled={step === 2 && coverRequired && cover.length < 50 && !chosen.cover_letter} onClick={() => setStep(step + 1)}>Next</button>}
        {step === 4 && <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Submit application'}</button>}
      </>
    );

  return (
    <Modal title={titles[step - 1]} onClose={onClose} footer={footer} large>
      {step < 5 && <div className="steps" style={{ marginBottom: 16 }}>{[1, 2, 3, 4].map((s) => <div key={s} className={`step ${step >= s ? 'done' : ''}`} />)}</div>}
      {step === 1 && (
        <div className="stack">
          <p>To apply for <b>{job.title}</b> at <b>{job.company?.display_name}</b>, you’ll need:</p>
          <div className="card">
            {required.map((k) => (
              <div key={k} className="list-item">
                <Icon name={k === 'cover_letter' ? 'edit' : 'file'} />
                <div className="grow">{DOC_LABEL[k] ?? k}</div>
                {k !== 'cover_letter' && docs && (docs.some((d) => d.kind === k) ? <span className="chip chip-success"><Icon name="check" />On file</span> : <span className="chip">Upload needed</span>)}
              </div>
            ))}
          </div>
          {job.additional && <div className="small"><b>Additional requirements:</b> <span className="pre">{job.additional}</span></div>}
          <p className="small muted">Your OmniBiz profile and CV (public and recruiter-visible sections) are shared with the employer.</p>
        </div>
      )}
      {step === 2 && (
        <div className="stack">
          <div className="card card-pad row">
            <Avatar user={me?.user} size={44} />
            <div><div className="bold">{me?.user.display_name}</div><div className="small muted">{me?.user.email} · {me?.user.phone}</div></div>
          </div>
          <Field label={`Cover letter${coverRequired ? ' (required)' : ' (optional)'}`} hint={coverRequired ? 'At least 50 characters, or attach a cover letter document in the next step.' : 'Tell the employer why you are a great fit.'}>
            <Textarea value={cover} onChange={(e) => setCover(e.target.value)} maxLength={6000} style={{ minHeight: 160 }} />
          </Field>
          <div className="form-grid">
            <Field label="When can you start?"><input className="input" value={answers.availability} onChange={(e) => setAnswers({ ...answers, availability: e.target.value })} placeholder="e.g. Immediately, 1 month notice" /></Field>
            <Field label="Expected salary (optional)"><input className="input" value={answers.expected_salary} onChange={(e) => setAnswers({ ...answers, expected_salary: e.target.value })} placeholder="e.g. TZS 2,000,000 / month" /></Field>
          </div>
        </div>
      )}
      {step === 3 && (
        <div className="stack">
          {docs === null ? <Spinner /> : [...docKinds, ...(coverRequired ? ['cover_letter'] : [])].map((k) => {
            const options = docs.filter((d) => d.kind === k);
            return (
              <div key={k} className="card card-pad stack-sm">
                <div className="row-between">
                  <div className="bold">{DOC_LABEL[k] ?? k}{k === 'cover_letter' ? ' (optional if written)' : k === 'portfolio' ? ' (or portfolio items on your CV)' : ''}</div>
                  <button className="btn btn-outline btn-sm" onClick={() => { setUploadingKind(k); fileRef.current?.click(); }} disabled={!!uploadingKind}>
                    <Icon name="upload" />{uploadingKind === k ? 'Uploading…' : 'Upload'}
                  </button>
                </div>
                {options.length ? options.map((d) => (
                  <label key={d.id} className="checkbox">
                    <input type="radio" name={`doc-${k}`} checked={chosen[k] === d.id} onChange={() => setChosen({ ...chosen, [k]: d.id })} />
                    <span className="grow">{d.name} <span className="xsmall muted">· {fileSize(d.size)} · {timeAgo(d.created_at)}</span></span>
                  </label>
                )) : <div className="small muted">No {DOC_LABEL[k]?.toLowerCase() ?? k} uploaded yet.</div>}
              </div>
            );
          })}
          <input ref={fileRef} type="file" hidden accept=".pdf,.doc,.docx,image/*" onChange={(e) => upload(e.target.files)} />
          <p className="xsmall muted">PDF, Word or image files up to 25 MB. Documents stay private — only employers you apply to can open them.</p>
        </div>
      )}
      {step === 4 && (
        <div className="stack">
          <ErrorBox error={error} />
          {missing.length > 0 && <div className="banner banner-warn small"><Icon name="alert" />Missing: {missing.map((m) => DOC_LABEL[m]).join(', ')}</div>}
          <div className="card">
            <div className="list-item"><div className="grow muted small">Position</div><div className="bold">{job.title}</div></div>
            <div className="list-item"><div className="grow muted small">Employer</div><div>{job.company?.display_name}</div></div>
            <div className="list-item"><div className="grow muted small">Documents</div><div className="small" style={{ textAlign: 'right' }}>{Object.entries(chosen).map(([k, id]) => <div key={k}>{DOC_LABEL[k]}: {docs?.find((d) => d.id === id)?.name}</div>)}{!Object.keys(chosen).length && '—'}</div></div>
            <div className="list-item"><div className="grow muted small">Cover letter</div><div className="small">{cover ? `${cover.length} characters` : '—'}</div></div>
            {answers.availability && <div className="list-item"><div className="grow muted small">Availability</div><div className="small">{answers.availability}</div></div>}
          </div>
          {cover && <div className="card card-pad small pre" style={{ maxHeight: 200, overflow: 'auto' }}>{cover}</div>}
        </div>
      )}
      {step === 5 && (
        <Empty icon="checkCircle" title="Your application was sent!">
          {job.company?.display_name} will review it in their recruitment dashboard. You’ll be notified as it moves through each stage — track it under <Link to="/jobs?tab=applied">Jobs → Applied</Link>.
        </Empty>
      )}
    </Modal>
  );
}

export default function JobDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { me, can, industryName } = useSession();
  const act = useAction();
  const { data, loading, error, reload } = useApi(`/jobs/${id}${params.get('src') ? `?src=${params.get('src')}` : ''}`);
  const [applying, setApplying] = useState(false);
  const [reporting, setReporting] = useState(false);

  if (loading && !data) return <Spinner block />;
  if (error) return <main className="page page-narrow"><div className="card"><Empty icon="alert" title="Job not found">{error.message}</Empty></div></main>;
  const j = data.job;
  const app = data.application;
  const owner = me?.user.id === j.company?.id;

  const message = async () => {
    const r = await act(() => post('/messages/start', { user_id: j.company.id, context: { type: 'job', id: j.id, title: j.title } }));
    if (r) nav(`/messages/${r.conversation_id}`);
  };
  const withdraw = async () => {
    if (confirm('Withdraw your application?') && (await act(() => post(`/jobs/applications/${app.id}/withdraw`), 'Application withdrawn'))) reload();
  };

  return (
    <main className="page">
      <div className="layout-2">
        <div className="stack">
          <div className="card card-pad-lg stack">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <Link to={`/u/${j.company?.username}`}><Avatar user={j.company} size={64} square /></Link>
              <div className="grow">
                <h1>{j.title}</h1>
                <div className="row" style={{ gap: 4, marginTop: 4 }}><Link to={`/u/${j.company?.username}`} className="bold">{j.company?.display_name}</Link><Verified show={j.company?.verified} /></div>
                <div className="job-meta" style={{ marginTop: 8 }}>
                  <span><Icon name="mapPin" />{j.remote ? 'Remote' : [j.location_text, j.city].filter(Boolean).join(', ')}</span>
                  <span><Icon name="clock" />{label(j.employment_type)}</span>
                  <span><Icon name="cash" />{salary(j)}</span>
                  {j.department && <span><Icon name="layers" />{j.department}</span>}
                  <span><Icon name="users" />{j.positions} position{j.positions > 1 ? 's' : ''}</span>
                </div>
              </div>
            </div>
            <div className="row-wrap">
              {j.industry && <span className="chip">{industryName(j.industry)}</span>}
              <span className="chip">Posted {timeAgo(j.created_at)}</span>
              {j.deadline && <span className={`chip ${j.accepting ? 'chip-accent' : 'chip-danger'}`}><Icon name="calendar" />Deadline {dateLabel(j.deadline)}</span>}
              {!j.accepting && <span className="chip chip-danger">Not accepting applications</span>}
            </div>
            <div className="row-wrap">
              {can('apply_jobs') && !app && j.accepting && <button className="btn btn-primary btn-lg" onClick={() => setApplying(true)}><Icon name="send" />Apply</button>}
              {app && (
                <>
                  <span className={`chip ${app.stage === 'accepted' ? 'chip-success' : app.stage === 'rejected' || app.stage === 'withdrawn' ? 'chip-danger' : 'chip-info'}`} style={{ height: 38, padding: '0 14px' }}>
                    <Icon name="check" />Applied · {STAGE_LABEL[app.stage]}
                  </span>
                  {!['accepted', 'rejected', 'withdrawn'].includes(app.stage) && <button className="btn btn-ghost btn-sm" onClick={withdraw}>Withdraw</button>}
                </>
              )}
              {owner && <Link to={`/dashboard/recruitment/jobs/${j.id}`} className="btn btn-primary"><Icon name="users" />View applicants</Link>}
              {owner && <Link to={`/dashboard/jobs?edit=${j.id}`} className="btn btn-outline"><Icon name="edit" />Edit</Link>}
              {!owner && can('message') && <button className="btn btn-outline" onClick={message}><Icon name="message" />Message</button>}
              <SaveButton type="job" id={j.id} saved={j.saved} className="btn btn-outline btn-icon" />
              {!owner && <button className="btn btn-ghost btn-icon" onClick={() => setReporting(true)} aria-label="Report job"><Icon name="flag" /></button>}
            </div>
          </div>

          <div className="card card-pad-lg stack">
            <h2>About the role</h2>
            <p className="pre">{j.description}</p>
            {j.responsibilities && (
              <>
                <h3>Responsibilities</h3>
                <ul style={{ margin: 0, paddingLeft: 20 }}>{j.responsibilities.split('\n').filter(Boolean).map((r: string) => <li key={r}>{r.replace(/^[-•*]\s*/, '')}</li>)}</ul>
              </>
            )}
            <h3>Requirements</h3>
            <div className="grid-2">
              <div><div className="section-title">Education</div><div>{j.education_req === 'none' ? 'No minimum' : label(j.education_req)}{j.education_field ? ` in ${j.education_field}` : ''}</div></div>
              <div><div className="section-title">Experience</div><div>{j.experience_years ? `${j.experience_years}+ years` : 'Entry level welcome'}</div></div>
            </div>
            {j.skills.length > 0 && (
              <div>
                <div className="section-title" style={{ marginBottom: 6 }}>Skills</div>
                <div className="row-wrap">{j.skills.map((s: string) => <span key={s} className="chip chip-brand">{s}</span>)}</div>
              </div>
            )}
            <div>
              <div className="section-title" style={{ marginBottom: 6 }}>Documents required</div>
              <div className="row-wrap">{j.required_docs.map((d: string) => <span key={d} className="chip"><Icon name="file" />{DOC_LABEL[d] ?? d}</span>)}</div>
            </div>
            {j.additional && <div><div className="section-title">Additional requirements</div><p className="pre">{j.additional}</p></div>}
          </div>

          {data.similar.length > 0 && (
            <div className="stack-sm">
              <h3>Similar jobs</h3>
              {data.similar.map((s: Json) => <JobCard key={s.id} j={s} />)}
            </div>
          )}
        </div>

        <aside className="stack">
          {data.match && <MatchCard match={data.match} />}
          <div className="card card-pad stack-sm">
            <div className="row">
              <Avatar user={j.company} size={44} square />
              <div className="grow">
                <div className="bold row" style={{ gap: 4 }}>{j.company?.display_name}<Verified show={j.company?.verified} /></div>
                <div className="xsmall muted">{industryName(j.company?.category)} · {j.company?.city}</div>
              </div>
            </div>
            <Link to={`/u/${j.company?.username}`} className="btn btn-outline btn-sm">View company</Link>
          </div>
        </aside>
      </div>
      {applying && <ApplyWizard job={j} source={params.get('src') ?? 'direct'} onClose={() => setApplying(false)} onDone={reload} />}
      {reporting && <ReportDialog targetType="job" targetId={j.id} onClose={() => setReporting(false)} />}
    </main>
  );
}
