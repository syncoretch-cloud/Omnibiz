import { useState } from 'react';
import { Icon } from '../components/Icon.tsx';
import { Textarea } from '../components/ui.tsx';
import { post } from '../lib/api.ts';
import { useApi } from '../lib/hooks.ts';
import { useAction, useSession } from '../lib/session.tsx';
import { label, parseTime } from '../lib/format.ts';

/** Shown instead of the app while an account is suspended: why, until when, and a way to appeal. */
export default function Suspended() {
  const { me, logout } = useSession();
  const act = useAction();
  const u = me!.user;
  const appeals = useApi('/appeals');
  const [message, setMessage] = useState('');
  const pending = appeals.data?.items.find((a: { status: string }) => a.status === 'pending');
  const last = appeals.data?.items[0];
  return (
    <main className="page page-narrow" style={{ paddingTop: 40 }}>
      <div className="card card-pad stack">
        <div className="center" style={{ display: 'grid', placeItems: 'center', gap: 8 }}>
          <span className="notif-icon" style={{ width: 72, height: 72 }}><Icon name="lock" size={30} /></span>
          <h2>Your account is suspended</h2>
          <p className="small muted">
            {u.suspended_until ? <>It will be restored automatically on <b>{parseTime(u.suspended_until).toLocaleDateString()}</b>.</> : 'It stays suspended until our team restores it.'}
          </p>
        </div>
        <div className="card card-pad small" style={{ background: 'var(--surface-2)' }}>
          <div className="section-title">Reason</div>
          {u.suspended_reason || 'Not provided.'}
        </div>
        {pending ? (
          <div className="card card-pad small stack-sm">
            <b>Your appeal is waiting for review</b>
            <div className="muted">“{pending.message}”</div>
            <div className="xsmall muted">You will get an email when it is decided.</div>
          </div>
        ) : (
          <div className="stack-sm">
            {last && last.status !== 'pending' && <div className="small muted">Your last appeal was <b>{label(last.status)}</b>{last.response ? `: ${last.response}` : '.'}</div>}
            <h3>Think this is a mistake?</h3>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Tell us what happened (at least 20 characters)" style={{ minHeight: 100 }} />
            <button className="btn btn-primary" disabled={message.trim().length < 20} onClick={async () => { if (await act(() => post('/appeals', { message }), 'Appeal sent')) { setMessage(''); appeals.reload(); } }}>Send appeal</button>
          </div>
        )}
        <button className="btn btn-outline" onClick={logout}><Icon name="logout" />Log out</button>
      </div>
    </main>
  );
}
