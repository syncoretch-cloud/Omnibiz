import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router';
import QRCode from 'qrcode';
import { Icon } from '../components/Icon.tsx';
import { Empty, ErrorBox, Field, Input, Modal, PageTitle, Select, Spinner, TagInput, Textarea, SectionSwap } from '../components/ui.tsx';
import { MapView } from '../components/MapView.tsx';
import { DevOutboxHint } from './Auth.tsx';
import { get, patch, post, put, uploadDocument, uploadMedia, del } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { useApi } from '../lib/hooks.ts';
import { isBusinessType, useAction, useSession, useToast } from '../lib/session.tsx';
import { label, parseTime, timeAgo } from '../lib/format.ts';

function ImageUpload({ value, onChange, round, text }: { value?: string | null; onChange: (url: string) => void; round?: boolean; text: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const act = useAction();
  const [busy, setBusy] = useState(false);
  return (
    <div className="row">
      <div style={{ width: round ? 72 : 160, height: 72, borderRadius: round ? '50%' : 10, overflow: 'hidden', background: 'var(--surface-2)', flexShrink: 0 }}>
        {value && <img src={value} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      </div>
      <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => ref.current?.click()}><Icon name="upload" />{busy ? 'Uploading…' : text}</button>
      <input ref={ref} type="file" accept="image/*" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        setBusy(true);
        const urls = await act(() => uploadMedia([f]));
        setBusy(false);
        if (urls) onChange(urls[0]);
      }} />
    </div>
  );
}

function Account() {
  const { me, meta, setMe } = useSession();
  const act = useAction();
  const u = me!.user;
  const biz = isBusinessType(u.account_type);
  const [f, setF] = useState<Json>({ display_name: u.display_name, bio: u.bio ?? '', email: u.email, phone: u.phone ?? '', country: u.country ?? '', region: u.region ?? '', city: u.city ?? '', avatar_url: u.avatar_url, cover_url: u.cover_url, share_precise_location: u.share_precise_location });
  const save = async () => {
    const r = await act(() => patch('/users/me', f), 'Saved');
    if (r) setMe(r);
  };
  const useMyLocation = () => {
    navigator.geolocation?.getCurrentPosition(async (pos) => {
      const r = await act(() => patch('/users/me', { lat: pos.coords.latitude, lng: pos.coords.longitude }), f.share_precise_location || biz ? 'Location updated' : 'Approximate location saved');
      if (r) setMe(r);
    });
  };
  return (
    <div className="stack">
      <div className="card card-pad stack">
        <h3>Profile</h3>
        <Field label={biz ? 'Logo' : 'Profile picture'}><ImageUpload value={f.avatar_url} round={!biz} text="Change" onChange={(url) => setF({ ...f, avatar_url: url })} /></Field>
        <Field label="Cover image"><ImageUpload value={f.cover_url} text="Change cover" onChange={(url) => setF({ ...f, cover_url: url })} /></Field>
        <div className="form-grid">
          <Field label={biz ? 'Business name' : 'Display name'}><Input value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></Field>
          <Field label="Username"><Input value={u.username} disabled /></Field>
          <Field label="Bio" className="span-2"><Textarea value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} maxLength={1000} style={{ minHeight: 70 }} /></Field>
          <Field label="Email" hint={me?.features?.contact_verification ? (u.email_verified ? '✓ Verified' : 'Not verified') : undefined}><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Phone" hint={me?.features?.contact_verification ? (u.phone_verified ? '✓ Verified' : 'Not verified') : undefined}><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        </div>
      </div>
      <div className="card card-pad stack">
        <h3>Location & privacy</h3>
        <div className="form-grid">
          <Field label="Country"><Input value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} /></Field>
          <Field label="Region"><Input value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} /></Field>
          <Field label="City / town">
            <Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} list="settings-cities" />
            <datalist id="settings-cities">{meta?.cities.map((c) => <option key={c.name} value={c.name} />)}</datalist>
          </Field>
          <div className="field" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn btn-outline" onClick={useMyLocation}><Icon name="target" />Use my current location</button></div>
        </div>
        {!biz && (
          <label className="checkbox">
            <input type="checkbox" checked={f.share_precise_location} onChange={(e) => setF({ ...f, share_precise_location: e.target.checked })} />
            <span>Use my <b>precise</b> location for “near me” results. When off, OmniBiz only stores an approximate (~1 km) location.</span>
          </label>
        )}
      </div>
      <div className="form-actions"><button className="btn btn-primary" onClick={save}>Save changes</button></div>
    </div>
  );
}

