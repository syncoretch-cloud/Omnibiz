import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router';
import QRCode from 'qrcode';
import { Icon } from '../components/Icon.tsx';
import { Avatar, Empty, ErrorBox, Field, Input, Modal, PageTitle, Select, Spinner, TagInput, Textarea, SectionSwap } from '../components/ui.tsx';
import { useAvatarUpload } from '../components/AvatarUpload.tsx';
import { LocationFields } from '../components/LocationFields.tsx';
import { PlanSettings } from './PlanSettings.tsx';
import { Alerts } from './Alerts.tsx';
import { ProfileForm } from './CvEditor.tsx';
import { MapView } from '../components/MapView.tsx';
import { DevOutboxHint } from './Auth.tsx';
import { get, patch, post, put, uploadDocument, del } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { useApi } from '../lib/hooks.ts';
import { isBusinessType, useAction, useSession, useToast } from '../lib/session.tsx';
import { label, money, parseTime, timeAgo } from '../lib/format.ts';

/** Profile picture (a business's logo): saves the moment you pick one. */
function PictureEditor() {
  const { me } = useSession();
  const pic = useAvatarUpload();
  const u = me!.user;
  return (
    <div className="picture-editor">
      <Avatar user={u} size={96} square={pic.biz} />
      <div className="stack-sm">
        <div className="row-wrap">
          <button type="button" className="btn btn-primary btn-sm" disabled={pic.busy} onClick={pic.open}><Icon name="camera" />{pic.busy ? 'Uploading…' : pic.has ? 'Change photo' : 'Upload photo'}</button>
          {pic.has && <button type="button" className="btn btn-ghost btn-sm" disabled={pic.busy} onClick={pic.remove}><Icon name="trash" />Remove</button>}
        </div>
        <p className="xsmall muted">JPG, PNG or WebP up to 10 MB. It is cropped to a square and saved straight away.</p>
        {pic.field}
      </div>
    </div>
  );
}

/** Optional public contact details and links. Anything filled in here is shown on your public profile. */
function ContactLinks() {
  const { me, setMe } = useSession();
  const act = useAction();
  const u = me!.user;
  const [email, setEmail] = useState<string>(u.public_email ?? '');
  const [phone, setPhone] = useState<string>(u.public_phone ?? '');
  const [links, setLinks] = useState<string[]>(u.links ?? []);
  const setLink = (i: number, v: string) => setLinks((l) => l.map((x, k) => (k === i ? v : x)));
  const save = async () => {
    const r = await act(() => patch('/users/me', { public_email: email.trim(), public_phone: phone.trim(), links: links.map((l) => l.trim()).filter(Boolean) }), 'Contact details and links saved');
    if (r) { setMe(r); setLinks(r.user.links ?? []); }
  };
  return (
    <div className="card card-pad stack">
      <div>
        <h3>Contact & links</h3>
        <p className="small muted">All optional. Whatever you add here is shown on your public profile so anyone can reach you. The email and phone you sign in with are separate: they are never shown to the public, and recruiters see them only if your privacy choices under Professional allow it.</p>
      </div>
      <div className="form-grid">
        <Field label="Public email" hint="Leave empty to show none."><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="hello@yourname.com" autoComplete="off" /></Field>
        <Field label="Public phone" hint="Leave empty to show none."><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+255 7XX XXX XXX" autoComplete="off" /></Field>
      </div>
      <Field label="Links" hint="Website, LinkedIn, GitHub, Instagram, portfolio… Up to 8.">
        <div className="stack-sm">
          {links.map((l, i) => (
            <div key={i} className="row">
              <div className="input-icon grow"><Icon name="link" /><Input value={l} onChange={(e) => setLink(i, e.target.value)} placeholder="linkedin.com/in/yourname" autoComplete="off" /></div>
              <button type="button" className="icon-btn" onClick={() => setLinks((x) => x.filter((_, k) => k !== i))} aria-label="Remove link"><Icon name="trash" /></button>
            </div>
          ))}
          {links.length < 8 && <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setLinks((x) => [...x, ''])}><Icon name="plus" />Add a link</button>}
        </div>
      </Field>
      <div className="form-actions"><button className="btn btn-primary" onClick={save}>Save contact & links</button></div>
    </div>
  );
}

