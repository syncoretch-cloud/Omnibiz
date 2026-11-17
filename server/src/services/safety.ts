// Account safety: suspensions, strikes and appeals. Staff routes and the automatic strike rules share these.
import { get, run, sqlTime, DAY } from '../db/index.ts';
import type { Row } from '../db/index.ts';
import { audit } from '../lib/auth.ts';
import { sendEmail } from '../lib/outbox.ts';
import { notify } from './notify.ts';
import { reindexUser } from './search-index.ts';

/** Warnings count for this long; after that they stop counting towards a ban. */
export const STRIKE_WINDOW_DAYS = 90;
/** Active strikes that trigger an automatic timed ban, and the ones that trigger an open-ended suspension. */
export const STRIKES_FOR_BAN = 3;
export const STRIKES_FOR_SUSPENSION = 5;
export const AUTO_BAN_DAYS = 7;

/** Bans an account (for `days`, or until staff restore it) and tells the person why: a notification, a push and an email. */
export function suspendUser(actorId: number, user: Row, reason: string, days: number | null | undefined) {
  const until = days ? sqlTime(days * DAY) : null;
  // Sessions stay: the next request is refused, and the app swaps itself for the full-screen ban notice at once.
  run("UPDATE users SET status = 'suspended', suspended_reason = ?, suspended_until = ? WHERE id = ?", reason, until, user.id);
  reindexUser(user.id);
  audit(actorId, 'user.suspend', 'user', user.id, { reason, days: days ?? null });
  const when = days ? `Your account will be restored automatically in ${days} day${days === 1 ? '' : 's'}.` : 'Your account stays suspended until our team restores it.';
  notify([user.id], { type: 'moderation', title: days ? `You have been banned for ${days} day${days === 1 ? '' : 's'}` : 'Your account has been banned', body: reason, link: '/' });
  sendEmail(user.email, 'Your OmniBiz account has been banned', `Reason: ${reason}\n\n${when}\nIf you think this is a mistake, sign in and use the appeal form on the suspension page.`);
}

export function activeStrikes(userId: number): number {
  return get(`SELECT COUNT(*) AS n FROM strikes WHERE user_id = ? AND created_at > ?`, userId, sqlTime(-STRIKE_WINDOW_DAYS * DAY))?.n ?? 0;
}

/** Records a warning. Repeat warnings escalate by themselves: a timed ban, then a suspension until staff step in. */
export function issueStrike(actorId: number, user: Row, reason: string) {
  run('INSERT INTO strikes (user_id, reason, issued_by) VALUES (?,?,?)', user.id, reason, actorId);
  const count = activeStrikes(user.id);
  audit(actorId, 'user.strike', 'user', user.id, { reason, active: count });
  if (count >= STRIKES_FOR_SUSPENSION) {
    suspendUser(actorId, user, `${count} warnings in ${STRIKE_WINDOW_DAYS} days. Latest: ${reason}`, null);
    return { strikes: count, action: 'suspended' as const };
  }
  if (count >= STRIKES_FOR_BAN) {
    suspendUser(actorId, user, `${count} warnings in ${STRIKE_WINDOW_DAYS} days. Latest: ${reason}`, AUTO_BAN_DAYS);
    return { strikes: count, action: 'banned' as const, days: AUTO_BAN_DAYS };
  }
  const left = STRIKES_FOR_BAN - count;
  notify([user.id], { type: 'moderation', title: 'You have received a warning', body: `${reason}. ${left} more warning${left === 1 ? '' : 's'} will lead to a ${AUTO_BAN_DAYS}-day ban.`, link: '/notifications' });
  sendEmail(user.email, 'A warning about your OmniBiz account', `${reason}\n\nThis is warning ${count} of ${STRIKES_FOR_BAN}. At ${STRIKES_FOR_BAN} warnings your account is banned for ${AUTO_BAN_DAYS} days.`);
  return { strikes: count, action: 'warned' as const };
}
