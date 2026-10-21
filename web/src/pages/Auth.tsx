import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon.tsx';
import { ErrorBox, Input, Select, Swap } from '../components/ui.tsx';
import { Wordmark } from '../components/Layout.tsx';
import { ApiError, get, post } from '../lib/api.ts';
import { isBusinessType, useSession, useToast } from '../lib/session.tsx';
import { useDebounced } from '../lib/hooks.ts';

export function DevOutboxHint() {
  if (!import.meta.env.DEV) return null;
  return (
    <div className="dev-box">
      Codes aren’t emailed in development — find them at <a href="/api/dev/outbox" target="_blank" rel="noreferrer">/api/dev/outbox</a>.
    </div>
  );
}

function LoginPanel() {
  const { setMe } = useSession();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const done = (me: unknown) => {
    setMe(me as never);
    const next = params.get('next');
    nav(next && next.startsWith('/') ? next : '/', { replace: true });
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (challenge) done(await post('/auth/login/2fa', { challenge, code }));
      else {
        const r = await post('/auth/login', { identifier, password, remember });
        if (r.twofa_required) setChallenge(r.challenge);
        else done(r);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="auth-card glass">
        <Wordmark />
        <Swap k={challenge ? 'otp' : 'login'} order={['login', 'otp']}>
          {challenge ? (
            <form onSubmit={submit} className="stack-sm">
              <p className="center small muted" style={{ marginBottom: 6 }}>Enter the 6-digit code from your authenticator app.</p>
              <Input className="otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus aria-label="Authentication code" />
              <ErrorBox error={error} />
              <button className="btn btn-primary btn-lg btn-block" disabled={busy || code.length !== 6}>Confirm</button>
              <button type="button" className="text-btn" style={{ alignSelf: 'center', marginTop: 4 }} onClick={() => { setChallenge(null); setCode(''); }}>Back</button>
            </form>
          ) : (
            <form onSubmit={submit} className="stack-sm">
              <Input placeholder="Phone number, username, or email" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" aria-label="Phone number, username, or email" />
              <div className="pw-wrap">
                <Input type={show ? 'text' : 'password'} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" aria-label="Password" />
                {password && <button type="button" className="text-btn" onClick={() => setShow((s) => !s)}>{show ? 'Hide' : 'Show'}</button>}
              </div>
              <label className="checkbox small" style={{ margin: '4px 2px 0', color: 'var(--text-2)' }}>
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Keep me logged in
              </label>
              <button className="btn btn-primary btn-lg btn-block" style={{ marginTop: 6 }} disabled={busy || !identifier || !password}>{busy ? 'Logging in…' : 'Log in'}</button>
              <ErrorBox error={error} />
              <div className="or">OR</div>
              <Link to="/recover" className="center small bold">Forgot password?</Link>
            </form>
          )}
        </Swap>
      </div>
      <div className="auth-alt glass">Don’t have an account? <Link to="/register" className="bold">Sign up</Link></div>
    </>
  );
}

const TYPES = [
  { id: 'personal', icon: 'user', title: 'Personal', tag: 'Find work · build your CV' },
  { id: 'company', icon: 'building', title: 'Company', tag: 'Hire · sell · post' },
  { id: 'wholesaler', icon: 'truck', title: 'Wholesaler', tag: 'Sell in bulk' },
  { id: 'retailer', icon: 'store', title: 'Retailer', tag: 'Sell to customers' },
  { id: 'customer', icon: 'cart', title: 'Customer', tag: 'Shop & discover' },
];

function RegisterPanel() {
  const { meta, setMe } = useSession();
  const nav = useNavigate();
  const [step, setStep] = useState<'type' | 'details'>('type');
  const [type, setType] = useState('');
  const [f, setF] = useState<Record<string, string>>({ country: 'Tanzania' });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const biz = isBusinessType(type);
  const dUser = useDebounced(f.username ?? '', 350);

  useEffect(() => {
    if (dUser.length < 3) {
      setAvailable(null);
      return;
    }
    get(`/auth/username-available?username=${encodeURIComponent(dUser)}`).then((r) => setAvailable(r.available)).catch(() => setAvailable(null));
  }, [dUser]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      setMe(await post('/auth/register', { ...f, account_type: type }));
      nav('/welcome', { replace: true });
    } catch (err) {
      setError((err as Error).message);
      if (err instanceof ApiError && err.details?.fields) setFieldErrors(err.details.fields);
    } finally {
      setBusy(false);
    }
  };
  const bad = (k: string) => (fieldErrors[k] ? 'invalid' : '');

  return (
    <>
      <div className="auth-card glass">
        <Wordmark />
        <Swap k={step} order={['type', 'details']}>
          {step === 'type' ? (
            <div className="stack-sm">
              {TYPES.map((t) => (
                <button key={t.id} type="button" className={`account-type${type === t.id ? ' selected' : ''}`} onClick={() => setType(t.id)} aria-pressed={type === t.id}>
                  <span className="icon-wrap"><Icon name={t.icon} /></span>
                  <span className="grow">
                    <span className="bold" style={{ display: 'block' }}>{t.title}</span>
                    <span className="xsmall muted">{t.tag}</span>
                  </span>
                  {type === t.id && <Icon name="checkCircle" size={20} />}
                </button>
              ))}
              <button className="btn btn-primary btn-lg btn-block" style={{ marginTop: 6 }} disabled={!type} onClick={() => setStep('details')}>Next</button>
            </div>
          ) : (
            <form className="stack-sm" onSubmit={submit}>
              <button type="button" className="text-btn row" style={{ alignSelf: 'flex-start', gap: 4, color: 'var(--muted)' }} onClick={() => setStep('type')}>
                <Icon name="arrowLeft" size={14} />{TYPES.find((t) => t.id === type)?.title}
              </button>
              {biz ? (
                <>
                  <Input className={bad('business_name')} placeholder="Business name" value={f.business_name ?? ''} onChange={set('business_name')} required maxLength={120} />
                  <Select className={bad('category')} value={f.category ?? ''} onChange={set('category')} required placeholder="Business category" options={(meta?.industries ?? []).map((c) => ({ value: c.slug, label: c.name }))} />
                  {f.category === 'other' && <Input placeholder="Describe your category" value={f.custom_category ?? ''} onChange={set('custom_category')} maxLength={60} />}
                </>
              ) : (
                <Input className={bad('full_name')} placeholder="Full name" value={f.full_name ?? ''} onChange={set('full_name')} required autoComplete="name" maxLength={100} />
              )}
              <div className="pw-wrap">
                <Input className={bad('username') || (available === false ? 'invalid' : '')} placeholder="Username" value={f.username ?? ''} onChange={set('username')} required autoComplete="username" pattern="[a-zA-Z0-9_.]{3,30}" />
                {available != null && <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: available ? 'var(--success)' : 'var(--danger)' }}><Icon name={available ? 'checkCircle' : 'alert'} size={18} /></span>}
              </div>
              <Input className={bad('phone')} type="tel" placeholder="Phone number (+255…)" value={f.phone ?? ''} onChange={set('phone')} required autoComplete="tel" />
              <Input className={bad('email')} type="email" placeholder="Email address" value={f.email ?? ''} onChange={set('email')} required autoComplete="email" />
              <Input className={bad('password')} type="password" placeholder="Password (8+ letters & numbers)" value={f.password ?? ''} onChange={set('password')} required autoComplete="new-password" minLength={8} />
              <Input placeholder="City (e.g. Arusha)" value={f.city ?? ''} onChange={set('city')} list="city-list" />
              <datalist id="city-list">{meta?.cities.map((c) => <option key={c.name} value={c.name} />)}</datalist>
              <ErrorBox error={error} />
              <button className="btn btn-primary btn-lg btn-block" style={{ marginTop: 6 }} disabled={busy}>{busy ? 'Creating…' : 'Sign up'}</button>
              <p className="xsmall muted center" style={{ marginTop: 4 }}>By signing up you agree to our Terms and Privacy Policy.</p>
            </form>
          )}
        </Swap>
      </div>
      <div className="auth-alt glass">Have an account? <Link to="/login" className="bold">Log in</Link></div>
    </>
  );
}

