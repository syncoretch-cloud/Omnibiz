import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon.tsx';
import { Avatar, Empty, ErrorBox, Field, MatchRing, Modal, Spinner, Textarea, Verified } from '../components/ui.tsx';
import { JobCard, SaveButton } from '../components/Cards.tsx';
import { ReportDialog } from '../components/Report.tsx';
import { ApiError, del, get, post, put, uploadDocument } from '../lib/api.ts';
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

/**
 * Application flow (spec §14): requirements → your details → documents → review → send.
 * Any step can be skipped and the form saved to finish later (it is saved automatically on close);
 * only a complete application can be sent, and the employer sees nothing until then.
 */
function ApplyWizard({ job, draft, onClose, onChanged, source }: { job: Json; draft: Json | null; onClose: () => void; onChanged: () => void; source: string }) {
  const { me } = useSession();
  const toast = useToast();
  const [step, setStep] = useState<number>(draft?.step ?? 1);
  const [docs, setDocs] = useState<Json[] | null>(null);
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const [cover, setCover] = useState<string>(draft?.cover_letter ?? '');
  const [answers, setAnswers] = useState({ availability: draft?.answers?.availability ?? '', expected_salary: draft?.answers?.expected_salary ?? '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const required: string[] = job.required_docs;
  const docKinds = required.filter((k) => k !== 'cover_letter');
  const coverRequired = required.includes('cover_letter');

  useEffect(() => {
    get('/documents').then((r) => {
      setDocs(r.documents);
      // Reopen with the documents picked last time, otherwise the newest of each kind on file.
      const pre: Record<string, number> = {};
      const saved = new Set<number>(draft?.document_ids ?? []);
      for (const k of [...docKinds, 'cover_letter']) {
        const d = r.documents.find((x: Json) => x.kind === k && saved.has(x.id)) ?? (draft ? undefined : r.documents.find((x: Json) => x.kind === k));
        if (d) pre[k] = d.id;
      }
      setChosen(pre);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const edit = <T,>(set: (v: T) => void) => (v: T) => { set(v); setDirty(true); };
  const pick = edit(setChosen);
  // What is still missing, by the same rules the server applies when sending.
  const missing = required.filter((k) => (k === 'cover_letter' ? cover.trim().length < 50 && !chosen.cover_letter : k !== 'portfolio' && !chosen[k]));
  const stepFor = (k: string) => (k === 'cover_letter' ? 2 : 3);
  const payload = () => ({
    cover_letter: cover || undefined,
    answers: Object.fromEntries(Object.entries(answers).filter(([, v]) => v)),
    document_ids: [...new Set(Object.values(chosen))],
  });

  const upload = async (files: FileList | null) => {
    if (!files?.[0] || !uploadingKind) return;
    try {
      const d = await uploadDocument(files[0], uploadingKind, 'private');
      setDocs((x) => [d, ...(x ?? [])]);
      pick({ ...chosen, [uploadingKind]: d.id });
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setUploadingKind(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await put(`/jobs/${job.id}/draft`, { ...payload(), step: Math.min(step, 4) });
      setDirty(false);
      onChanged();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const saveAndLeave = async () => {
    if (await save()) {
      toast('Saved. Finish it anytime from your profile → Applications.', 'success');
      onClose();
    }
  };
  const close = async () => {
    if (dirty && !sent && (await save())) toast('Your application was saved as unfinished.', 'success');
    onClose();
  };
  const discard = async () => {
    if (!confirm('Discard this unfinished application?')) return;
    await del(`/jobs/${job.id}/draft`).catch(() => {});
    onChanged();
    onClose();
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await post(`/jobs/${job.id}/apply`, { ...payload(), source });
      setSent(true);
      setStep(5);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError && e.details?.missing ? `Still missing: ${e.details.missing.map((m) => DOC_LABEL[m] ?? m).join(', ')}` : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const titles = ['What you need', 'Your details', 'Documents', 'Review and send', 'Application sent'];
  const stepMissing = step === 2 ? missing.includes('cover_letter') : step === 3 ? missing.some((k) => k !== 'cover_letter') : false;
  const footer = step === 5 ? <button className="btn btn-primary" onClick={onClose}>Done</button> : (
    <>
      <button className="btn btn-ghost apply-later" onClick={saveAndLeave} disabled={busy}><Icon name="clock" />Save &amp; finish later</button>
      {step > 1 && <button className="btn btn-ghost" onClick={() => setStep(step - 1)}>Back</button>}
      {step < 4 && <button className="btn btn-primary" onClick={() => setStep(step + 1)}>{stepMissing ? 'Skip for now' : 'Next'}</button>}
      {step === 4 && <button className="btn btn-primary" disabled={busy || missing.length > 0} onClick={submit}><Icon name="send" />{busy ? 'Sending…' : 'Send to company'}</button>}
    </>
  );

  return (
    <Modal title={titles[step - 1]} onClose={close} footer={footer} large>
      {step < 5 && (
        <div className="apply-progress">
          <div className="steps">{[1, 2, 3, 4].map((s) => <div key={s} className={`step ${step >= s ? 'done' : ''}`} />)}</div>
          <span className="xsmall muted">Step {step} of 4{draft ? ' · continuing your saved application' : ''}</span>
        </div>
      )}
      {step === 1 && (
        <div className="stack">
          <p>To apply for <b>{job.title}</b> at <b>{job.company?.display_name}</b>, the employer asks for:</p>
          <div className="card">
            {required.map((k) => (
              <div key={k} className="list-item">
                <Icon name={k === 'cover_letter' ? 'edit' : 'file'} />
                <div className="grow">{DOC_LABEL[k] ?? k}</div>
                {missing.includes(k) ? <span className="chip">Still needed</span> : <span className="chip chip-success"><Icon name="check" />Ready</span>}
              </div>
            ))}
          </div>
          {job.additional && <div className="small"><b>Additional requirements:</b> <span className="pre">{job.additional}</span></div>}
          <div className="banner banner-info small"><Icon name="clock" /><span className="grow">Don't have everything yet? Skip what's missing and <b>save to finish later</b>. Nothing is sent to {job.company?.display_name} until you press <b>Send</b>.</span></div>
          <p className="xsmall muted">Your OmniBiz profile and CV (public and recruiter-visible sections) are shared with the employer when you send.</p>
        </div>
      )}
      {step === 2 && (
        <div className="stack">
          <div className="card card-pad row">
            <Avatar user={me?.user} size={44} />
            <div><div className="bold">{me?.user.display_name}</div><div className="small muted">{me?.user.email} · {me?.user.phone}</div></div>
          </div>
          <Field label={`Cover letter${coverRequired ? ' (required)' : ' (optional)'}`} hint={coverRequired ? 'At least 50 characters, or attach a cover letter document in the next step. You can also skip this and come back.' : 'Tell the employer why you are a great fit.'}>
            <Textarea value={cover} onChange={(e) => edit(setCover)(e.target.value)} maxLength={6000} style={{ minHeight: 160 }} />
          </Field>
          <div className="form-grid">
            <Field label="When can you start?"><input className="input" value={answers.availability} onChange={(e) => edit(setAnswers)({ ...answers, availability: e.target.value })} placeholder="e.g. Immediately, 1 month notice" /></Field>
            <Field label="Expected salary (optional)"><input className="input" value={answers.expected_salary} onChange={(e) => edit(setAnswers)({ ...answers, expected_salary: e.target.value })} placeholder="e.g. TZS 2,000,000 / month" /></Field>
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
                  <div className="bold">{DOC_LABEL[k] ?? k}{k === 'cover_letter' ? ' (not needed if you wrote one)' : k === 'portfolio' ? ' (or portfolio items on your CV)' : ''}</div>
                  <button className="btn btn-outline btn-sm" onClick={() => { setUploadingKind(k); fileRef.current?.click(); }} disabled={!!uploadingKind}>
                    <Icon name="upload" />{uploadingKind === k ? 'Uploading…' : 'Upload'}
                  </button>
                </div>
                {options.length ? options.map((d) => (
                  <label key={d.id} className="checkbox">
                    <input type="radio" name={`doc-${k}`} checked={chosen[k] === d.id} onChange={() => pick({ ...chosen, [k]: d.id })} />
                    <span className="grow">{d.name} <span className="xsmall muted">· {fileSize(d.size)} · {timeAgo(d.created_at)}</span></span>
                  </label>
                )) : <div className="small muted">No {DOC_LABEL[k]?.toLowerCase() ?? k} uploaded yet. You can skip this and add it later.</div>}
              </div>
            );
          })}
          <input ref={fileRef} type="file" hidden accept=".pdf,.doc,.docx,image/*" onChange={(e) => upload(e.target.files)} />
          <p className="xsmall muted">PDF, Word or image files up to 25 MB. Documents stay private: only employers you send applications to can open them.</p>
        </div>
      )}
      {step === 4 && (
        <div className="stack">
          <ErrorBox error={error} />
          <div className="card">
            {required.map((k) => (
              <div key={k} className="list-item">
                <span className={`apply-check${missing.includes(k) ? '' : ' ok'}`}><Icon name={missing.includes(k) ? 'x' : 'check'} /></span>
                <div className="grow">
                  <div className="small bold">{DOC_LABEL[k] ?? k}</div>
                  <div className="xsmall muted">{missing.includes(k) ? 'Still needed' : k === 'cover_letter' ? (cover.trim().length >= 50 ? `Written · ${cover.length} characters` : 'Attached') : docs?.find((d) => d.id === chosen[k])?.name ?? 'Ready'}</div>
                </div>
                {missing.includes(k) && <button className="btn btn-outline btn-sm" onClick={() => setStep(stepFor(k))}>Add</button>}
              </div>
            ))}
            {answers.availability && <div className="list-item"><span className="apply-check ok"><Icon name="check" /></span><div className="grow small">Can start: {answers.availability}</div></div>}
          </div>
          {missing.length > 0
            ? <div className="banner banner-warn small"><Icon name="alert" /><span className="grow">Add the missing {missing.length === 1 ? 'item' : 'items'} to send. Until then you can <b>save and finish later</b>.</span></div>
            : <div className="banner banner-info small"><Icon name="send" /><span className="grow">Everything is ready. <b>Send</b> delivers your application straight to {job.company?.display_name}.</span></div>}
          {draft && <button className="text-btn" style={{ alignSelf: 'flex-start', color: 'var(--danger)' }} onClick={discard}>Discard this application</button>}
        </div>
      )}
      {step === 5 && (
        <Empty icon="checkCircle" title="Sent to the company!">
          {job.company?.display_name} has received your application in their recruitment dashboard. You'll be notified as it moves through each stage. Track it on your profile under <Link to={`/u/${me?.user.username}?tab=applications`}>Applications</Link>.
        </Empty>
      )}
    </Modal>
  );
}

const STAGES = ['applied', 'reviewing', 'shortlisted', 'interview', 'final_review', 'accepted'];

/** The foot of a job page, after the requirements: start applying, continue a saved application, or follow a sent one. */
function ApplyPanel({ job, application, draft, onApply, onWithdraw, onDiscard }: { job: Json; application: Json | null; draft: Json | null; onApply: () => void; onWithdraw: () => void; onDiscard: () => void }) {
  if (application) {
    const idx = STAGES.indexOf(application.stage);
    const closed = ['accepted', 'rejected', 'withdrawn'].includes(application.stage);
    return (
      <div className="card card-pad-lg apply-panel" id="apply">
        <span className="eyebrow">Your application</span>
        <h3>{application.stage === 'accepted' ? 'Accepted. Congratulations!' : application.stage === 'rejected' ? 'Not selected this time' : application.stage === 'withdrawn' ? 'You withdrew this application' : `Sent ${timeAgo(application.created_at)} · waiting for a decision`}</h3>
        {idx >= 0 && (
          <>
            <div className="steps">{STAGES.map((s, i) => <div key={s} className={`step ${i <= idx ? 'done' : ''}`} title={STAGE_LABEL[s]} />)}</div>
            <div className="xsmall muted">Current stage: {STAGE_LABEL[application.stage]}</div>
          </>
        )}
        {!closed && <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={onWithdraw}>Withdraw application</button>}
      </div>
    );
  }
  if (!job.accepting) {
    return <div className="card card-pad-lg apply-panel"><span className="eyebrow">Applications</span><h3>This vacancy is no longer accepting applications</h3></div>;
  }
  if (draft) {
    return (
      <div className="card card-pad-lg apply-panel" id="apply">
        <span className="eyebrow">Unfinished application</span>
        <h3>You started applying {timeAgo(draft.updated_at)}</h3>
        <p className="small muted">
          {draft.missing.length
            ? <>Still needed: <b>{draft.missing.map((m: string) => DOC_LABEL[m] ?? m).join(', ')}</b>. Add them whenever you're ready, then send.</>
            : 'Everything is ready. Review it and send it to the company.'}
        </p>
        <div className="row-wrap">
          <button className="btn btn-primary btn-lg" onClick={onApply}><Icon name="edit" />Continue application</button>
          <button className="btn btn-ghost" onClick={onDiscard}>Discard</button>
        </div>
      </div>
    );
  }
  return (
    <div className="card card-pad-lg apply-panel" id="apply">
      <span className="eyebrow">Apply</span>
      <h3>Interested in this role?</h3>
      <p className="small muted">
        You'll go through {job.required_docs.length ? <>what the employer asks for (<b>{job.required_docs.map((d: string) => DOC_LABEL[d] ?? d).join(', ')}</b>)</> : 'a few short steps'}.
        {' '}Missing something? Skip it, save, and finish later. Nothing is sent until you press Send.
      </p>
      <button className="btn btn-primary btn-lg" style={{ alignSelf: 'flex-start' }} onClick={onApply}><Icon name="send" />Apply now</button>
    </div>
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
  const canApply = !!data && can('apply_jobs') && !data.application && data.job.accepting && me?.user.id !== data.job.company?.id;
  // Opened from "Continue" on the profile or Jobs page: go straight into the form.
  useEffect(() => {
    if (canApply && params.get('apply') === '1') setApplying(true);
  }, [canApply, params]);

  if (loading && !data) return <Spinner block />;
  if (error) return <main className="page page-narrow"><div className="card"><Empty icon="alert" title="Job not found">{error.message}</Empty></div></main>;
  const j = data.job;
  const app = data.application;
  const draft = data.draft;
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
            <div className="grid-2" style={{ ['--min' as string]: '180px' }}>
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

          {can('apply_jobs') && !owner && <ApplyPanel job={j} application={app} draft={draft} onApply={() => setApplying(true)} onWithdraw={withdraw} onDiscard={async () => { if (confirm('Discard this unfinished application?') && (await act(() => del(`/jobs/${j.id}/draft`), 'Unfinished application discarded'))) reload(); }} />}

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
      {applying && <ApplyWizard job={j} draft={draft} source={params.get('src') ?? 'direct'} onClose={() => setApplying(false)} onChanged={reload} />}
      {reporting && <ReportDialog targetType="job" targetId={j.id} onClose={() => setReporting(false)} />}
    </main>
  );
}
