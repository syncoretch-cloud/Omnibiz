import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Icon } from '../components/Icon.tsx';
import { Wordmark } from '../components/Layout.tsx';
import { Avatar, Spinner, Swap, Verified } from '../components/ui.tsx';
import { get, post, put } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { useAction, useSession } from '../lib/session.tsx';
import { ACCOUNT_LABEL } from '../lib/format.ts';

function FollowRow({ u }: { u: Json }) {
  const act = useAction();
  const { industryName } = useSession();
  const [on, setOn] = useState(false);
  return (
    <div className="rail-row">
      <Avatar user={u} size={46} />
      <div className="grow" style={{ lineHeight: 1.3 }}>
        <div className="bold small row" style={{ gap: 4 }}><span className="truncate">{u.display_name}</span><Verified show={u.verified} /></div>
        <div className="xsmall muted truncate">{u.category ? industryName(u.category) : ACCOUNT_LABEL[u.account_type]}{u.city ? ` · ${u.city}` : ''}</div>
      </div>
      <button className={`btn btn-sm${on ? '' : ' btn-primary'}`} disabled={on} onClick={async () => { if (await act(() => post(`/users/${u.id}/follow`))) setOn(true); }}>
        {on ? 'Following' : 'Follow'}
      </button>
    </div>
  );
}

export function Onboarding() {
  const { me, meta, setMe } = useSession();
  const nav = useNavigate();
  const [step, setStep] = useState<'interests' | 'follow'>('interests');
  const [chosen, setChosen] = useState<string[]>(me?.interests ?? []);
  const [suggestions, setSuggestions] = useState<Json[] | null>(null);
  const [busy, setBusy] = useState(false);
  const u = me!.user;

  useEffect(() => {
    if (step === 'follow') get('/users/suggestions?limit=6').then((r) => setSuggestions(r.users)).catch(() => setSuggestions([]));
  }, [step]);

  const saveInterests = async () => {
    setBusy(true);
    try {
      setMe(await put('/users/me/interests', { slugs: chosen }));
      setStep('follow');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card glass" style={{ width: 'min(640px, calc(100vw - 28px))' }}>
        <Wordmark />
        <div className="steps" style={{ marginBottom: 6 }}>
          <div className="step done" /><div className={`step ${step === 'follow' ? 'done' : ''}`} />
        </div>
        <Swap k={step} order={['interests', 'follow']}>
          {step === 'interests' ? (
            <div className="stack">
              <div className="center">
                <h2>Hi {u.display_name.split(' ')[0]} — what are you into?</h2>
                <p className="muted small" style={{ marginTop: 6 }}>Pick at least 3 to shape your feed, reels and job matches.</p>
              </div>
              <div className="choice-grid">
                {meta?.industries.filter((c) => c.slug !== 'other').map((c) => {
                  const on = chosen.includes(c.slug);
                  return (
                    <button key={c.slug} type="button" className={`choice${on ? ' selected' : ''}`} aria-pressed={on} onClick={() => setChosen((x) => (on ? x.filter((s) => s !== c.slug) : [...x, c.slug]))}>
                      <Icon name={on ? 'checkCircle' : 'plus'} />{c.name}
                    </button>
                  );
                })}
              </div>
              <button className="btn btn-primary btn-lg btn-block" disabled={chosen.length < 3 || busy} onClick={saveInterests}>Continue · {chosen.length} selected</button>
            </div>
          ) : (
            <div className="stack">
              <div className="center">
                <h2>Follow businesses you like</h2>
                <p className="muted small" style={{ marginTop: 6 }}>Their posts, products and offers will show up in your feed.</p>
              </div>
              {suggestions === null ? <Spinner block /> : <div className="stagger">{suggestions.map((s) => <FollowRow key={s.id} u={s} />)}</div>}
              <button className="btn btn-primary btn-lg btn-block" onClick={() => nav('/', { replace: true })}>Start exploring</button>
            </div>
          )}
        </Swap>
      </div>
    </div>
  );
}
