import { Link } from 'react-router';
import { Icon } from './Icon.tsx';
import { Avatar, Empty, Spinner } from './ui.tsx';
import { del } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { useApi } from '../lib/hooks.ts';
import { useAction } from '../lib/session.tsx';
import { DOC_LABEL, STAGE_LABEL, timeAgo } from '../lib/format.ts';

const STAGES = ['applied', 'reviewing', 'shortlisted', 'interview', 'final_review', 'accepted'];
const CLOSED = ['accepted', 'rejected', 'withdrawn'];

function SentRow({ application: a, job: j }: { application: Json; job: Json }) {
  const idx = STAGES.indexOf(a.stage);
  return (
    <Link to={`/jobs/${j.id}`} className="card card-link card-pad stack-sm">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Avatar user={j.company} size={44} square />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="bold">{j.title}</div>
          <div className="small muted">{j.company?.display_name} · sent {timeAgo(a.created_at)}</div>
        </div>
        <span className={`chip ${a.stage === 'accepted' ? 'chip-success' : a.stage === 'rejected' || a.stage === 'withdrawn' ? 'chip-danger' : 'chip-info'}`}>{STAGE_LABEL[a.stage]}</span>
      </div>
      {idx >= 0 && (
        <>
          <div className="steps">{STAGES.map((s, i) => <div key={s} className={`step ${i <= idx ? 'done' : ''}`} title={STAGE_LABEL[s]} />)}</div>
          <div className="xsmall muted">Stage {idx + 1} of {STAGES.length} · updated {timeAgo(a.updated_at)}</div>
        </>
      )}
    </Link>
  );
}

/** Unfinished application forms, applications waiting for a decision, and decided ones. */
export function ApplicationsOverview() {
  const act = useAction();
  const drafts = useApi('/jobs/drafts');
  const applied = useApi('/jobs/applied');
  if ((drafts.loading && !drafts.data) || (applied.loading && !applied.data)) return <Spinner block />;
  const unfinished: Json[] = drafts.data?.items ?? [];
  const sent: Json[] = applied.data?.items ?? [];
  const waiting = sent.filter((x) => !CLOSED.includes(x.application.stage));
  const decided = sent.filter((x) => CLOSED.includes(x.application.stage));
  const discard = async (jobId: number) => {
    if (confirm('Discard this unfinished application?') && (await act(() => del(`/jobs/${jobId}/draft`), 'Unfinished application discarded'))) drafts.reload();
  };

  if (!unfinished.length && !sent.length) {
    return <div className="card"><Empty icon="send" title="No applications yet">When you apply for a job, your saved and sent applications appear here. <Link to="/jobs">Find jobs</Link></Empty></div>;
  }
  return (
    <div className="stack-lg">
      <section className="stack-sm">
        <h3 className="apps-head"><Icon name="edit" />Unfinished <span className="apps-count">{unfinished.length}</span></h3>
        {unfinished.length ? unfinished.map(({ draft: d, job: j }) => (
          <div key={d.id} className="card card-pad stack-sm app-draft">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <Avatar user={j.company} size={44} square />
              <div className="grow" style={{ minWidth: 0 }}>
                <Link to={`/jobs/${j.id}`} className="bold" style={{ color: 'var(--text)' }}>{j.title}</Link>
                <div className="small muted">{j.company?.display_name} · saved {timeAgo(d.updated_at)}</div>
              </div>
              <span className={`chip ${d.missing.length ? 'chip-accent' : 'chip-success'}`}>{d.missing.length ? `${d.missing.length} to add` : 'Ready to send'}</span>
            </div>
            <div className="steps">{[1, 2, 3, 4].map((s) => <div key={s} className={`step ${d.step >= s ? 'done' : ''}`} />)}</div>
            <div className="xsmall muted">
              {d.missing.length ? <>Still needed: {d.missing.map((m: string) => DOC_LABEL[m] ?? m).join(', ')}</> : 'Everything is in place. Review it and send it.'}
              {!j.accepting && <b style={{ color: 'var(--danger)' }}> · This vacancy has closed.</b>}
            </div>
            <div className="row-wrap">
              {j.accepting && <Link to={`/jobs/${j.id}?apply=1`} className="btn btn-primary btn-sm"><Icon name="edit" />Continue</Link>}
              <button className="btn btn-ghost btn-sm" onClick={() => discard(j.id)}>Discard</button>
            </div>
          </div>
        )) : <p className="small muted">No unfinished applications. If you start one and stop, it's saved here.</p>}
      </section>

      <section className="stack-sm">
        <h3 className="apps-head"><Icon name="clock" />Waiting for a decision <span className="apps-count">{waiting.length}</span></h3>
        {waiting.length ? waiting.map((x) => <SentRow key={x.application.id} {...x} />) : <p className="small muted">Nothing waiting right now.</p>}
      </section>

      {decided.length > 0 && (
        <section className="stack-sm">
          <h3 className="apps-head"><Icon name="checkCircle" />Decided <span className="apps-count">{decided.length}</span></h3>
          {decided.map((x) => <SentRow key={x.application.id} {...x} />)}
        </section>
      )}
    </div>
  );
}
