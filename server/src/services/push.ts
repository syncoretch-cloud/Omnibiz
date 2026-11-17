// Web push: notifications that reach a phone or desktop even when OmniBiz is closed. The VAPID key pair is
// generated once and kept in the settings table; each browser that opts in is stored in push_subscriptions.
import * as webpush from 'web-push';
import { all, run } from '../db/index.ts';
import { config } from '../config.ts';
import { getSetting, setSetting } from './settings.ts';

let ready = false;

function keys() {
  let pub = getSetting('vapid_public', '');
  let priv = getSetting('vapid_private', '');
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    pub = k.publicKey;
    priv = k.privateKey;
    setSetting('vapid_public', pub);
    setSetting('vapid_private', priv);
  }
  if (!ready) {
    webpush.setVapidDetails(`mailto:${config.mail.user || 'admin@omnibiz.local'}`, pub, priv);
    ready = true;
  }
  return { pub, priv };
}

export const vapidPublicKey = () => keys().pub;

export interface PushPayload { title: string; body?: string | null; link?: string | null }

/** Fire-and-forget: a failed or expired subscription never affects the request that caused the notification. */
export function sendPush(userIds: number[], payload: PushPayload) {
  if (!userIds.length || process.env.NODE_ENV === 'test') return;
  const subs = all(`SELECT * FROM push_subscriptions WHERE user_id IN (${userIds.map(() => '?').join(',')})`, ...userIds);
  if (!subs.length) return;
  keys();
  const body = JSON.stringify({ title: payload.title, body: payload.body ?? '', link: payload.link ?? '/' });
  for (const s of subs) {
    webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 3600 }).catch((e: { statusCode?: number }) => {
      if (e.statusCode === 404 || e.statusCode === 410) run('DELETE FROM push_subscriptions WHERE id = ?', s.id);
    });
  }
}
