import { Router } from 'express';
import type { Request, Response } from 'express';
import { all, get, run, tx, sqlTime, MINUTE, DAY } from '../db/index.ts';
import type { Row } from '../db/index.ts';
import { badRequest, conflict, forbidden, HttpError, notFound, unauthorized, validate } from '../lib/http.ts';
import { encrypt, decrypt, hashPassword, passwordProblem, randomCode, randomToken, sha256, verifyPassword } from '../lib/crypto.ts';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../lib/totp.ts';
import { clearSessionCookie, createSession, requireAuth, setSessionCookie } from '../lib/auth.ts';
import { rateLimit, hit } from '../lib/ratelimit.ts';
import { sendEmail, sendSms } from '../lib/outbox.ts';
import { ACCOUNT_TYPES, isBusiness } from '../lib/constants.ts';
import { ACCOUNT_PERMISSIONS, staffPermissions } from '../lib/permissions.ts';
import { canonicalCity, cityCoords } from '../lib/geo.ts';
import { selfView } from '../services/users.ts';
import { reindexUser } from '../services/search-index.ts';
import { notify } from '../services/notify.ts';
import { config } from '../config.ts';

export const authRouter = Router();

const USERNAME = /^[a-zA-Z0-9_.]{3,30}$/;
const PHONE = /^\+?\d{9,15}$/;
const normPhone = (p: string) => p.replace(/[\s\-()]/g, '');

// ───────────── helpers ─────────────
function issueCode(user: Row, purpose: 'email' | 'phone' | 'reset') {
  if (!hit(`code:${user.id}:${purpose}`, 5, 60 * MINUTE)) throw new HttpError(429, 'Too many codes requested. Try again later.');
  const code = randomCode();
  run("UPDATE verification_codes SET used_at = datetime('now') WHERE user_id = ? AND purpose = ? AND used_at IS NULL", user.id, purpose);
  const target = purpose === 'phone' ? user.phone : user.email;
  run(
    'INSERT INTO verification_codes (user_id, purpose, code_hash, target, expires_at) VALUES (?,?,?,?,?)',
    user.id, purpose, sha256(`${user.id}:${code}`), target, sqlTime(15 * MINUTE),
  );
  if (purpose === 'email') sendEmail(user.email, 'Verify your OmniBiz email', `Your OmniBiz verification code is ${code}. It expires in 15 minutes.`);
  if (purpose === 'phone' && user.phone) sendSms(user.phone, `OmniBiz code: ${code}`);
  if (purpose === 'reset') {
    sendEmail(user.email, 'Reset your OmniBiz password', `Use code ${code} to reset your password. If you did not request this, you can ignore this email.`);
    if (user.phone && user.phone_verified) sendSms(user.phone, `OmniBiz password reset code: ${code}`);
  }
}

function consumeCode(userId: number, purpose: string, code: string): boolean {
  const row = get(
    "SELECT * FROM verification_codes WHERE user_id = ? AND purpose = ? AND used_at IS NULL AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1",
    userId, purpose,
  );
  if (!row || row.attempts >= 5) return false;
  if (row.code_hash !== sha256(`${userId}:${String(code).trim()}`)) {
    run('UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?', row.id);
    return false;
  }
  run("UPDATE verification_codes SET used_at = datetime('now') WHERE id = ?", row.id);
  return true;
}

function findByIdentifier(identifier: string): Row | undefined {
  const id = identifier.trim();
  if (id.includes('@')) return get('SELECT * FROM users WHERE email = ?', id.toLowerCase());
  if (/^\+?[\d\s\-()]{9,}$/.test(id)) return get('SELECT * FROM users WHERE phone = ?', normPhone(id));
  return get('SELECT * FROM users WHERE username = ?', id);
}

