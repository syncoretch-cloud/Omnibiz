// Real-time delivery: the SSE stream the app listens on, and the opt-in for web push on this device.
import { Router } from 'express';
import { get, run } from '../db/index.ts';
import { badRequest, validate } from '../lib/http.ts';
import { requireAuth } from '../lib/auth.ts';
import { addLiveClient } from '../lib/live.ts';
import { vapidPublicKey } from '../services/push.ts';

export const liveRouter = Router();
export const pushRouter = Router();

liveRouter.get('/', requireAuth, (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 5000\n\nevent: ready\ndata: {}\n\n');
  const remove = addLiveClient(req.user!.id, res);
  // A comment line every 25 seconds keeps proxies from closing a quiet connection.
  const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 25_000);
  req.on('close', () => { clearInterval(beat); remove(); });
});

pushRouter.get('/key', (_req, res) => res.json({ key: vapidPublicKey() }));

pushRouter.post('/subscribe', requireAuth, (req, res) => {
  const { endpoint, keys } = validate(req.body, { endpoint: { type: 'url', required: true, max: 1000 }, keys: { type: 'json', required: true } });
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') throw badRequest('Missing push keys');
  run(
    'INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth',
    req.user!.id, endpoint, keys.p256dh, keys.auth,
  );
  res.status(201).json({ ok: true });
});

pushRouter.post('/unsubscribe', requireAuth, (req, res) => {
  const { endpoint } = validate(req.body, { endpoint: { type: 'string', required: true, max: 1000 } });
  run('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', endpoint, req.user!.id);
  res.json({ ok: true });
});

pushRouter.get('/status', requireAuth, (req, res) => {
  res.json({ devices: get('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?', req.user!.id)?.n ?? 0 });
});