function Account() {
  const { me, meta, setMe } = useSession();
  const act = useAction();
  const u = me!.user;
  const biz = isBusinessType(u.account_type);
  const [f, setF] = useState<Json>({ display_name: u.display_name, bio: u.bio ?? '', email: u.email, phone: u.phone ?? '', country: u.country ?? '', region: u.region ?? '', city: u.city ?? '', share_precise_location: u.share_precise_location });
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
        <Field label={biz ? 'Logo' : 'Profile picture'}><PictureEditor /></Field>
        <div className="form-grid">
          <Field label={biz ? 'Business name' : 'Display name'}><Input value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></Field>
          <Field label="Username"><Input value={u.username} disabled /></Field>
          <Field label="Bio" className="span-2"><Textarea value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} maxLength={1000} style={{ minHeight: 70 }} /></Field>
          <Field label="Sign-in email" hint={me?.features?.contact_verification ? (u.email_verified ? '✓ Verified' : 'Not verified') : undefined}><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Sign-in phone" hint={me?.features?.contact_phone ? (u.phone_verified ? '✓ Verified' : 'Not verified') : undefined}><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        </div>
      </div>
      {biz ? (
        <div className="card card-pad row-between">
          <div><h3>Contact & links</h3><p className="small muted">A business's public email, phone, website and links are set in its business profile.</p></div>
          <NavLink to="/settings/business" className="btn btn-outline btn-sm">Open business profile</NavLink>
        </div>
      ) : <ContactLinks />}
      <div className="card card-pad stack">
        <h3>Location & privacy</h3>
        <div className="form-grid">
          <LocationFields labelled value={{ country: f.country ?? '', region: f.region ?? '', city: f.city ?? '' }} onChange={(p) => setF((x: Json) => ({ ...x, ...p }))} />
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

/** Personal accounts: headline, summary, what work you want. It is the same form as the one on the CV tab of your profile. */
function Professional() {
  return (
    <div className="stack">
      <p className="small muted">This is what recruiters see first. Your full CV (experience, education, skills and documents) is on the CV tab of <b>your profile</b>.</p>
      <ProfileForm />
    </div>
  );
}

/** Where your orders go. Checkout starts from this, so you only type it once. */
function Delivery() {
  const { me, setMe } = useSession();
  const act = useAction();
  const u = me!.user;
  const [address, setAddress] = useState<string>(u.delivery_address ?? '');
  const [phone, setPhone] = useState<string>(u.phone ?? '');
  const save = async () => {
    const r = await act(() => patch('/users/me', { delivery_address: address.trim(), ...(phone && phone !== u.phone ? { phone } : {}) }), 'Delivery details saved');
    if (r) setMe(r);
  };
  return (
    <div className="stack">
      <div className="card card-pad stack">
        <div><h3>Delivery details</h3><p className="small muted">Used to fill in checkout for you. You can still change them on any order.</p></div>
        <Field label="Delivery address" hint="Street, area and city, with any landmark that helps the rider."><Textarea value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} style={{ minHeight: 84 }} /></Field>
        <Field label="Phone for delivery" hint="The rider calls this number."><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <div className="form-actions"><button className="btn btn-primary" onClick={save}>Save delivery details</button></div>
      </div>
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

/** 1 month, 6 months or a year of verification, with what each costs and saves. */
function TermPicker({ info, value, onChange }: { info: Json; value: string; onChange: (p: string) => void }) {
  return (
    <div className="stack-sm">
      {info.options.map((o: Json) => (
        <button key={o.period} type="button" className={`card card-pad row-between${value === o.period ? ' plan-current' : ''}`} style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => onChange(o.period)} aria-pressed={value === o.period}>
          <span><b>{o.label}</b>{o.term_discount > 0 && <span className="chip chip-accent" style={{ marginLeft: 8 }}>save {o.term_discount}%</span>}<div className="xsmall muted">{money(o.per_month, info.currency)} / month{o.saving > 0 ? ` · you save ${money(o.saving, info.currency)}` : ''}</div></span>
          <b>{o.total > 0 ? money(o.total, info.currency) : 'Free'}</b>
        </button>
      ))}
    </div>
  );
}

function VerificationDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { me } = useSession();
  const biz = isBusinessType(me?.user.account_type);
  const { data: info } = useApi('/verification');
  const [files, setFiles] = useState<Json[]>([]);
  const [period, setPeriod] = useState('yearly');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const pick = info?.options.find((o: Json) => o.period === period);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await post('/verification', { document_ids: files.map((f) => f.id), notes, period });
      toast('Verification request sent', 'success');
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={biz ? 'Get your business verified' : 'Get verified'} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !files.length || !info} onClick={submit}>{pick && pick.total > 0 ? `Pay ${money(pick.total, info.currency)} and submit` : 'Submit for review'}</button></>}>
      <div className="stack">
        <ErrorBox error={error} />
        <p className="small">{biz ? 'Upload your business registration certificate and any licences.' : 'Upload a photo of your national ID or passport.'} Documents are private and only seen by the OmniBiz verification team.</p>
        {info && <TermPicker info={info} value={period} onChange={setPeriod} />}
        {info?.billing === 'test' && pick?.total > 0 && <p className="xsmall muted">Payments are not connected yet, so nothing is charged for now.</p>}
        {files.map((f) => <div key={f.id} className="row small"><Icon name="file" size={16} />{f.name}</div>)}
        <button className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => ref.current?.click()}><Icon name="upload" />Add document</button>
        <input ref={ref} type="file" hidden accept=".pdf,image/*,.doc,.docx" onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try { const d = await uploadDocument(file, biz ? 'business_registration' : 'id', 'private'); setFiles((x) => [...x, d]); } catch (err) { setError((err as Error).message); }
        }} />
        <Field label="Notes for the reviewer"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Registration number, TIN, anything that helps us verify you" /></Field>
      </div>
    </Modal>
  );
}

