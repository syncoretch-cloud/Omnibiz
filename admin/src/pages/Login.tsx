import { useState } from 'react';
import { Field, Input } from '@web/components/ui.tsx';
import { post } from '@web/lib/api.ts';
import type { Json } from '@web/lib/api.ts';
import { useSession } from '@web/lib/session.tsx';

/** Staff sign-in. Uses the same accounts and API as the app; the shell then checks the account has a staff role. */
export function Login() {
  const { setMe } = useSession();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r: Json = challenge
        ? await post('/auth/login/2fa', { challenge, code })
        : await post('/auth/login', { identifier: identifier.trim(), password });
      if (r.twofa_required) setChallenge(r.challenge);
      else setMe(r);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="admin-login">
      <form className="card card-pad stack" onSubmit={submit}>
        <div>
          <img src="/brand/omnibiz-mark.png" alt="" width={40} height={40} />
          <h1 className="admin-login-title">OmniBiz Manager</h1>
          <p className="small muted">Sign in with your staff account.</p>
        </div>
        {challenge ? (
          <Field label="Authenticator code" hint="From your authenticator app."><Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" autoFocus /></Field>
        ) : (
          <>
            <Field label="Email, phone or username"><Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" autoFocus /></Field>
            <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
          </>
        )}
        {error && <p className="small" style={{ color: 'var(--danger)' }} role="alert">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Signing in…' : challenge ? 'Verify' : 'Sign in'}</button>
      </form>
    </main>
  );
}
