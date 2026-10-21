// Stories: a photo, video or text card that disappears 24 hours after it is shared. The bar shows the viewer's
// own story first, then accounts they follow (unseen first), then a few suggested local accounts.
import { Router } from 'express';
import { all, get, parseJson, qs, run, sqlTime, DAY, HOUR } from '../db/index.ts';
import type { Row } from '../db/index.ts';
import { badRequest, forbidden, HttpError, intParam, notFound, validate } from '../lib/http.ts';
import { requireAuth, requirePerm } from '../lib/auth.ts';
import { hit } from '../lib/ratelimit.ts';
import { followedIds } from '../services/personalization.ts';
import { userCards } from '../services/users.ts';
import { musicData } from './posts.ts';

export const storiesRouter = Router();

const ACTIVE = 'expires_at > ?';

function shapeItems(rows: Row[], viewerId: number) {
  const ids = rows.map((r) => r.id as number);
  const viewed = new Set<number>(
    ids.length ? all(`SELECT story_id FROM story_views WHERE viewer_id = ? AND story_id IN (${qs(ids.length)})`, viewerId, ...ids).map((r) => r.story_id as number) : [],
  );
  const counts = new Map<number, number>();
  const mine = rows.filter((r) => r.author_id === viewerId).map((r) => r.id as number);
  if (mine.length) {
    for (const r of all(`SELECT story_id, COUNT(*) AS n FROM story_views WHERE story_id IN (${qs(mine.length)}) AND viewer_id != ? GROUP BY story_id`, ...mine, viewerId)) {
      counts.set(r.story_id, r.n);
    }
  }
  return rows.map((r) => {
    const style = parseJson<Row>(r.style, {});
    return {
      id: r.id, media: r.media, body: r.body, bg: style.bg ?? null, music: style.music ?? null,
      created_at: r.created_at, expires_at: r.expires_at,
      viewed: viewed.has(r.id) || r.author_id === viewerId,
      mine: r.author_id === viewerId,
      ...(r.author_id === viewerId ? { view_count: counts.get(r.id) ?? 0 } : {}),
    };
  });
}

/** Groups active stories per author, oldest item first, as the viewer plays them. */
function grouped(rows: Row[], viewerId: number, suggested: Set<number>) {
  const by = new Map<number, Row[]>();
  for (const r of rows) by.set(r.author_id, [...(by.get(r.author_id) ?? []), r]);
  const cards = userCards([...by.keys()]);
  return [...by.entries()]
    .map(([authorId, list]) => {
      const items = shapeItems(list, viewerId);
      return { user: cards.get(authorId), suggested: suggested.has(authorId), items, latest_id: list[list.length - 1].id, latest_at: list[list.length - 1].created_at, all_seen: items.every((i) => i.viewed) };
    })
    .filter((g) => g.user);
}

storiesRouter.get('/', requireAuth, (req, res) => {
  const viewer = req.user!;
  const now = sqlTime();
  const authors = [viewer.id, ...followedIds(viewer.id)];
  const rows = all(`SELECT * FROM stories WHERE ${ACTIVE} AND author_id IN (${qs(authors.length)}) ORDER BY id ASC`, now, ...authors);
  const others = all(
    `SELECT s.* FROM stories s JOIN users u ON u.id = s.author_id
     WHERE s.${ACTIVE} AND u.status = 'active' AND s.author_id NOT IN (${qs(authors.length)})
     ORDER BY (u.city = ?) DESC, s.id DESC LIMIT 60`,
    now, ...authors, viewer.city ?? '',
  ).sort((a, b) => a.id - b.id);
  const suggestedIds = new Set(others.map((r) => r.author_id as number));
  const stories = grouped([...rows, ...others], viewer.id, suggestedIds)
    .sort((a, b) => (a.user!.id === viewer.id ? -1 : b.user!.id === viewer.id ? 1
      : a.suggested !== b.suggested ? (a.suggested ? 1 : -1)
      : a.all_seen !== b.all_seen ? (a.all_seen ? 1 : -1)
      : a.latest_at < b.latest_at ? 1 : -1))
    .slice(0, 30);
  res.json({ stories });
});

/** One account's active story (tapping a profile picture). */
storiesRouter.get('/user/:id', requireAuth, (req, res) => {
  const rows = all(`SELECT * FROM stories WHERE author_id = ? AND ${ACTIVE} ORDER BY id ASC`, intParam(req), sqlTime());
  res.json({ story: grouped(rows, req.user!.id, new Set())[0] ?? null });
});

storiesRouter.post('/', requirePerm('create_posts'), (req, res) => {
  const d = validate(req.body, {
    media: { type: 'string', max: 200 },
    body: { type: 'text', max: 300 },
    bg: { type: 'string', max: 40 },
    music: { type: 'json' },
  });
  if (!d.media && !d.body) throw badRequest('Add a photo, a video or some text');
  if (d.media && !/^\/uploads\/media\/[a-f0-9]{32}\.(jpg|png|webp|gif|mp4|webm)$/.test(d.media)) throw badRequest('Media must be uploaded first');
  if (!hit(`story:${req.user!.id}`, 30, HOUR)) throw new HttpError(429, 'You are adding stories too quickly. Try again later.');
  const style: Row = {};
  if (d.bg) style.bg = d.bg;
  const music = musicData(d.music);
  if (music) style.music = music;
  const { id } = run('INSERT INTO stories (author_id, media, body, style, expires_at) VALUES (?,?,?,?,?)', req.user!.id, d.media ?? null, d.body ?? '', style, sqlTime(DAY));
  res.status(201).json({ story: shapeItems([get('SELECT * FROM stories WHERE id = ?', id)!], req.user!.id)[0] });
});

storiesRouter.post('/:id/view', requireAuth, (req, res) => {
  const s = get(`SELECT id, author_id FROM stories WHERE id = ? AND ${ACTIVE}`, intParam(req), sqlTime());
  if (!s) throw notFound('Story');
  if (s.author_id !== req.user!.id) run('INSERT OR IGNORE INTO story_views (story_id, viewer_id) VALUES (?,?)', s.id, req.user!.id);
  res.json({ ok: true });
});

/** Who has seen your story. */
storiesRouter.get('/:id/viewers', requireAuth, (req, res) => {
  const s = get('SELECT id, author_id FROM stories WHERE id = ?', intParam(req));
  if (!s) throw notFound('Story');
  if (s.author_id !== req.user!.id) throw forbidden();
  const rows = all('SELECT viewer_id, viewed_at FROM story_views WHERE story_id = ? AND viewer_id != ? ORDER BY viewed_at DESC LIMIT 200', s.id, req.user!.id);
  const cards = userCards(rows.map((r) => r.viewer_id));
  res.json({ viewers: rows.map((r) => ({ ...cards.get(r.viewer_id), viewed_at: r.viewed_at })).filter((v) => v.id) });
});

storiesRouter.delete('/:id', requireAuth, (req, res) => {
  const s = get('SELECT id, author_id FROM stories WHERE id = ?', intParam(req));
  if (!s) throw notFound('Story');
  if (s.author_id !== req.user!.id) throw forbidden();
  run('DELETE FROM stories WHERE id = ?', s.id);
  res.json({ ok: true });
});
