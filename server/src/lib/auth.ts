import type { Request, Response, NextFunction } from 'express';
import { get, run, sqlTime, DAY, HOUR, MINUTE } from '../db/index.ts';
import { config } from '../config.ts';
import { randomToken, sha256 } from './crypto.ts';
import { forbidden, unauthorized } from './http.ts';
import { accountCan, staffCan } from './permissions.ts';

export const SESSION_COOKIE = 'omnibiz_session';

/** Remembered sessions last `config.sessionDays`; others end with the browser (and after 12 hours server-side). */
export function createSession(userId: number, req: Request, remember = false): string {
  const token = randomToken(32);
  run(
    'INSERT INTO sessions (id, user_id, ip, user_agent, expires_at) VALUES (?,?,?,?,?)',
    sha256(token), userId, req.ip ?? null, String(req.headers['user-agent'] ?? '').slice(0, 300), sqlTime(remember ? config.sessionDays * DAY : 12 * HOUR),
  );
  return token;
}

export function setSessionCookie(res: Response, token: string, remember = false) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    path: '/',
    // No maxAge = a browser-session cookie, so closing the browser signs you out unless you chose "Keep me logged in".
    ...(remember ? { maxAge: config.sessionDays * DAY } : {}),
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/** Resolves the session from the cookie (web) or an Authorization bearer token (mobile/API clients). */
export function loadUser(req: Request, _res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : readCookie(req, SESSION_COOKIE);
  if (!token) return next();
  const sid = sha256(token);
  const row = get(
    `SELECT s.id AS sid, s.last_seen_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > datetime('now') AND u.status != 'deleted'`,
    sid,
  );
  if (row) {
    const { sid: _sid, last_seen_at, password_hash: _ph, totp_secret_enc: _ts, ...user } = row;
    req.user = user as Request['user'];
    req.sessionId = sid;
    if (Date.parse(last_seen_at + 'Z') < Date.now() - 5 * MINUTE) {
      run("UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?", sid);
    }
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  if (req.user.status === 'suspended') return next(forbidden('Your account is suspended. Contact support for help.'));
  next();
}

export function requirePerm(perm: string) {
  return (req: Request, res: Response, next: NextFunction) =>
    requireAuth(req, res, (err?: unknown) => {
      if (err) return next(err);
      if (!accountCan(req.user!.account_type, perm)) return next(forbidden('Your account type cannot do that'));
      next();
    });
}

export function requireStaff(perm: string) {
  return (req: Request, res: Response, next: NextFunction) =>
    requireAuth(req, res, (err?: unknown) => {
      if (err) return next(err);
      if (!staffCan(req.user!.role, perm)) return next(forbidden());
      next();
    });
}

export function audit(actorId: number, action: string, targetType: string | null, targetId: number | null, details?: unknown) {
  run('INSERT INTO audit_log (actor_id, action, target_type, target_id, details) VALUES (?,?,?,?,?)', actorId, action, targetType, targetId, details ?? null);
}
