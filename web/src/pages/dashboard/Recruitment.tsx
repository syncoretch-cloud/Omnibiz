import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Icon } from '../../components/Icon.tsx';
import { Avatar, Empty, Field, MatchRing, Spinner, Textarea } from '../../components/ui.tsx';
import { BarList } from '../../components/Charts.tsx';
import { CvView } from '../Profile.tsx';
import { patch, post } from '../../lib/api.ts';
import type { Json } from '../../lib/api.ts';
import { useApi } from '../../lib/hooks.ts';
import { useAction } from '../../lib/session.tsx';
import { DOC_LABEL, STAGE_LABEL, label, parseTime, timeAgo } from '../../lib/format.ts';

const PIPELINE = ['applied', 'reviewing', 'shortlisted', 'interview', 'final_review', 'accepted', 'rejected'];

export function RecruitmentOverview() {
  const { data, loading } = useApi('/recruitment/overview');
  if (loading) return <Spinner block />;
  if (!data) return null;
  const open = data.jobs.filter((j: Json) => j.status === 'open');
  return (
    <div className="stack">
      <h2>Recruitment</h2>
      <div className="grid-4">
        {['applied', 'shortlisted', 'interview', 'accepted'].map((s) => (
          <div key={s} className="card kpi"><div className="label">{STAGE_LABEL[s]}</div><div className="value">{data.stages[s] ?? 0}</div></div>
        ))}
      </div>
      <div className="card">
        <div className="card-header"><h3>Open vacancies</h3><Link to="/dashboard/jobs?new=1" className="btn btn-primary btn-sm"><Icon name="plus" />Post a vacancy</Link></div>
        {open.length ? open.map((j: Json) => (
          <Link key={j.id} to={`/dashboard/recruitment/jobs/${j.id}`} className="list-item">
            <Icon name="briefcase" />
            <div className="grow"><div className="bold small">{j.title}</div><div className="xsmall muted">{j.applications} applicants · {j.view_count} views · posted {timeAgo(j.created_at)}</div></div>
            {j.new_applications > 0 && <span className="chip chip-accent">{j.new_applications} new</span>}
            <Icon name="chevronRight" size={16} />
          </Link>
        )) : <Empty icon="briefcase" title="No open vacancies" />}
      </div>
      <div className="card">
        <div className="card-header"><h3>Where applicants come from</h3></div>
        <div className="card-body"><BarList valueLabel="applications" rows={data.sources.map((s: Json) => ({ key: s.source, value: s.n, label: label(s.source) }))} /></div>
      </div>
    </div>
  );
}