function Interests() {
  const { me, meta, setMe } = useSession();
  const act = useAction();
  const [chosen, setChosen] = useState<string[]>(me!.interests);
  return (
    <div className="card card-pad stack">
      <div><h3>Interests</h3><p className="small muted">These shape your feed, job matches, recommendations and which announcements reach you.</p></div>
      <div className="choice-grid">
        {meta?.industries.map((c) => {
          const on = chosen.includes(c.slug);
          return <button key={c.slug} className={`choice${on ? ' selected' : ''}`} onClick={() => setChosen((x) => (on ? x.filter((s) => s !== c.slug) : [...x, c.slug]))}><Icon name={on ? 'checkCircle' : 'plus'} />{c.name}</button>;
        })}
      </div>
      <div className="form-actions"><button className="btn btn-primary" onClick={async () => { const r = await act(() => put('/users/me/interests', { slugs: chosen }), 'Interests saved'); if (r) setMe(r); }}>Save interests</button></div>
    </div>
  );
}

function BusinessSettings() {
  const { me, meta, setMe } = useSession();
  const act = useAction();
  const b = me!.business!;
  const u = me!.user;
  const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v || '[]') : v ?? []);
  const [f, setF] = useState<Json>({
    name: b.name, category: b.category, custom_category: b.custom_category ?? '', description: b.description ?? '', website: b.website ?? '',
    services: parse(b.services), product_lines: parse(b.product_lines), wholesale_categories: parse(b.wholesale_categories), portfolio_links: parse(b.portfolio_links),
    address: b.address ?? '', contact_email: b.contact_email ?? '', contact_phone: b.contact_phone ?? '', employee_count: b.employee_count ?? '',
    founded_year: b.founded_year ?? '', opening_hours: b.opening_hours ?? '', registration_number: '',
  });
  const [loc, setLoc] = useState<[number, number] | null>(u.lat != null ? [u.lat, u.lng] : null);
  const center: [number, number] = loc ?? (() => { const c = meta?.cities.find((x) => x.name === u.city); return c ? [c.lat, c.lng] as [number, number] : [-6.7924, 39.2083] as [number, number]; })();
  const { data: ver, reload } = useApi('/businesses/me/verification');
  const [verifying, setVerifying] = useState(false);

  const save = async () => {
    const body = { ...f, founded_year: f.founded_year === '' ? null : Number(f.founded_year) };
    if (!body.registration_number) delete body.registration_number;
    const r = await act(() => patch('/businesses/me', body), 'Business profile saved');
    if (r) setMe(r);
  };
  const saveLocation = async () => {
    if (!loc) return;
    const r = await act(() => patch('/users/me', { lat: loc[0], lng: loc[1] }), 'Map location saved');
    if (r) setMe(r);
  };
  const latest = ver?.requests?.[0];

  return (
    <div className="stack">
      <div className="card card-pad stack-sm">
        <div className="row-between">
          <div className="row"><Icon name={b.verified ? 'shieldCheck' : 'shield'} /><h3>Verification</h3></div>
          <span className={`chip ${b.verified ? 'chip-success' : b.verification_status === 'pending' ? 'chip-accent' : b.verification_status === 'rejected' ? 'chip-danger' : ''}`}>{b.verified ? 'Verified business' : label(b.verification_status === 'none' ? 'not verified' : b.verification_status)}</span>
        </div>
        <p className="small muted">Verified businesses get a badge, rank higher in search and earn more trust. Requirements: business registration documents (BRELA certificate, TIN, licence).</p>
        {latest?.status === 'rejected' && latest.review_notes && <div className="banner banner-danger small"><Icon name="alert" />Reviewer note: {latest.review_notes}</div>}
        {!b.verified && b.verification_status !== 'pending' && <button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setVerifying(true)}><Icon name="shieldCheck" />Request verification</button>}
      </div>
      <div className="card card-pad stack">
        <h3>Business details</h3>
        <div className="form-grid">
          <Field label="Business name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} options={(meta?.industries ?? []).map((c) => ({ value: c.slug, label: c.name }))} /></Field>
          {f.category === 'other' && <Field label="Custom category" className="span-2"><Input value={f.custom_category} onChange={(e) => setF({ ...f, custom_category: e.target.value })} /></Field>}
          <Field label="Description" className="span-2"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={4000} /></Field>
          <Field label="Services offered" className="span-2"><TagInput value={f.services} onChange={(v) => setF({ ...f, services: v })} placeholder="Type a service and press Enter" /></Field>
          <Field label={u.account_type === 'wholesaler' ? 'Wholesale categories' : 'Product lines'} className="span-2">
            <TagInput value={u.account_type === 'wholesaler' ? f.wholesale_categories : f.product_lines} onChange={(v) => setF(u.account_type === 'wholesaler' ? { ...f, wholesale_categories: v } : { ...f, product_lines: v })} placeholder="e.g. Solar panels" />
          </Field>
          <Field label="Website"><Input value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="https://" /></Field>
          <Field label="Portfolio links"><TagInput value={f.portfolio_links} onChange={(v) => setF({ ...f, portfolio_links: v })} placeholder="Paste a link and press Enter" /></Field>
          <Field label="Contact email"><Input type="email" value={f.contact_email} onChange={(e) => setF({ ...f, contact_email: e.target.value })} /></Field>
          <Field label="Contact phone"><Input value={f.contact_phone} onChange={(e) => setF({ ...f, contact_phone: e.target.value })} /></Field>
          <Field label="Physical address" className="span-2"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          <Field label="Opening hours"><Input value={f.opening_hours} onChange={(e) => setF({ ...f, opening_hours: e.target.value })} placeholder="Mon–Fri 08:00–17:00" /></Field>
          <Field label="Employees"><Select value={f.employee_count} onChange={(e) => setF({ ...f, employee_count: e.target.value })} placeholder="Choose" options={['1-10', '11-50', '51-200', '201-500', '500+']} /></Field>
          <Field label="Year founded"><Input type="number" value={f.founded_year} onChange={(e) => setF({ ...f, founded_year: e.target.value })} /></Field>
          <Field label="Business registration number" hint='Stored encrypted. Leave blank to keep the current one.'><Input value={f.registration_number} onChange={(e) => setF({ ...f, registration_number: e.target.value })} autoComplete="off" /></Field>
        </div>
        <div className="form-actions"><button className="btn btn-primary" onClick={save}>Save business profile</button></div>
      </div>
      <div className="card card-pad stack">
        <div><h3>Map location</h3><p className="small muted">Click the map or drag the pin to your exact location so customers can find you under “Businesses near me”.</p></div>
        <MapView center={center} zoom={14} pick={{ value: loc, onChange: (lat, lng) => setLoc([lat, lng]) }} />
        <div className="form-actions"><button className="btn btn-primary" disabled={!loc} onClick={saveLocation}>Save location</button></div>
      </div>
      {verifying && <VerificationDialog onClose={() => setVerifying(false)} onDone={() => { setVerifying(false); reload(); get('/auth/me').then(setMe); }} />}
    </div>
  );
}

function VerificationDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [files, setFiles] = useState<Json[]>([]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await post('/businesses/me/verification', { document_ids: files.map((f) => f.id), notes });
      toast('Verification request sent', 'success');
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Request business verification" onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !files.length} onClick={submit}>Submit for review</button></>}>
      <div className="stack">
        <ErrorBox error={error} />
        <p className="small">Upload your business registration certificate and any licences. Documents are private and only seen by the OmniBiz verification team.</p>
        {files.map((f) => <div key={f.id} className="row small"><Icon name="file" size={16} />{f.name}</div>)}
        <button className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => ref.current?.click()}><Icon name="upload" />Add document</button>
        <input ref={ref} type="file" hidden accept=".pdf,image/*,.doc,.docx" onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try { const d = await uploadDocument(file, 'business_registration', 'private'); setFiles((x) => [...x, d]); } catch (err) { setError((err as Error).message); }
        }} />
        <Field label="Notes for the reviewer"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Registration number, TIN, anything that helps us verify you" /></Field>
      </div>
    </Modal>
  );
}

function TwoFactor() {
  const { me, setMe } = useSession();
  const act = useAction();
  const [setup, setSetup] = useState<{ secret: string; otpauth_url: string } | null>(null);
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [disabling, setDisabling] = useState(false);
  useEffect(() => {
    if (setup) QRCode.toDataURL(setup.otpauth_url, { margin: 1, width: 200 }).then(setQr);
  }, [setup]);
  const on = me!.user.totp_enabled;
  return (
    <div className="card card-pad stack-sm">
      <div className="row-between">
        <div className="row"><Icon name="key" /><h3>Two-factor authentication</h3></div>
        <span className={`chip ${on ? 'chip-success' : ''}`}>{on ? 'On' : 'Off'}</span>
      </div>
      <p className="small muted">Require a code from an authenticator app (Google Authenticator, Authy, Microsoft Authenticator) when you sign in.</p>
      {!on && !setup && <button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={async () => { const r = await act(() => post('/auth/2fa/setup')); if (r) setSetup(r); }}>Set up 2FA</button>}
      {setup && (
        <div className="stack-sm">
          <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {qr && <img src={qr} alt="2FA QR code" style={{ width: 160, height: 160, borderRadius: 8, background: '#fff', padding: 4 }} />}
            <div className="small stack-sm" style={{ maxWidth: 360 }}>
              <div>1. Scan the QR code with your authenticator app, or enter this key:</div>
              <span className="kbd" style={{ wordBreak: 'break-all' }}>{setup.secret}</span>
              <div>2. Enter the 6-digit code it shows:</div>
              <div className="row">
                <Input className="otp-input" style={{ fontSize: '1rem' }} inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
                <button className="btn btn-primary" disabled={code.length !== 6} onClick={async () => { const r = await act(() => post('/auth/2fa/enable', { code }), 'Two-factor authentication is on'); if (r) { setMe(r); setSetup(null); setCode(''); } }}>Enable</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {on && !disabling && <button className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setDisabling(true)}>Turn off</button>}
      {on && disabling && (
        <div className="form-grid">
          <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Input placeholder="6-digit code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          <button className="btn btn-danger btn-sm" onClick={async () => { const r = await act(() => post('/auth/2fa/disable', { password, code }), 'Two-factor authentication is off'); if (r) { setMe(r); setDisabling(false); setCode(''); setPassword(''); } }}>Confirm turn off</button>
        </div>
      )}
    </div>
  );
}

function VerifyContact() {
  const { me, setMe } = useSession();
  const act = useAction();
  const u = me!.user;
  const [codes, setCodes] = useState({ email: '', phone: '' });
  const rows: ['email' | 'phone', string, boolean][] = [['email', u.email, u.email_verified], ['phone', u.phone, u.phone_verified]];
  if (u.email_verified && u.phone_verified) return null;
  return (
    <div className="card card-pad stack-sm">
      <h3>Verify your contact details</h3>
      {rows.filter(([, , v]) => !v).map(([ch, target]) => (
        <div key={ch} className="row-wrap">
          <span className="small" style={{ minWidth: 200 }}><b>{label(ch)}:</b> {target}</span>
          <Input style={{ width: 120 }} placeholder="Code" inputMode="numeric" maxLength={6} value={codes[ch]} onChange={(e) => setCodes({ ...codes, [ch]: e.target.value.replace(/\D/g, '') })} />
          <button className="btn btn-primary btn-sm" disabled={codes[ch].length !== 6} onClick={async () => { const r = await act(() => post('/auth/verify/confirm', { channel: ch, code: codes[ch] }), 'Verified'); if (r) setMe(r); }}>Verify</button>
          <button className="btn btn-ghost btn-sm" onClick={() => act(() => post('/auth/verify/send', { channel: ch }), 'Code sent')}>Send code</button>
        </div>
      ))}
      <DevOutboxHint />
    </div>
  );
}

function Security() {
  const act = useAction();
  const nav = useNavigate();
  const { me, setMe } = useSession();
  const sessions = useApi('/auth/sessions');
  const history = useApi('/auth/login-history');
  const [pw, setPw] = useState({ current: '', password: '' });
  const [deleting, setDeleting] = useState(false);
  const [delPw, setDelPw] = useState('');
  return (
    <div className="stack">
      {me?.features?.contact_verification && <VerifyContact />}
      <div className="card card-pad stack-sm">
        <h3>Change password</h3>
        <div className="form-grid">
          <Input type="password" placeholder="Current password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          <Input type="password" placeholder="New password (8+ chars, letters & numbers)" autoComplete="new-password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} />
        </div>
        <div className="form-actions"><button className="btn btn-primary btn-sm" onClick={async () => { if (await act(() => post('/auth/password', pw), 'Password changed. Other devices were signed out.')) { setPw({ current: '', password: '' }); sessions.reload(); } }}>Update password</button></div>
      </div>
      <TwoFactor />
      <div className="card">
        <div className="card-header"><h3>Active sessions</h3><button className="btn btn-outline btn-sm" onClick={async () => { if (await act(() => post('/auth/sessions/revoke-others'), 'Signed out of other devices')) sessions.reload(); }}>Sign out other devices</button></div>
        {sessions.loading ? <Spinner /> : sessions.data?.sessions.map((s: Json) => (
          <div key={s.id} className="list-item">
            <Icon name="smartphone" />
            <div className="grow">
              <div className="small bold truncate">{s.user_agent?.match(/\(([^)]+)\)/)?.[1] ?? s.user_agent ?? 'Unknown device'}</div>
              <div className="xsmall muted">{s.ip} · active {timeAgo(s.last_seen_at)}</div>
            </div>
            {s.current ? <span className="chip chip-success">This device</span> : <button className="btn btn-ghost btn-sm" onClick={async () => { if (await act(() => del(`/auth/sessions/${s.id}`))) sessions.reload(); }}>Sign out</button>}
          </div>
        ))}
      </div>
      <div className="card">
        <div className="card-header"><h3>Recent sign-in activity</h3></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>When</th><th>IP</th><th>Result</th></tr></thead>
            <tbody>
              {history.data?.events.map((e: Json, i: number) => (
                <tr key={i}>
                  <td className="small">{parseTime(e.created_at).toLocaleString()}</td>
                  <td className="small">{e.ip}</td>
                  <td>{e.success ? (e.suspicious ? <span className="chip chip-accent">New device</span> : <span className="chip chip-success">Success</span>) : <span className="chip chip-danger">Failed</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card card-pad stack-sm" style={{ borderColor: 'var(--danger)' }}>
        <h3 style={{ color: 'var(--danger)' }}>Delete account</h3>
        <p className="small muted">Permanently removes your profile, posts and listings. This cannot be undone.</p>
        {!deleting ? <button className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setDeleting(true)}>Delete my account</button> : (
          <div className="row-wrap">
            <Input type="password" placeholder="Confirm with your password" value={delPw} onChange={(e) => setDelPw(e.target.value)} style={{ maxWidth: 280 }} />
            <button className="btn btn-danger btn-sm" onClick={async () => { if (await act(() => post('/auth/delete-account', { password: delPw }))) { setMe(null); nav('/'); } }}>Delete permanently</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Settings() {
  const { me } = useSession();
  const biz = isBusinessType(me?.user.account_type);
  return (
    <main className="page page-mid">
      <PageTitle title="Settings & privacy" />
      <div className="layout-side">
        <aside className="card sticky-side">
          <nav className="side-nav">
            <NavLink to="/settings/account"><Icon name="user" />Account</NavLink>
            {biz && <NavLink to="/settings/business"><Icon name="building" />Business profile</NavLink>}
            <NavLink to="/settings/interests"><Icon name="sparkles" />Interests</NavLink>
            <NavLink to="/settings/security"><Icon name="shield" />Security</NavLink>
          </nav>
        </aside>
        <section>
          <SectionSwap><Routes>
            <Route index element={<Navigate to="account" replace />} />
            <Route path="account" element={<Account />} />
            <Route path="business" element={biz ? <BusinessSettings /> : <Empty title="Not a business account" />} />
            <Route path="interests" element={<Interests />} />
            <Route path="security" element={<Security />} />
          </Routes></SectionSwap>
        </section>
      </div>
    </main>
  );
}
