import { Router } from 'express';
import type { Request } from 'express';
import { all, get, parseJson, qs, run, tx, sqlTime, HOUR, MINUTE } from '../db/index.ts';
import type { Row } from '../db/index.ts';
import { badRequest, forbidden, HttpError, intParam, notFound, paging, qStr, validate } from '../lib/http.ts';
import { requireAuth, requirePerm } from '../lib/auth.ts';
import { hit } from '../lib/ratelimit.ts';
import { POST_KINDS } from '../lib/constants.ts';
import { staffCan } from '../lib/permissions.ts';
import { emit } from '../lib/queue.ts';
import { hydratePosts, rankedFeed } from '../services/posts.ts';
import { reindexPost, unindex } from '../services/search-index.ts';
import { userCards } from '../services/users.ts';
import { notify } from '../services/notify.ts';
import { recordActivity } from '../services/personalization.ts';
import { hydrateProducts } from './products.ts';
import { hydrateJobs } from './jobs.ts';

export const postsRouter = Router();
export const savesRouter = Router();

const BUSINESS_ONLY_KINDS = new Set(['product', 'service', 'promotion', 'offer', 'hiring']);
const ASPECTS = ['original', '1:1', '4:5', '16:9'];

/** A post's soundtrack: a track from the built-in library, or an audio file the author uploaded. */
export function musicData(raw: unknown): Row | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Row;
  const title = typeof m.title === 'string' ? m.title.trim().slice(0, 80) : '';
  if (!title) return null;
  const out: Row = { title, artist: typeof m.artist === 'string' ? m.artist.trim().slice(0, 60) : '' };
  if (typeof m.track === 'string' && /^[a-z0-9-]{2,40}$/.test(m.track)) out.track = m.track;
  else if (typeof m.url === 'string' && /^\/uploads\/media\/[a-f0-9]{32}\.(mp3|m4a|aac|ogg|wav)$/.test(m.url)) out.url = m.url;
  else return null;
  const start = Number(m.start);
  out.start = Number.isFinite(start) ? Math.max(0, Math.min(600, Math.round(start))) : 0;
  return out;
}

