import { all, parseJson, qs, sqlTime, DAY } from '../db/index.ts';
import type { Row } from '../db/index.ts';
import { userCards } from './users.ts';
import type { UserCard } from './users.ts';
import { followedIds, interestWeights } from './personalization.ts';
import { cityCoords, distanceKm } from '../lib/geo.ts';
import { emit } from '../lib/queue.ts';

function shape(r: Row, cards: Map<number, UserCard>, liked: Set<number>, saved: Set<number>, tags: Map<number, string[]>, viewerId?: number) {
  return {
    id: r.id,
    kind: r.kind,
    body: r.body,
    media: parseJson<string[]>(r.media, []),
    data: parseJson<Row>(r.data, {}),
    category: r.category,
    city: r.city,
    status: r.status,
    created_at: r.created_at,
    like_count: r.like_count,
    comment_count: r.comment_count,
    share_count: r.share_count,
    author: cards.get(r.author_id) ?? null,
    tags: tags.get(r.id) ?? [],
    liked: liked.has(r.id),
    saved: saved.has(r.id),
    mine: viewerId === r.author_id,
  };
}

/** Adds authors, viewer state (liked/saved), tags and the original of reposts. */
export function hydratePosts(rows: Row[], viewerId?: number) {
  if (!rows.length) return [];
  const repostIds = [...new Set(rows.map((r) => r.repost_of).filter(Boolean))] as number[];
  const originals = repostIds.length ? all(`SELECT * FROM posts WHERE id IN (${qs(repostIds.length)})`, ...repostIds) : [];
  const everything = [...rows, ...originals];
  const ids = everything.map((r) => r.id as number);
  const cards = userCards(everything.map((r) => r.author_id));
  const liked = new Set<number>();
  const saved = new Set<number>();
  if (viewerId) {
    for (const r of all(`SELECT post_id FROM likes WHERE user_id = ? AND post_id IN (${qs(ids.length)})`, viewerId, ...ids)) liked.add(r.post_id);
    for (const r of all(`SELECT target_id FROM saves WHERE user_id = ? AND target_type = 'post' AND target_id IN (${qs(ids.length)})`, viewerId, ...ids)) saved.add(r.target_id);
  }
  const tags = new Map<number, string[]>();
  for (const r of all(`SELECT post_id, tag FROM post_tags WHERE post_id IN (${qs(ids.length)})`, ...ids)) {
    tags.set(r.post_id, [...(tags.get(r.post_id) ?? []), r.tag]);
  }
  const origMap = new Map(originals.map((o) => [o.id, o]));
  return rows.map((r) => {
    const p = shape(r, cards, liked, saved, tags, viewerId) as ReturnType<typeof shape> & { repost?: unknown; reason?: string };
    const o = r.repost_of ? origMap.get(r.repost_of) : null;
    if (o) p.repost = o.status === 'active' ? shape(o, cards, liked, saved, tags, viewerId) : { id: o.id, removed: true };
    return p;
  });
}

/**
 * Ranked home feed (spec §4, §31): relevant first + recent + trusted accounts + local opportunities.
 * Candidate generation and scoring run per request here; at scale they move to a feed worker that
 * precomputes candidate sets and caches them (Redis sorted sets) per user.
 */
export function rankedFeed(viewer: Row | undefined, offset: number, limit: number) {
  const byId = new Map<number, Row>();
  for (const r of all("SELECT * FROM posts WHERE status = 'active' ORDER BY id DESC LIMIT 600")) byId.set(r.id, r);
  if (viewer) {
    const followedPosts = all(
      `SELECT * FROM posts WHERE status = 'active' AND created_at > ? AND author_id IN (SELECT followee_id FROM follows WHERE follower_id = ?)
       ORDER BY id DESC LIMIT 300`,
      sqlTime(-60 * DAY), viewer.id,
    );
    for (const r of followedPosts) byId.set(r.id, r);
  }
  const candidates = [...byId.values()];
  if (!candidates.length) return { items: [], hasMore: false };

  const weights = viewer ? interestWeights(viewer.id) : new Map<string, number>();
  const follows = viewer ? followedIds(viewer.id) : new Set<number>();
  const cards = userCards(candidates.map((r) => r.author_id));
  const ids = candidates.map((r) => r.id);
  const tags = new Map<number, string[]>();
  for (const r of all(`SELECT post_id, tag FROM post_tags WHERE post_id IN (${qs(ids.length)})`, ...ids)) {
    tags.set(r.post_id, [...(tags.get(r.post_id) ?? []), r.tag]);
  }
  const viewerCity = (viewer?.city ?? '').toLowerCase();
  const viewerCoords = viewer?.lat != null ? { lat: viewer.lat, lng: viewer.lng } : cityCoords(viewer?.city);
  const now = Date.now();

  const scored = candidates.map((p) => {
    const author = cards.get(p.author_id);
    const reasons: [number, string][] = [];
    const interest = (weights.get(p.category) ?? 0) * 35;
    const tagBoost = Math.max(0, ...(tags.get(p.id) ?? []).map((t) => weights.get(t) ?? 0)) * 10;
    if (interest >= 15) reasons.push([interest, `Based on your interest in ${p.category}`]);
    let follow = 0;
    if (follows.has(p.author_id)) {
      follow = 30;
      // A concrete relationship explains a post better than an inferred interest, so it wins the label.
      reasons.push([100, `You follow ${author?.display_name ?? 'this account'}`]);
    }
    if (viewer && p.author_id === viewer.id) follow = 5;
    let local = 0;
    const postCity = (p.city ?? author?.city ?? '').toLowerCase();
    if (viewerCity && postCity === viewerCity) local = 12;
    else if (viewerCoords && postCity) {
      const pc = cityCoords(postCity);
      if (pc && distanceKm(viewerCoords, pc) < 100) local = 6;
    }
    if (local) reasons.push([local, `Near you in ${p.city ?? author?.city}`]);
    const trust = author?.verified ? 8 : 0;
    const engagement = Math.log1p(p.like_count + 2 * p.comment_count + 3 * p.share_count) * 4;
    if (engagement > 12) reasons.push([engagement, 'Popular right now']);
    const ageHours = (now - Date.parse(p.created_at.replace(' ', 'T') + 'Z')) / 3_600_000;
    const recency = 35 * Math.exp(-Math.max(0, ageHours) / 36);
    const score = interest + tagBoost + follow + local + trust + engagement + recency;
    reasons.sort((a, b) => b[0] - a[0]);
    return { p, score, reason: reasons[0]?.[1] };
  });

  // Diversity: dampen repeated authors so one prolific account cannot take over the feed.
  scored.sort((a, b) => b.score - a.score);
  const seen = new Map<number, number>();
  for (const s of scored) {
    const n = seen.get(s.p.author_id) ?? 0;
    s.score *= 0.8 ** n;
    seen.set(s.p.author_id, n + 1);
  }
  scored.sort((a, b) => b.score - a.score);

  const slice = scored.slice(offset, offset + limit);
  const items = hydratePosts(slice.map((s) => s.p), viewer?.id);
  slice.forEach((s, i) => (items[i].reason = s.reason));
  emit('feed.impressions', { viewerId: viewer?.id ?? null, posts: slice.map((s) => ({ id: s.p.id, author: s.p.author_id })) });
  return { items, hasMore: scored.length > offset + limit };
}
