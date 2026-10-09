import { Router } from 'express';
import { all, get, run } from '../db/index.ts';
import { badRequest, intParam, notFound, paging, validate } from '../lib/http.ts';
import { requirePerm } from '../lib/auth.ts';
import { ANNOUNCEMENT_KINDS, CURRENCIES } from '../lib/constants.ts';
import { emit } from '../lib/queue.ts';
import { userCards } from '../services/users.ts';
import { createPost } from './posts.ts';

export const announcementsRouter = Router();

const fmt = (n: number, c: string) => `${c} ${n.toLocaleString('en-US')}`;

announcementsRouter.get('/', (req, res) => {
  const { limit, offset } = paging(req, 20);
  const business = Number(req.query.business);
  const rows = all(
    `SELECT a.* FROM announcements a JOIN users u ON u.id = a.business_id WHERE u.status = 'active' ${business ? 'AND a.business_id = ?' : ''}
     ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    ...(business ? [business] : []), limit, offset,
  );
  const cards = userCards(rows.map((r) => r.business_id));
  res.json({ items: rows.map((r) => ({ ...r, business: cards.get(r.business_id) })) });
});

announcementsRouter.get('/:id', (req, res) => {
  const a = get('SELECT * FROM announcements WHERE id = ?', intParam(req));
  if (!a) throw notFound('Announcement');
  res.json({ announcement: { ...a, business: userCards([a.business_id]).get(a.business_id) } });
});

/** Business Alert System (spec §20): price changes, launches, openings, interruptions, offers… */
announcementsRouter.post('/', requirePerm('publish_announcements'), (req, res) => {
  const me = req.user!;
  const d = validate(req.body, {
    kind: { type: 'enum', values: ANNOUNCEMENT_KINDS, required: true },
    title: { type: 'string', required: true, min: 3, max: 160 },
    body: { type: 'text', max: 3000 },
    product_id: { type: 'int', min: 1 },
    old_price: { type: 'number', min: 0 },
    new_price: { type: 'number', min: 0 },
    currency: { type: 'enum', values: CURRENCIES },
    effective_date: { type: 'date' },
    media: { type: 'strings', max: 4 },
  });
  let product = null;
  if (d.product_id) {
    product = get("SELECT * FROM products WHERE id = ? AND seller_id = ? AND status = 'active'", d.product_id, me.id);
    if (!product) throw badRequest('Choose one of your own active products');
  }
  if (d.kind === 'price_increase' || d.kind === 'price_decrease') {
    if (d.new_price == null) throw badRequest('Enter the new price');
    d.old_price ??= product?.price ?? null;
    d.currency ??= product?.currency ?? 'TZS';
    if (d.old_price != null && d.kind === 'price_increase' && d.new_price <= d.old_price) throw badRequest('For a price increase the new price must be higher');
    if (d.old_price != null && d.kind === 'price_decrease' && d.new_price >= d.old_price) throw badRequest('For a price decrease the new price must be lower');
  }
  if (d.media?.some((m: string) => !m.startsWith('/uploads/media/'))) throw badRequest('Media must be uploaded first');

  let text = d.title;
  if (d.old_price != null && d.new_price != null) {
    text += `\n\n${product?.name ?? 'Price'}: ${fmt(d.old_price, d.currency)} → ${fmt(d.new_price, d.currency)}${d.effective_date ? ` starting ${d.effective_date}` : ''}.`;
  } else if (d.effective_date) text += `\n\nEffective ${d.effective_date}.`;
  if (d.body) text += `\n\n${d.body}`;

  const postId = createPost(me, { kind: 'announcement' as string, body: text, media: d.media ?? [], data: { announcement_kind: d.kind, product_id: d.product_id ?? undefined } });
  const { id } = run(
    'INSERT INTO announcements (business_id, kind, title, body, product_id, old_price, new_price, currency, effective_date, post_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
    me.id, d.kind, d.title, d.body ?? null, d.product_id ?? null, d.old_price ?? null, d.new_price ?? null, d.currency ?? null, d.effective_date ?? null, postId,
  );
  run('UPDATE posts SET data = json_set(data, \'$.announcement_id\', ?) WHERE id = ?', id, postId);
  emit('announcement.published', { announcementId: id });
  res.status(201).json({ id, post_id: postId });
});
