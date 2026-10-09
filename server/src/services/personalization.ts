// Personalization engine (spec §31): builds a per-user interest vector from
// interests + profession + follows + saved content + searches + views + applications.
import { all, get, parseJson, run, sqlTime, DAY } from '../db/index.ts';

export function recordActivity(
  userId: number | undefined,
  kind: string,
  info: { category?: string | null; term?: string | null; targetType?: string; targetId?: number } = {},
) {
  if (!userId) return;
  run(
    'INSERT INTO activity (user_id, kind, category, term, target_type, target_id) VALUES (?,?,?,?,?,?)',
    userId, kind, info.category ?? null, info.term?.slice(0, 100) ?? null, info.targetType ?? null, info.targetId ?? null,
  );
}

const ACTIVITY_WEIGHT: Record<string, number> = {
  apply: 1.2, save: 0.8, like: 0.5, comment: 0.6, view_job: 0.4, view_product: 0.4, view_business: 0.4, search: 0.3,
};

/** Interest weights per category slug, normalised to 0..1. */
export function interestWeights(userId: number): Map<string, number> {
  const w = new Map<string, number>();
  const add = (slug: string | null | undefined, v: number, cap = Infinity) => {
    if (!slug) return;
    w.set(slug, Math.min(cap, (w.get(slug) ?? 0) + v));
  };

  for (const r of all('SELECT slug FROM user_interests WHERE user_id = ?', userId)) add(r.slug, 3);

  const p = get('SELECT preferred_industries FROM profiles WHERE user_id = ?', userId);
  for (const s of parseJson<string[]>(p?.preferred_industries, [])) add(s, 2);

  for (const r of all('SELECT b.category FROM follows f JOIN businesses b ON b.user_id = f.followee_id WHERE f.follower_id = ?', userId)) {
    add(r.category, 1.5, 6);
  }

  const recent = all(
    'SELECT kind, category FROM activity WHERE user_id = ? AND category IS NOT NULL AND created_at > ? ORDER BY id DESC LIMIT 500',
    userId, sqlTime(-60 * DAY),
  );
  for (const r of recent) add(r.category, ACTIVITY_WEIGHT[r.kind] ?? 0.3, 8);

  const max = Math.max(1, ...w.values());
  for (const [k, v] of w) w.set(k, v / max);
  return w;
}

export function followedIds(userId: number): Set<number> {
  return new Set(all('SELECT followee_id FROM follows WHERE follower_id = ?', userId).map((r) => r.followee_id as number));
}