/** Spam protection: per-user rate, duplicate detection and link limits. */
function spamCheck(userId: number, body: string) {
  if (!hit(`post:${userId}`, 20, HOUR)) throw new HttpError(429, 'You are posting too quickly. Try again later.');
  const links = (body.match(/https?:\/\//g) ?? []).length;
  if (links > 5) throw badRequest('Posts can contain at most 5 links');
  if (body.length > 20 && get('SELECT 1 AS x FROM posts WHERE author_id = ? AND body = ? AND created_at > ?', userId, body, sqlTime(-30 * MINUTE))) {
    throw badRequest('You just posted that');
  }
}

export function createPost(author: Row, input: { kind: string; body: string; media?: string[]; category?: string | null; data?: Row; repost_of?: number | null }) {
  const tags = [...new Set((input.body.match(/#([\p{L}\p{N}_]{2,40})/gu) ?? []).map((t) => t.slice(1).toLowerCase()))].slice(0, 15);
  const handles = [...new Set((input.body.match(/@([a-zA-Z0-9_.]{3,30})/g) ?? []).map((m) => m.slice(1)))].slice(0, 20);
  const mentioned = handles.length ? all(`SELECT id FROM users WHERE username IN (${qs(handles.length)}) AND status = 'active'`, ...handles).map((r) => r.id as number) : [];
  const biz = get('SELECT category FROM businesses WHERE user_id = ?', author.id);
  const id = tx(() => {
    const { id } = run(
      'INSERT INTO posts (author_id, kind, body, media, data, category, city, repost_of) VALUES (?,?,?,?,?,?,?,?)',
      author.id, input.kind, input.body, input.media ?? [], input.data ?? {}, input.category ?? biz?.category ?? null, author.city ?? null, input.repost_of ?? null,
    );
    for (const t of tags) run('INSERT OR IGNORE INTO post_tags (post_id, tag) VALUES (?,?)', id, t);
    for (const m of mentioned) run('INSERT OR IGNORE INTO post_mentions (post_id, user_id) VALUES (?,?)', id, m);
    return id;
  });
  reindexPost(id);
  emit('post.created', { postId: id, mentions: mentioned });
  return id;
}

function loadPost(req: Request) {
  const p = get('SELECT * FROM posts WHERE id = ?', intParam(req));
  if (!p) throw notFound('Post');
  const isMod = req.user && staffCan(req.user.role, 'content');
  if (p.status !== 'active' && !isMod && req.user?.id !== p.author_id) throw notFound('Post');
  return p;
}

// ───────────── feed & listing ─────────────
postsRouter.get('/feed', (req, res) => {
  const { limit, offset } = paging(req, 15, 30);
  res.json(rankedFeed(req.user, offset, limit));
});

postsRouter.get('/', (req, res) => {
  const { limit, offset } = paging(req, 20);
  const where = ["p.status = 'active'"];
  const params: unknown[] = [];
  const author = Number(req.query.author);
  if (author) { where.push('p.author_id = ?'); params.push(author); }
  const tag = qStr(req, 'tag');
  if (tag) { where.push('p.id IN (SELECT post_id FROM post_tags WHERE tag = ?)'); params.push(tag.toLowerCase().replace(/^#/, '')); }
  const kind = qStr(req, 'kind');
  if (kind) { where.push('p.kind = ?'); params.push(kind); }
  const rows = all(`SELECT p.* FROM posts p WHERE ${where.join(' AND ')} ORDER BY p.id DESC LIMIT ? OFFSET ?`, ...params, limit + 1, offset);
  res.json({ items: hydratePosts(rows.slice(0, limit), req.user?.id), hasMore: rows.length > limit });
});

postsRouter.get('/trending-tags', (_req, res) => {
  const rows = all(
    `SELECT t.tag, COUNT(*) AS n FROM post_tags t JOIN posts p ON p.id = t.post_id
     WHERE p.status = 'active' AND p.created_at > ? GROUP BY t.tag ORDER BY n DESC LIMIT 10`,
    sqlTime(-14 * 24 * HOUR),
  );
  res.json({ tags: rows });
});

postsRouter.get('/:id', (req, res) => {
  const p = loadPost(req);
  const [post] = hydratePosts([p], req.user?.id);
  res.json({ post });
});

// ───────────── create / delete ─────────────
postsRouter.post('/', requirePerm('create_posts'), (req, res) => {
  const d = validate(req.body, {
    kind: { type: 'enum', values: POST_KINDS },
    body: { type: 'text', max: 5000 },
    media: { type: 'strings', max: 10 },
    category: { type: 'string', max: 50 },
    data: { type: 'json' },
  });
  const kind = d.kind ?? 'text';
  if (BUSINESS_ONLY_KINDS.has(kind) && req.user!.account_type === 'personal') throw forbidden('Only business accounts can publish that type of post');
  const body = d.body ?? '';
  const media = (d.media ?? []) as string[];
  if (!body && !media.length) throw badRequest('Write something or add a photo or video');
  if (media.some((m) => !m.startsWith('/uploads/media/'))) throw badRequest('Media must be uploaded first');
  spamCheck(req.user!.id, body);
  // Only keep known reference keys so clients cannot inject arbitrary data.
  const raw = (d.data ?? {}) as Row;
  const data: Row = {};
  if (Number.isInteger(raw.product_id) && get('SELECT 1 AS x FROM products WHERE id = ? AND seller_id = ?', raw.product_id, req.user!.id)) data.product_id = raw.product_id;
  if (Number.isInteger(raw.job_id) && get('SELECT 1 AS x FROM jobs WHERE id = ? AND company_id = ?', raw.job_id, req.user!.id)) data.job_id = raw.job_id;
  if (typeof raw.event_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw.event_date)) data.event_date = raw.event_date.slice(0, 16);
  if (typeof raw.event_location === 'string') data.event_location = raw.event_location.slice(0, 120);
  if (typeof raw.ends_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.ends_on)) data.ends_on = raw.ends_on;
  // Instagram-style details: display ratio, alt text, location, music, tagged people and audience settings.
  if (typeof raw.aspect === 'string' && ASPECTS.includes(raw.aspect)) data.aspect = raw.aspect;
  if (Array.isArray(raw.alt) && media.length) data.alt = raw.alt.slice(0, media.length).map((a: unknown) => (typeof a === 'string' ? a.trim().slice(0, 300) : ''));
  if (typeof raw.location === 'string' && raw.location.trim()) data.location = raw.location.trim().slice(0, 80);
  const music = musicData(raw.music);
  if (music) data.music = music;
  if (raw.hide_likes === true) data.hide_likes = true;
  if (raw.comments_off === true) data.comments_off = true;
  let tagged: number[] = [];
  if (Array.isArray(raw.tagged)) {
    const ids = [...new Set(raw.tagged.filter((x: unknown) => Number.isInteger(x) && x !== req.user!.id))].slice(0, 20) as number[];
    tagged = ids.length ? all(`SELECT id FROM users WHERE id IN (${qs(ids.length)}) AND status = 'active'`, ...ids).map((r) => r.id as number) : [];
    if (tagged.length) data.tagged = tagged;
  }
  const id = createPost(req.user!, { kind, body, media, category: d.category, data });
  if (tagged.length) notify(tagged, { type: 'mention', title: `${req.user!.display_name} tagged you in a post`, body: body.slice(0, 100), link: `/posts/${id}`, actorId: req.user!.id });
  const [post] = hydratePosts([get('SELECT * FROM posts WHERE id = ?', id)!], req.user!.id);
  res.status(201).json({ post });
});

postsRouter.delete('/:id', requireAuth, (req, res) => {
  const p = loadPost(req);
  if (p.author_id !== req.user!.id && !staffCan(req.user!.role, 'content')) throw forbidden();
  run("UPDATE posts SET status = 'removed' WHERE id = ?", p.id);
  unindex('post', p.id);
  res.json({ ok: true });
});

// ───────────── interactions ─────────────
/** Current like count, or null when the author hid it from everyone else. */
function likeCount(p: Row, viewerId: number) {
  if (parseJson<Row>(p.data, {}).hide_likes && p.author_id !== viewerId) return null;
  return get('SELECT like_count FROM posts WHERE id = ?', p.id)!.like_count;
}

postsRouter.post('/:id/like', requirePerm('interact'), (req, res) => {
  const p = loadPost(req);
  const { changes } = run('INSERT OR IGNORE INTO likes (user_id, post_id) VALUES (?,?)', req.user!.id, p.id);
  if (changes) {
    run('UPDATE posts SET like_count = like_count + 1 WHERE id = ?', p.id);
    recordActivity(req.user!.id, 'like', { category: p.category, targetType: 'post', targetId: p.id });
    if (hit(`likenotify:${p.id}:${req.user!.id}`, 1, 24 * HOUR)) {
      notify([p.author_id], { type: 'like', title: `${req.user!.display_name} liked your post`, body: p.body.slice(0, 100), link: `/posts/${p.id}`, actorId: req.user!.id });
    }
  }
  res.json({ liked: true, like_count: likeCount(p, req.user!.id) });
});

postsRouter.delete('/:id/like', requireAuth, (req, res) => {
  const p = loadPost(req);
  const { changes } = run('DELETE FROM likes WHERE user_id = ? AND post_id = ?', req.user!.id, p.id);
  if (changes) run('UPDATE posts SET like_count = MAX(0, like_count - 1) WHERE id = ?', p.id);
  res.json({ liked: false, like_count: likeCount(p, req.user!.id) });
});

postsRouter.get('/:id/comments', (req, res) => {
  const p = loadPost(req);
  const { limit, offset } = paging(req, 30, 100);
  const rows = all("SELECT * FROM comments WHERE post_id = ? AND status = 'active' ORDER BY id ASC LIMIT ? OFFSET ?", p.id, limit, offset);
  const cards = userCards(rows.map((r) => r.author_id));
  res.json({ comments: rows.map((c) => ({ id: c.id, body: c.body, created_at: c.created_at, author: cards.get(c.author_id), mine: c.author_id === req.user?.id })) });
});

postsRouter.post('/:id/comments', requirePerm('interact'), (req, res) => {
  const p = loadPost(req);
  if (parseJson<Row>(p.data, {}).comments_off && p.author_id !== req.user!.id) throw forbidden('Comments are turned off for this post');
  const { body } = validate(req.body, { body: { type: 'text', required: true, max: 2000 } });
  if (!hit(`comment:${req.user!.id}`, 60, HOUR)) throw new HttpError(429, 'You are commenting too quickly');
  const { id } = run('INSERT INTO comments (post_id, author_id, body) VALUES (?,?,?)', p.id, req.user!.id, body);
  run('UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?', p.id);
  recordActivity(req.user!.id, 'comment', { category: p.category, targetType: 'post', targetId: p.id });
  notify([p.author_id], { type: 'comment', title: `${req.user!.display_name} commented on your post`, body: body.slice(0, 140), link: `/posts/${p.id}`, actorId: req.user!.id });
  const handles = [...new Set((body.match(/@([a-zA-Z0-9_.]{3,30})/g) ?? []).map((m: string) => m.slice(1)))].slice(0, 10) as string[];
  if (handles.length) {
    const ids = all(`SELECT id FROM users WHERE username IN (${qs(handles.length)})`, ...handles).map((r) => r.id as number);
    notify(ids, { type: 'mention', title: `${req.user!.display_name} mentioned you in a comment`, body: body.slice(0, 140), link: `/posts/${p.id}`, actorId: req.user!.id });
  }
  res.status(201).json({ comment: { id, body, created_at: sqlTime(), author: userCards([req.user!.id]).get(req.user!.id), mine: true } });
});

postsRouter.delete('/comments/:id', requireAuth, (req, res) => {
  const c = get('SELECT c.*, p.author_id AS post_author FROM comments c JOIN posts p ON p.id = c.post_id WHERE c.id = ?', intParam(req));
  if (!c) throw notFound('Comment');
  if (![c.author_id, c.post_author].includes(req.user!.id) && !staffCan(req.user!.role, 'content')) throw forbidden();
  run("UPDATE comments SET status = 'removed' WHERE id = ?", c.id);
  run('UPDATE posts SET comment_count = MAX(0, comment_count - 1) WHERE id = ?', c.post_id);
  res.json({ ok: true });
});

postsRouter.post('/:id/repost', requirePerm('interact'), (req, res) => {
  const p = loadPost(req);
  const original = p.repost_of ? get('SELECT * FROM posts WHERE id = ?', p.repost_of) ?? p : p;
  const { body } = validate(req.body, { body: { type: 'text', max: 2000 } });
  if (req.user!.account_type === 'customer' && body) throw forbidden('Customer accounts can repost without commentary only');
  spamCheck(req.user!.id, body ?? '');
  const id = createPost(req.user!, { kind: 'text', body: body ?? '', repost_of: original.id, category: original.category });
  run('UPDATE posts SET share_count = share_count + 1 WHERE id = ?', original.id);
  notify([original.author_id], { type: 'repost', title: `${req.user!.display_name} reposted your post`, link: `/posts/${id}`, actorId: req.user!.id });
  const [post] = hydratePosts([get('SELECT * FROM posts WHERE id = ?', id)!], req.user!.id);
  res.status(201).json({ post });
});

postsRouter.post('/:id/share', (req, res) => {
  const p = loadPost(req);
  if (hit(`share:${p.id}:${req.user?.id ?? req.ip}`, 1, HOUR)) run('UPDATE posts SET share_count = share_count + 1 WHERE id = ?', p.id);
  res.json({ ok: true });
});

// ───────────── saves (posts, products, jobs, businesses) ─────────────
const SAVE_TABLE: Record<string, [string, string]> = {
  post: ['posts', 'category'], product: ['products', 'category'], job: ['jobs', 'industry'], business: ['businesses', 'category'],
};

savesRouter.post('/', requirePerm('save'), (req, res) => {
  const { target_type, target_id } = validate(req.body, {
    target_type: { type: 'enum', values: Object.keys(SAVE_TABLE), required: true },
    target_id: { type: 'int', required: true, min: 1 },
  });
  const [table, catCol] = SAVE_TABLE[target_type];
  const target = get(`SELECT ${catCol} AS category FROM ${table} WHERE ${table === 'businesses' ? 'user_id' : 'id'} = ?`, target_id);
  if (!target) throw notFound('Item');
  run('INSERT OR IGNORE INTO saves (user_id, target_type, target_id) VALUES (?,?,?)', req.user!.id, target_type, target_id);
  recordActivity(req.user!.id, 'save', { category: target.category, targetType: target_type, targetId: target_id });
  res.json({ saved: true });
});

savesRouter.delete('/', requireAuth, (req, res) => {
  const { target_type, target_id } = validate(req.body, {
    target_type: { type: 'enum', values: Object.keys(SAVE_TABLE), required: true },
    target_id: { type: 'int', required: true, min: 1 },
  });
  run('DELETE FROM saves WHERE user_id = ? AND target_type = ? AND target_id = ?', req.user!.id, target_type, target_id);
  res.json({ saved: false });
});

savesRouter.get('/', requireAuth, (req, res) => {
  const type = qStr(req, 'type');
  const rows = all(
    `SELECT target_type, target_id FROM saves WHERE user_id = ? ${type ? 'AND target_type = ?' : ''} ORDER BY created_at DESC LIMIT 200`,
    req.user!.id, ...(type ? [type] : []),
  );
  const ids = (t: string) => rows.filter((r) => r.target_type === t).map((r) => r.target_id as number);
  const postIds = ids('post');
  const posts = postIds.length ? all(`SELECT * FROM posts WHERE id IN (${qs(postIds.length)}) AND status = 'active'`, ...postIds) : [];
  const productIds = ids('product');
  const products = productIds.length ? all(`SELECT * FROM products WHERE id IN (${qs(productIds.length)}) AND status = 'active'`, ...productIds) : [];
  const jobIds = ids('job');
  const jobs = jobIds.length ? all(`SELECT * FROM jobs WHERE id IN (${qs(jobIds.length)})`, ...jobIds) : [];
  const bizIds = ids('business');
  const cards = userCards(bizIds);
  res.json({
    posts: hydratePosts(posts, req.user!.id),
    products: hydrateProducts(products, req.user!.id),
    jobs: hydrateJobs(jobs, req.user!.id),
    businesses: bizIds.map((i) => cards.get(i)).filter(Boolean),
  });
});