export function Pipeline() {
  const { id } = useParams();
  const act = useAction();
  const { data, loading, reload } = useApi(`/recruitment/jobs/${id}/applications`);
  const [dragging, setDragging] = useState<number | null>(null);
  if (loading && !data) return <Spinner block />;
  if (!data) return <Empty title="Vacancy not found" />;
  const move = async (appId: number, stage: string) => {
    if (await act(() => patch(`/recruitment/applications/${appId}`, { stage }), `Moved to ${STAGE_LABEL[stage]}`)) reload();
  };
  return (
    <div className="stack">
      <div className="row-between">
        <div>
          <Link to="/dashboard/recruitment" className="small row" style={{ gap: 4 }}><Icon name="arrowLeft" size={14} />Recruitment</Link>
          <h2 style={{ marginTop: 4 }}>{data.job.title}</h2>
          <div className="small muted">{data.applications.length} applicants · sorted by match score · drag cards between stages</div>
        </div>
        <Link to={`/jobs/${data.job.id}`} className="btn btn-outline btn-sm">View vacancy</Link>
      </div>
      <div className="pipeline">
        {PIPELINE.map((stage) => {
          const apps = data.applications.filter((a: Json) => a.stage === stage);
          return (
            <div key={stage} className="pipeline-col" onDragOver={(e) => e.preventDefault()} onDrop={() => { if (dragging) move(dragging, stage); setDragging(null); }}>
              <h4><span>{STAGE_LABEL[stage]}</span><span>{apps.length}</span></h4>
              {apps.map((a: Json) => (
                <Link key={a.id} to={`/dashboard/recruitment/applications/${a.id}`} className="candidate-card" draggable onDragStart={() => setDragging(a.id)}>
                  <div className="row">
                    <Avatar user={a.applicant} size={32} />
                    <div className="grow"><div className="small bold truncate">{a.applicant?.display_name}</div><div className="xsmall muted truncate">{a.applicant?.headline ?? a.applicant?.city}</div></div>
                  </div>
                  <div className="row-between xsmall">
                    {a.match_score != null ? <span className={`chip ${a.match_score >= 75 ? 'chip-success' : a.match_score >= 50 ? 'chip-brand' : ''}`}>{a.match_score}% match</span> : <span />}
                    <span className="muted">{timeAgo(a.created_at)}</span>
                  </div>
                </Link>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Candidate() {
  const { id } = useParams();
  const act = useAction();
  const nav = useNavigate();
  const { data, loading, reload } = useApi(`/recruitment/applications/${id}`);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [notes, setNotes] = useState<string | null>(null);
  if (loading && !data) return <Spinner block />;
  if (!data) return <Empty title="Application not found" />;
  const a = data.application;
  const p = data.applicant;
  const m = data.match;

  const setStage = async (stage: string) => {
    if (await act(() => patch(`/recruitment/applications/${a.id}`, { stage, note: note || undefined, message: message || undefined }), `Moved to ${STAGE_LABEL[stage]} — candidate notified`)) {
      setNote(''); setMessage(''); reload();
    }
  };
  const chat = async () => {
    const r = await act(() => post('/messages/start', { user_id: p.id, context: { type: 'job', id: data.job.id, title: data.job.title } }));
    if (r) nav(`/messages/${r.conversation_id}`);
  };

  return (
    <div className="stack">
      <Link to={`/dashboard/recruitment/jobs/${data.job.id}`} className="small row" style={{ gap: 4 }}><Icon name="arrowLeft" size={14} />{data.job.title}</Link>
      <div className="card card-pad row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Avatar user={p} size={64} />
        <div className="grow">
          <h2>{p.full_name ?? p.display_name}</h2>
          <div className="muted">{p.headline}</div>
          <div className="small muted row-wrap" style={{ marginTop: 4 }}>
            {p.city && <span className="row" style={{ gap: 4 }}><Icon name="mapPin" size={14} />{p.city}</span>}
            <a href={`mailto:${p.email}`} className="row" style={{ gap: 4 }}><Icon name="mail" size={14} />{p.email}</a>
            {p.phone && <a href={`tel:${p.phone}`} className="row" style={{ gap: 4 }}><Icon name="phone" size={14} />{p.phone}</a>}
          </div>
          <div className="row-wrap" style={{ marginTop: 10 }}>
            <span className="chip chip-info">{STAGE_LABEL[a.stage]}</span>
            <span className="chip">Applied {timeAgo(a.created_at)} via {label(a.source)}</span>
            <Link to={`/u/${p.username}`} className="btn btn-ghost btn-sm">Full profile</Link>
            <button className="btn btn-outline btn-sm" onClick={chat}><Icon name="message" />Message</button>
          </div>
        </div>
        {m && <MatchRing score={m.score} />}
      </div>

      <div className="layout-2">
        <div className="stack">
          {m && (
            <div className="card card-pad stack-sm">
              <h3>CV vs. vacancy</h3>
              <div className="row-wrap">
                {m.matchedSkills.map((s: string) => <span key={s} className="chip chip-success"><Icon name="check" />{s}</span>)}
                {m.partialSkills.map((s: string) => <span key={s} className="chip chip-info">~ {s}</span>)}
                {m.missingSkills.map((s: string) => <span key={s} className="chip chip-danger"><Icon name="x" />{s}</span>)}
              </div>
              {m.strengths.length > 0 && <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{m.strengths.map((s: string) => <li key={s}>{s}</li>)}</ul>}
              {m.gaps.length > 0 && <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>{m.gaps.map((s: string) => <li key={s}>{s}</li>)}</ul>}
            </div>
          )}
          {a.cover_letter && <div className="card card-pad"><h3 style={{ marginBottom: 8 }}>Cover letter</h3><p className="pre small">{a.cover_letter}</p></div>}
          {Object.keys(a.answers).length > 0 && (
            <div className="card card-pad stack-sm small">
              <h3>Answers</h3>
              {Object.entries(a.answers).map(([k, v]) => <div key={k}><b>{label(k)}:</b> {String(v)}</div>)}
            </div>
          )}
          <div className="card">
            <div className="card-header"><h3>Attached documents</h3></div>
            {data.documents.length ? data.documents.map((d: Json) => (
              <a key={d.id} href={d.url} target="_blank" rel="noreferrer" className="list-item"><Icon name="file" /><div className="grow"><div className="small bold">{d.name}</div><div className="xsmall muted">{DOC_LABEL[d.kind]}</div></div><Icon name="eye" size={16} /></a>
            )) : <div className="card-body small muted">No documents attached.</div>}
          </div>
          {p.summary && <div className="card card-pad"><h3 style={{ marginBottom: 8 }}>Summary</h3><p className="pre small">{p.summary}</p></div>}
          <CvView cv={data.cv} />
        </div>
        <aside className="stack">
          <div className="card card-pad stack-sm">
            <h3>Move candidate</h3>
            <Field label="Message to candidate (optional)"><Textarea value={message} onChange={(e) => setMessage(e.target.value)} style={{ minHeight: 60 }} placeholder="e.g. Interview on Monday at 10:00" /></Field>
            <Field label="Internal note (optional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} style={{ minHeight: 50 }} /></Field>
            <div className="row-wrap">
              {PIPELINE.filter((s) => s !== a.stage && s !== 'applied').map((s) => (
                <button key={s} className={`btn btn-sm ${s === 'rejected' ? 'btn-outline' : s === 'accepted' ? 'btn-primary' : 'btn-brand-outline'}`} onClick={() => setStage(s)}>{STAGE_LABEL[s]}</button>
              ))}
            </div>
          </div>
          <div className="card card-pad stack-sm">
            <h3>Recruiter notes</h3>
            <Textarea value={notes ?? a.recruiter_notes ?? ''} onChange={(e) => setNotes(e.target.value)} placeholder="Private to your team" />
            <button className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} disabled={notes === null} onClick={async () => { if (await act(() => patch(`/recruitment/applications/${a.id}`, { recruiter_notes: notes }), 'Notes saved')) setNotes(null); }}>Save notes</button>
          </div>
          <div className="card card-pad">
            <h3 style={{ marginBottom: 10 }}>History</h3>
            <ul className="timeline">
              {data.events.map((e: Json, i: number) => <li key={i}><div className="small bold">{STAGE_LABEL[e.stage]}</div>{e.note && <div className="xsmall">{e.note}</div>}<div className="xsmall muted">{parseTime(e.created_at).toLocaleString()}</div></li>)}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
