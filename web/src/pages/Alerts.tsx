import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../components/Icon.tsx';
import { Empty, Spinner } from '../components/ui.tsx';
import { del, qs } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { useApi } from '../lib/hooks.ts';
import { disablePush, enablePush, pushEnabled, pushSupported } from '../lib/push.ts';
import { useAction } from '../lib/session.tsx';
import { label } from '../lib/format.ts';

function PushToggle() {
  const act = useAction();
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { pushEnabled().then(setOn); }, []);
  if (!pushSupported()) return <p className="small muted">This browser does not support push notifications. On an iPhone, add OmniBiz to your Home Screen first.</p>;
  return (
    <div className="row-between">
      <div>
        <b className="small">Notifications on this device</b>
        <div className="xsmall muted">Get messages, orders and job matches even when OmniBiz is closed.</div>
      </div>
      <button
        className={`btn btn-sm ${on ? 'btn-outline' : 'btn-primary'}`}
        disabled={on === null}
        onClick={async () => {
          if (on) { await disablePush(); setOn(false); return; }
          if (await act(() => enablePush(), 'Notifications are on')) setOn(true);
        }}
      >
        {on ? 'Turn off' : 'Turn on'}
      </button>
    </div>
  );
}

/** Settings → Alerts: push notifications for this device, and the searches that tell you about new matches. */
export function Alerts() {
  const act = useAction();
  const { data, loading, reload } = useApi('/saved-searches');
  return (
    <div className="stack">
      <div className="card card-pad stack-sm"><h3>Push notifications</h3><PushToggle /></div>
      <div className="card card-pad stack-sm">
        <h3>Saved searches</h3>
        <p className="small muted">Search the marketplace or jobs, then choose “Alert me about new ones”. You will be notified when something new matches.</p>
        {loading && !data ? <Spinner /> : !data?.items.length ? <Empty icon="bell" title="No saved searches yet" /> : data.items.map((s: Json) => (
          <div key={s.id} className="list-item">
            <div className="grow">
              <Link to={`${s.kind === 'job' ? '/jobs' : '/marketplace'}${qs(s.params)}`} className="bold small">{s.label}</Link>
              <div className="xsmall muted">{label(s.kind === 'job' ? 'jobs' : 'marketplace')} · {Object.entries(s.params).map(([k, v]) => `${label(k)}: ${v}`).join(' · ')}</div>
            </div>
            <button className="icon-btn" aria-label="Delete saved search" onClick={async () => { if (await act(() => del(`/saved-searches/${s.id}`), 'Removed')) reload(); }}><Icon name="trash" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