function RecoverPanel() {
  const nav = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState<1 | 2>(1);
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (step === 1) {
        await post('/auth/recover/request', { identifier });
        setStep(2);
      } else {
        await post('/auth/recover/reset', { identifier, code, password });
        toast('Password updated — log in with your new password', 'success');
        nav('/login');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="auth-card glass">
        <div className="center" style={{ display: 'grid', placeItems: 'center', gap: 10, marginBottom: 6 }}>
          <span className="notif-icon" style={{ width: 76, height: 76 }}><Icon name="lock" size={32} /></span>
          <h2>Trouble logging in?</h2>
        </div>
        <form className="stack-sm" onSubmit={submit}>
          {step === 1 ? (
            <Input placeholder="Email, phone, or username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required autoFocus />
          ) : (
            <>
              <Input className="otp-input" placeholder="000000" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus aria-label="Reset code" />
              <Input type="password" placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
            </>
          )}
          <ErrorBox error={error} />
          <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{step === 1 ? 'Send reset code' : 'Reset password'}</button>
          <DevOutboxHint />
          <div className="or">OR</div>
          <Link to="/register" className="center small bold">Create new account</Link>
        </form>
      </div>
      <div className="auth-alt glass"><Link to="/login" className="bold">Back to login</Link></div>
    </>
  );
}

export function AuthShell({ mode }: { mode: 'login' | 'register' | 'recover' }) {
  return (
    <div className="auth-shell">
      <div className="auth-grid">
        <Swap k={mode} order={['login', 'register', 'recover']} className="auth-col">
          {mode === 'login' ? <LoginPanel /> : mode === 'register' ? <RegisterPanel /> : <RecoverPanel />}
        </Swap>
      </div>
      <div className="auth-foot">© 2026 OMNIBIZ</div>
    </div>
  );
}