export function buildMe(userId: number) {
  const u = get('SELECT * FROM users WHERE id = ?', userId);
  if (!u) throw notFound('User');
  const business = isBusiness(u.account_type) ? get('SELECT * FROM businesses WHERE user_id = ?', userId) : undefined;
  if (business) delete business.registration_number_enc;
  const profile = u.account_type === 'personal' ? get('SELECT * FROM profiles WHERE user_id = ?', userId) : undefined;
  const counts = get(
    `SELECT
      (SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL) AS notifications,
      (SELECT COUNT(*) FROM conversation_members cm JOIN conversations c ON c.id = cm.conversation_id
         WHERE cm.user_id = ? AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.sender_id != ? AND m.created_at > cm.last_read_at)) AS messages,
      (SELECT COALESCE(SUM(qty), 0) FROM cart_items WHERE user_id = ?) AS cart`,
    userId, userId, userId, userId,
  );
  return {
    user: selfView(u),
    business: business ?? null,
    profile: profile ?? null,
    interests: all('SELECT slug FROM user_interests WHERE user_id = ?', userId).map((r) => r.slug),
    permissions: ACCOUNT_PERMISSIONS[u.account_type] ?? [],
    staff_permissions: staffPermissions(u.role),
    features: { contact_verification: config.contactVerification },
    counts,
  };
}

function startSession(req: Request, res: Response, userId: number, remember = false) {
  const token = createSession(userId, req, remember);
  setSessionCookie(res, token, remember);
  // Native/mobile clients cannot rely on cookies; they opt in to receiving the bearer token.
  return req.headers['x-client'] === 'mobile' ? token : undefined;
}

function recordLogin(user: Row, req: Request, success: boolean) {
  const ua = String(req.headers['user-agent'] ?? '').slice(0, 300);
  let suspicious = false;
  if (success) {
    const prior = get('SELECT COUNT(*) AS n FROM login_events WHERE user_id = ? AND success = 1', user.id)!.n as number;
    const known = get(
      'SELECT 1 AS x FROM login_events WHERE user_id = ? AND success = 1 AND (ip = ? OR user_agent = ?) AND created_at > ? LIMIT 1',
      user.id, req.ip ?? null, ua, sqlTime(-90 * DAY),
    );
    suspicious = prior > 0 && !known;
  }
  run('INSERT INTO login_events (user_id, ip, user_agent, success, suspicious) VALUES (?,?,?,?,?)', user.id, req.ip ?? null, ua, success, suspicious);
  if (suspicious) {
    notify([user.id], { type: 'security', title: 'New sign-in to your account', body: `From a new device or network (${req.ip}). If this wasn't you, change your password now.`, link: '/settings/security' });
    sendEmail(user.email, 'New sign-in to OmniBiz', `We noticed a sign-in from a new device or network (${req.ip}). If this wasn't you, reset your password immediately.`);
  }
}