/** Settings → Verification: pay the fee, send ID or registration documents, and get the badge once staff approve. */
function VerificationSettings() {
  const { setMe } = useSession();
  const act = useAction();
  const { data, loading, reload } = useApi('/verification');
  const [open, setOpen] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [term, setTerm] = useState('yearly');
  if (loading || !data) return <Spinner block />;
  const last = data.requests[0];
  const monthly = data.options[0];
  const refreshMe = () => get('/auth/me').then(setMe);
  const renew = async () => {
    if (await act(() => post('/verification/renew', { period: term }), 'Verification renewed')) { setRenewing(false); reload(); refreshMe(); }
  };
  return (
    <div className="stack">
      <div className="card card-pad stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row"><Icon name={data.verified ? 'shieldCheck' : 'shield'} /><h3>Verification</h3></div>
          <span className={`chip ${data.verified ? 'chip-success' : data.status === 'pending' ? 'chip-accent' : data.status === 'rejected' || data.lapsed ? 'chip-danger' : ''}`}>{data.verified ? 'Verified' : data.lapsed ? 'Expired' : data.status === 'none' ? 'Not verified' : label(data.status)}</span>
        </div>
        <p className="small muted">A verified badge shows people your account is genuine. Verified accounts are also shown first in the marketplace, jobs and search, and rank higher in feeds, so more people see you. Choose 1 month, 6 months or a year; longer terms cost less per month.{data.discount > 0 && <> Your plan takes <b>{data.discount}% off</b>.</>}</p>
        {data.verified && <p className="small">{data.verified_until ? <>Your badge is active until <b>{parseTime(data.verified_until).toLocaleDateString()}</b>.</> : 'Your badge does not expire.'}</p>}
        {data.lapsed && <p className="small">Your verified badge has expired. You can renew it without sending documents again.</p>}
        {data.status === 'rejected' && last?.review_notes && <p className="small">Last review: {last.review_notes}</p>}
        {data.status === 'pending' && <p className="small">Your request is with the verification team. We will tell you as soon as it has been reviewed.</p>}
        {renewing && (
          <div className="stack-sm">
            <TermPicker info={data} value={term} onChange={setTerm} />
            <div className="row-wrap"><button className="btn btn-primary btn-sm" onClick={renew}>{data.options.find((o: Json) => o.period === term)?.total > 0 ? `Pay ${money(data.options.find((o: Json) => o.period === term).total, data.currency)} and renew` : 'Renew'}</button><button className="btn btn-ghost btn-sm" onClick={() => setRenewing(false)}>Cancel</button></div>
            {data.billing === 'test' && <p className="xsmall muted">Payments are not connected yet, so nothing is charged for now.</p>}
          </div>
        )}
        <div className="form-actions" style={{ justifyContent: 'flex-start', alignItems: 'center', gap: 12 }}>
          {!data.verified && data.status !== 'pending' && !data.lapsed && (
            <button className="btn btn-primary" onClick={() => setOpen(true)}><Icon name="shieldCheck" />{monthly.total > 0 ? `Get verified · from ${money(data.options[2].per_month, data.currency)} / month` : 'Get verified'}</button>
          )}
          {data.can_renew && !renewing && <button className="btn btn-primary" onClick={() => setRenewing(true)}><Icon name="shieldCheck" />{data.verified ? 'Renew early' : 'Renew verification'}</button>}
        </div>
      </div>
      {open && <VerificationDialog onClose={() => setOpen(false)} onDone={() => { setOpen(false); reload(); refreshMe(); }} />}
    </div>
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
  const rows: ['email' | 'phone', string, boolean][] = [['email', u.email, u.email_verified], ...(me?.features?.contact_phone ? [['phone', u.phone, u.phone_verified] as ['phone', string, boolean]] : [])];
  if (rows.every(([, , v]) => v)) return null;
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
  const { me, can } = useSession();
  const biz = isBusinessType(me?.user.account_type);
  return (
    <main className="page page-mid">
      <PageTitle title="Settings & privacy" />
      <div className="layout-side">
        <aside className="card sticky-side">
          <nav className="side-nav">
            <NavLink to="/settings/account"><Icon name="user" />Account</NavLink>
            {can('manage_cv') && <NavLink to="/settings/professional"><Icon name="briefcase" />Professional</NavLink>}
            {biz && <NavLink to="/settings/business"><Icon name="building" />Business profile</NavLink>}
            <NavLink to="/settings/plan"><Icon name="award" />Plan</NavLink>
            {can('create_posts') && <NavLink to="/settings/verification"><Icon name="shieldCheck" />Verification</NavLink>}
            <NavLink to="/settings/delivery"><Icon name="package" />Delivery</NavLink>
            <NavLink to="/settings/alerts"><Icon name="bell" />Alerts</NavLink>
            <NavLink to="/settings/interests"><Icon name="sparkles" />Interests</NavLink>
            <NavLink to="/settings/security"><Icon name="shield" />Security</NavLink>
          </nav>
        </aside>
        <section>
          <SectionSwap><Routes>
            <Route index element={<Navigate to="account" replace />} />
            <Route path="account" element={<Account />} />
            <Route path="professional" element={can('manage_cv') ? <Professional /> : <Empty title="Professional profiles are for personal accounts" />} />
            <Route path="plan" element={<PlanSettings />} />
            <Route path="verification" element={can('create_posts') ? <VerificationSettings /> : <Empty title="Verification is for accounts that post" />} />
            <Route path="delivery" element={<Delivery />} />
            <Route path="business" element={biz ? <BusinessSettings /> : <Empty title="Not a business account" />} />
            <Route path="alerts" element={<Alerts />} />
            <Route path="interests" element={<Interests />} />
            <Route path="security" element={<Security />} />
          </Routes></SectionSwap>
        </section>
      </div>
    </main>
  );
}
