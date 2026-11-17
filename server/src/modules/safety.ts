// Account safety: appeals against a suspension, and staff tools for warnings and reviewing appeals.
import { Router } from 'express';
import { all, get, run } from '../db/index.ts';
import { badRequest, forbidden, intParam, notFound, paging, qStr, unauthorized, validate } from '../lib/http.ts';
import { audit, requireStaff } from '../lib/auth.ts';
import { STAFF_RANK } from '../lib/permissions.ts';
import { sendEmail } from '../lib/outbox.ts';
import { userCards } from '../services/users.ts';
import { notify } from '../services/notify.ts';
import { reindexUser } from '../services/search-index.ts';
import { STRIKES_FOR_BAN, STRIKE_WINDOW_DAYS, activeStrikes, clearStrikes, issueStrike } from '../services/safety.ts';

export const appealsRouter = Router();
export const safetyAdminRouter = Router();

// ───────────── a suspended person's appeal ─────────────
// Suspended accounts are refused by requireAuth everywhere else, so these routes only need the signed-in session.
appealsRouter.get('/', (req, res) => {
  if (!req.user) throw unauthorized();
  res.json({
    items: all('SELECT id, message, status, response, created_at, handled_at FROM appeals WHERE user_id = ? ORDER BY id DESC LIMIT 10', req.user.id),
    strikes: activeStrikes(req.user.id),
  });
});

appealsRouter.post('/', (req, res) => {
  if (!req.user) throw unauthorized();
  if (req.user.status !== 'suspended') throw badRequest('Only a suspended account can appeal');
  if (get("SELECT 1 AS x FROM appeals WHERE user_id = ? AND status = 'pending'", req.user.id)) throw badRequest('Your appeal is already waiting for review');
  const { message } = validate(req.body, { message: { type: 'text', required: true, min: 20, max: 2000 } });
  const { id } = run('INSERT INTO appeals (user_id, message) VALUES (?,?)', req.user.id, message);
  res.status(201).json({ id });
});

// ───────────── staff ─────────────
safetyAdminRouter.get('/appeals', requireStaff('users.suspend'), (req, res) => {
  const status = qStr(req, 'status') ?? 'pending';
  const { limit, offset } = paging(req, 30);
  const rows = all('SELECT * FROM appeals WHERE status = ? ORDER BY id DESC LIMIT ? OFFSET ?', status, limit, offset);
  const cards = userCards(rows.map((r) => r.user_id));
  const users = new Map(all(`SELECT id, status, suspended_reason, suspended_until FROM users WHERE id IN (${rows.map(() => '?').join(',') || 'NULL'})`, ...rows.map((r) => r.user_id)).map((u) => [u.id, u]));
  res.json({ items: rows.map((r) => ({ ...r, user: cards.get(r.user_id), account: users.get(r.user_id) })) });
});

safetyAdminRouter.post('/appeals/:id', requireStaff('users.suspend'), (req, res) => {
  const { decision, response } = validate(req.body, { decision: { type: 'enum', values: ['approve', 'reject'], required: true }, response: { type: 'text', required: true, min: 2, max: 1000 } });
  const appeal = get('SELECT * FROM appeals WHERE id = ?', intParam(req));
  if (!appeal) throw notFound('Appeal');
  if (appeal.status !== 'pending') throw badRequest('This appeal has already been decided');
  const user = get('SELECT * FROM users WHERE id = ?', appeal.user_id)!;
  if (STAFF_RANK.indexOf(req.user!.role) <= STAFF_RANK.indexOf(user.role)) throw forbidden('You cannot act on an account with an equal or higher role');
  run("UPDATE appeals SET status = ?, response = ?, handled_by = ?, handled_at = datetime('now') WHERE id = ?", decision === 'approve' ? 'approved' : 'rejected', response, req.user!.id, appeal.id);
  if (decision === 'approve') {
    run("UPDATE users SET status = 'active', suspended_reason = NULL, suspended_until = NULL WHERE id = ? AND status = 'suspended'", user.id);
    reindexUser(user.id);
    clearStrikes(user.id);
    notify([user.id], { type: 'moderation', title: 'Your appeal was approved', body: `Review note: ${response}` });
  }
  audit(req.user!.id, `appeal.${decision}`, 'user', user.id, { response });
  sendEmail(user.email, decision === 'approve' ? 'Your OmniBiz appeal was approved' : 'Your OmniBiz appeal was not approved', `${response}\n\n${decision === 'approve' ? 'Your account is active again.' : 'Your suspension stays in place.'}`);
  res.json({ ok: true });
});

safetyAdminRouter.get('/users/:id/strikes', requireStaff('users.view'), (req, res) => {
  const id = intParam(req);
  res.json({
    active: activeStrikes(id),
    ban_at: STRIKES_FOR_BAN,
    window_days: STRIKE_WINDOW_DAYS,
    items: all('SELECT s.id, s.reason, s.created_at, s.cleared, u.display_name AS issued_by FROM strikes s LEFT JOIN users u ON u.id = s.issued_by WHERE s.user_id = ? ORDER BY s.id DESC LIMIT 30', id),
  });
});

safetyAdminRouter.post('/users/:id/warn', requireStaff('users.suspend'), (req, res) => {
  const { reason } = validate(req.body, { reason: { type: 'text', required: true, min: 3, max: 500 } });
  const user = get("SELECT * FROM users WHERE id = ? AND status != 'deleted'", intParam(req));
  if (!user) throw notFound('User');
  if (user.id === req.user!.id) throw badRequest('You cannot warn yourself');
  if (STAFF_RANK.indexOf(req.user!.role) <= STAFF_RANK.indexOf(user.role)) throw forbidden('You cannot act on an account with an equal or higher role');
  res.json(issueStrike(req.user!.id, user, reason));
});