// ───────────── registration ─────────────
authRouter.post('/register', rateLimit('register', 10, 60 * MINUTE, (r) => r.ip ?? ''), (req, res) => {
  const base = validate(req.body, {
    account_type: { type: 'enum', values: ACCOUNT_TYPES, required: true },
    username: { type: 'string', required: true, max: 30 },
    email: { type: 'email', required: true },
    phone: { type: 'string', required: true, max: 20 },
    password: { type: 'string', required: true, max: 128 },
    full_name: { type: 'string', max: 100 },
    business_name: { type: 'string', max: 120 },
    category: { type: 'string', max: 50 },
    custom_category: { type: 'string', max: 60 },
    description: { type: 'text', max: 2000 },
    dob: { type: 'date' },
    country: { type: 'string', max: 60 },
    region: { type: 'string', max: 60 },
    city: { type: 'string', max: 60 },
  });
  const type = base.account_type as string;
  if (!USERNAME.test(base.username)) throw badRequest('Username must be 3–30 letters, numbers, dots or underscores', { fields: { username: 'invalid' } });
  const phone = normPhone(base.phone);
  if (!PHONE.test(phone)) throw badRequest('Enter a valid phone number, e.g. +255712345678', { fields: { phone: 'invalid' } });
  const pwErr = passwordProblem(base.password);
  if (pwErr) throw badRequest(pwErr, { fields: { password: pwErr } });

  const business = isBusiness(type);
  if (business && (!base.business_name || !base.category)) throw badRequest('Business name and category are required', { fields: { business_name: 'required', category: 'required' } });
  if (!business && !base.full_name) throw badRequest('Full name is required', { fields: { full_name: 'required' } });

  if (get('SELECT 1 AS x FROM users WHERE username = ?', base.username)) throw conflict('That username is taken');
  if (get('SELECT 1 AS x FROM users WHERE email = ?', base.email)) throw conflict('An account with that email already exists');
  if (get('SELECT 1 AS x FROM users WHERE phone = ?', phone)) throw conflict('An account with that phone number already exists');

  const city = canonicalCity(base.city);
  const coords = cityCoords(city);
  const userId = tx(() => {
    const { id } = run(
      `INSERT INTO users (account_type, username, email, phone, password_hash, display_name, country, region, city, lat, lng)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      type, base.username, base.email, phone, hashPassword(base.password),
      business ? base.business_name : base.full_name, base.country ?? null, base.region ?? null, city, coords?.lat ?? null, coords?.lng ?? null,
    );
    if (business) {
      run(
        'INSERT INTO businesses (user_id, kind, name, category, custom_category, description, contact_email, contact_phone) VALUES (?,?,?,?,?,?,?,?)',
        id, type, base.business_name, base.category, base.category === 'other' ? (base.custom_category ?? null) : null, base.description ?? null, base.email, phone,
      );
    } else if (type === 'personal') {
      run('INSERT INTO profiles (user_id, full_name, dob, field_visibility) VALUES (?,?,?,?)', id, base.full_name, base.dob ?? null, { email: 'recruiters', phone: 'recruiters', dob: 'private' });
    }
    return id;
  });
  const user = get('SELECT * FROM users WHERE id = ?', userId)!;
  if (config.contactVerification) {
    issueCode(user, 'email');
    issueCode(user, 'phone');
  }
  reindexUser(userId);
  recordLogin(user, req, true);
  const token = startSession(req, res, userId);
  res.status(201).json({ ...buildMe(userId), token });
});

authRouter.get('/username-available', (req, res) => {
  const u = String(req.query.username ?? '');
  res.json({ available: USERNAME.test(u) && !get('SELECT 1 AS x FROM users WHERE username = ?', u) });
});

// ───────────── login / logout ─────────────
authRouter.post('/login', rateLimit('login', 20, 15 * MINUTE, (r) => r.ip ?? ''), (req, res) => {
  const { identifier, password, remember } = validate(req.body, { identifier: { type: 'string', required: true }, password: { type: 'string', required: true, max: 128 }, remember: { type: 'bool' } });
  const user = findByIdentifier(identifier);
  const fail = () => unauthorized('Incorrect username/email or password');
  if (!user || user.status === 'deleted') {
    verifyPassword(password, 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86)); // equalise timing
    throw fail();
  }
  if (user.locked_until && Date.parse(user.locked_until + 'Z') > Date.now()) {
    throw new HttpError(429, 'Too many failed attempts. Your account is temporarily locked — try again in a few minutes or reset your password.');
  }
  if (!verifyPassword(password, user.password_hash)) {
    const failures = user.failed_logins + 1;
    if (failures >= 5) {
      run('UPDATE users SET failed_logins = 0, locked_until = ? WHERE id = ?', sqlTime(15 * MINUTE), user.id);
      sendEmail(user.email, 'OmniBiz account temporarily locked', 'Several failed sign-in attempts were made on your account, so it is locked for 15 minutes.');
    } else run('UPDATE users SET failed_logins = ? WHERE id = ?', failures, user.id);
    recordLogin(user, req, false);
    throw fail();
  }
  run('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?', user.id);

  if (user.totp_enabled) {
    const challenge = randomToken(24);
    // The challenge row carries the "keep me logged in" choice through the 2FA step.
    run('INSERT INTO verification_codes (user_id, purpose, code_hash, target, expires_at) VALUES (?,?,?,?,?)', user.id, 'login_2fa', sha256(challenge), remember ? 'remember' : null, sqlTime(5 * MINUTE));
    return res.json({ twofa_required: true, challenge });
  }
  run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", user.id);
  recordLogin(user, req, true);
  const token = startSession(req, res, user.id, !!remember);
  res.json({ ...buildMe(user.id), token });
});

authRouter.post('/login/2fa', rateLimit('login2fa', 10, 15 * MINUTE, (r) => r.ip ?? ''), (req, res) => {
  const { challenge, code } = validate(req.body, { challenge: { type: 'string', required: true }, code: { type: 'string', required: true, max: 10 } });
  const row = get(
    "SELECT * FROM verification_codes WHERE code_hash = ? AND purpose = 'login_2fa' AND used_at IS NULL AND expires_at > datetime('now')",
    sha256(challenge),
  );
  if (!row || row.attempts >= 5) throw unauthorized('Your sign-in session expired. Please sign in again.');
  const user = get('SELECT * FROM users WHERE id = ?', row.user_id)!;
  if (!user.totp_secret_enc || !verifyTotp(decrypt(user.totp_secret_enc), code)) {
    run('UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?', row.id);
    throw unauthorized('That code is not valid');
  }
  run("UPDATE verification_codes SET used_at = datetime('now') WHERE id = ?", row.id);
  run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", user.id);
  recordLogin(user, req, true);
  const token = startSession(req, res, user.id, row.target === 'remember');
  res.json({ ...buildMe(user.id), token });
});

authRouter.post('/logout', (req, res) => {
  if (req.sessionId) run('DELETE FROM sessions WHERE id = ?', req.sessionId);
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json(buildMe(req.user.id));
});

// ───────────── email / phone verification ─────────────
authRouter.post('/verify/send', requireAuth, (req, res) => {
  const { channel } = validate(req.body, { channel: { type: 'enum', values: ['email', 'phone'], required: true } });
  const user = get('SELECT * FROM users WHERE id = ?', req.user!.id)!;
  if (channel === 'phone' && !user.phone) throw badRequest('Add a phone number first');
  issueCode(user, channel);
  res.json({ ok: true });
});

authRouter.post('/verify/confirm', requireAuth, rateLimit('verify', 20, 15 * MINUTE), (req, res) => {
  const { channel, code } = validate(req.body, { channel: { type: 'enum', values: ['email', 'phone'], required: true }, code: { type: 'string', required: true, max: 10 } });
  if (!consumeCode(req.user!.id, channel, code)) throw badRequest('That code is incorrect or has expired');
  run(`UPDATE users SET ${channel === 'email' ? 'email_verified' : 'phone_verified'} = 1 WHERE id = ?`, req.user!.id);
  res.json(buildMe(req.user!.id));
});

// ───────────── account recovery ─────────────
authRouter.post('/recover/request', rateLimit('recover', 5, 15 * MINUTE, (r) => r.ip ?? ''), (req, res) => {
  const { identifier } = validate(req.body, { identifier: { type: 'string', required: true } });
  const user = findByIdentifier(identifier);
  if (user && user.status !== 'deleted') {
    try {
      issueCode(user, 'reset');
    } catch {
      /* rate limited — respond identically so accounts cannot be enumerated */
    }
  }
  res.json({ ok: true, message: 'If an account matches, a reset code has been sent.' });
});

authRouter.post('/recover/reset', rateLimit('reset', 10, 15 * MINUTE, (r) => r.ip ?? ''), (req, res) => {
  const { identifier, code, password } = validate(req.body, {
    identifier: { type: 'string', required: true }, code: { type: 'string', required: true, max: 10 }, password: { type: 'string', required: true, max: 128 },
  });
  const pwErr = passwordProblem(password);
  if (pwErr) throw badRequest(pwErr);
  const user = findByIdentifier(identifier);
  if (!user || !consumeCode(user.id, 'reset', code)) throw badRequest('That code is incorrect or has expired');
  tx(() => {
    run('UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL, email_verified = 1 WHERE id = ?', hashPassword(password), user.id);
    run('DELETE FROM sessions WHERE user_id = ?', user.id);
  });
  sendEmail(user.email, 'Your OmniBiz password was changed', 'Your password was just reset and all devices were signed out.');
  res.json({ ok: true });
});

authRouter.post('/password', requireAuth, (req, res) => {
  const { current, password } = validate(req.body, { current: { type: 'string', required: true, max: 128 }, password: { type: 'string', required: true, max: 128 } });
  const user = get('SELECT * FROM users WHERE id = ?', req.user!.id)!;
  if (!verifyPassword(current, user.password_hash)) throw badRequest('Your current password is incorrect');
  const pwErr = passwordProblem(password);
  if (pwErr) throw badRequest(pwErr);
  run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), user.id);
  run('DELETE FROM sessions WHERE user_id = ? AND id != ?', user.id, req.sessionId);
  res.json({ ok: true });
});

// ───────────── sessions & login history ─────────────
authRouter.get('/sessions', requireAuth, (req, res) => {
  const rows = all('SELECT id, ip, user_agent, created_at, last_seen_at FROM sessions WHERE user_id = ? AND expires_at > datetime(\'now\') ORDER BY last_seen_at DESC', req.user!.id);
  res.json({ sessions: rows.map((s) => ({ ...s, id: s.id.slice(0, 16), current: s.id === req.sessionId })) });
});

authRouter.delete('/sessions/:prefix', requireAuth, (req, res) => {
  const prefix = String(req.params.prefix);
  if (!/^[0-9a-f]{16}$/.test(prefix)) throw notFound('Session');
  run('DELETE FROM sessions WHERE user_id = ? AND substr(id, 1, 16) = ?', req.user!.id, prefix);
  res.json({ ok: true });
});

authRouter.post('/sessions/revoke-others', requireAuth, (req, res) => {
  const { changes } = run('DELETE FROM sessions WHERE user_id = ? AND id != ?', req.user!.id, req.sessionId);
  res.json({ ok: true, revoked: changes });
});

authRouter.get('/login-history', requireAuth, (req, res) => {
  res.json({ events: all('SELECT ip, user_agent, success, suspicious, created_at FROM login_events WHERE user_id = ? ORDER BY id DESC LIMIT 30', req.user!.id) });
});

// ───────────── two-factor authentication ─────────────
authRouter.post('/2fa/setup', requireAuth, (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', req.user!.id)!;
  if (user.totp_enabled) throw conflict('Two-factor authentication is already on');
  const secret = generateTotpSecret();
  run('UPDATE users SET totp_secret_enc = ? WHERE id = ?', encrypt(secret), user.id);
  res.json({ secret, otpauth_url: otpauthUrl(secret, user.username) });
});

authRouter.post('/2fa/enable', requireAuth, (req, res) => {
  const { code } = validate(req.body, { code: { type: 'string', required: true, max: 10 } });
  const user = get('SELECT * FROM users WHERE id = ?', req.user!.id)!;
  if (!user.totp_secret_enc) throw badRequest('Start two-factor setup first');
  if (!verifyTotp(decrypt(user.totp_secret_enc), code)) throw badRequest('That code is not valid — check your authenticator app’s time');
  run('UPDATE users SET totp_enabled = 1 WHERE id = ?', user.id);
  sendEmail(user.email, 'Two-factor authentication enabled', 'Two-factor authentication is now protecting your OmniBiz account.');
  res.json(buildMe(user.id));
});

authRouter.post('/2fa/disable', requireAuth, (req, res) => {
  const { password, code } = validate(req.body, { password: { type: 'string', required: true, max: 128 }, code: { type: 'string', required: true, max: 10 } });
  const user = get('SELECT * FROM users WHERE id = ?', req.user!.id)!;
  if (!verifyPassword(password, user.password_hash)) throw badRequest('Password is incorrect');
  if (!user.totp_secret_enc || !verifyTotp(decrypt(user.totp_secret_enc), code)) throw badRequest('That code is not valid');
  run('UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL WHERE id = ?', user.id);
  res.json(buildMe(user.id));
});

// ───────────── account deletion ─────────────
authRouter.post('/delete-account', requireAuth, (req, res) => {
  const { password } = validate(req.body, { password: { type: 'string', required: true, max: 128 } });
  const user = get('SELECT * FROM users WHERE id = ?', req.user!.id)!;
  if (!verifyPassword(password, user.password_hash)) throw forbidden('Password is incorrect');
  tx(() => {
    run("UPDATE users SET status = 'deleted', email = ?, username = ?, phone = NULL, display_name = 'Deleted account', avatar_url = NULL, bio = NULL WHERE id = ?",
      `deleted-${user.id}@omnibiz.invalid`, `deleted_${user.id}`, user.id);
    run('DELETE FROM sessions WHERE user_id = ?', user.id);
    run("UPDATE posts SET status = 'removed' WHERE author_id = ?", user.id);
    run("UPDATE products SET status = 'archived' WHERE seller_id = ?", user.id);
    run("UPDATE jobs SET status = 'closed' WHERE company_id = ?", user.id);
  });
  reindexUser(user.id);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Dev-only: read verification codes without an email/SMS provider.
export const devRouter = Router();
devRouter.get('/outbox', (_req, res) => {
  if (config.isProd) throw notFound();
  res.json({ messages: all('SELECT * FROM outbox ORDER BY id DESC LIMIT 50') });
});
