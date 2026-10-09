import { Router } from 'express';
import { all, get, qs, run } from '../db/index.ts';
import { paging, validate } from '../lib/http.ts';
import { requireAuth } from '../lib/auth.ts';
import { userCards } from '../services/users.ts';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

const GROUPS: Record<string, string[]> = {
  jobs: ['job_match', 'hiring', 'application', 'application_update'],
  business: ['announcement', 'new_product', 'order'],
  social: ['follow', 'like', 'comment', 'mention', 'repost'],
  system: ['security', 'verification', 'moderation', 'system'],
};

notificationsRouter.get('/', (req, res) => {
  const { limit, offset } = paging(req, 30, 100);
  const group = GROUPS[String(req.query.group ?? '')];
  const unread = req.query.unread === '1';
  const rows = all(
    `SELECT * FROM notifications WHERE user_id = ? ${group ? `AND type IN (${qs(group.length)})` : ''} ${unread ? 'AND read_at IS NULL' : ''}
     ORDER BY id DESC LIMIT ? OFFSET ?`,
    req.user!.id, ...(group ?? []), limit + 1, offset,
  );
  const cards = userCards(rows.map((r) => r.actor_id));
  res.json({
    items: rows.slice(0, limit).map((r) => ({ ...r, actor: r.actor_id ? cards.get(r.actor_id) ?? null : null })),
    hasMore: rows.length > limit,
    unread: get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', req.user!.id)!.n,
  });
});

notificationsRouter.get('/count', (req, res) => {
  res.json({ unread: get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', req.user!.id)!.n });
});

notificationsRouter.post('/read', (req, res) => {
  const { ids, all: everything } = validate(req.body, { ids: { type: 'ints', max: 200 }, all: { type: 'bool' } });
  if (everything) run("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL", req.user!.id);
  else if (ids?.length) run(`UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND id IN (${qs(ids.length)})`, req.user!.id, ...ids);
  res.json({ unread: get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', req.user!.id)!.n });
});
