// Visibility: accounts that have paid for a plan, or for verification, are shown ahead of those that have not.
// A person's level is their plan's boost (0 none, 1 priority, 2 top priority) plus 1 when verified, so 0 to 3.
// Lists keep their own order inside a level, which means free accounts are still shown, just after paying ones.
import { all, qs, sqlTime } from '../db/index.ts';

export const MAX_LEVEL = 3;

/** The boost of each person's current paid plan (people on the free plan are left out). */
export function planBoosts(userIds: (number | null | undefined)[]): Map<number, number> {
  const ids = [...new Set(userIds.filter((x): x is number => typeof x === 'number'))];
  const boost = new Map<number, number>();
  if (!ids.length) return boost;
  // The newest active, unexpired subscription decides the plan.
  const subs = all(
    `SELECT s.user_id, p.boost FROM subscriptions s JOIN plans p ON p.id = s.plan_id
     WHERE s.user_id IN (${qs(ids.length)}) AND s.status = 'active' AND (s.renews_at IS NULL OR s.renews_at > ?) ORDER BY s.id`,
    ...ids, sqlTime(),
  );
  for (const s of subs) boost.set(s.user_id, s.boost);
  return boost;
}

export function visibilityLevels(userIds: (number | null | undefined)[]): Map<number, number> {
  const ids = [...new Set(userIds.filter((x): x is number => typeof x === 'number'))];
  const out = new Map<number, number>();
  if (!ids.length) return out;
  for (const r of all(`SELECT u.id, (COALESCE(b.verified, 0) OR u.verified) AS verified FROM users u LEFT JOIN businesses b ON b.user_id = u.id WHERE u.id IN (${qs(ids.length)})`, ...ids)) {
    out.set(r.id, r.verified ? 1 : 0);
  }
  for (const [id, b] of planBoosts(ids)) out.set(id, (out.get(id) ?? 0) + b);
  return out;
}

/** Stable sort: higher-level owners first, everything else keeps the order the list already had. */
export function boostSort<T>(rows: T[], owner: (r: T) => number): T[] {
  const levels = visibilityLevels(rows.map(owner));
  return rows
    .map((r, i) => ({ r, i, l: levels.get(owner(r)) ?? 0 }))
    .sort((a, b) => b.l - a.l || a.i - b.i)
    .map((x) => x.r);
}
