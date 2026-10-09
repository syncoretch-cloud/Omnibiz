import { Router } from 'express';
import { all, get, parseJson, qs, run } from '../db/index.ts';
import type { Row } from '../db/index.ts';
import { badRequest, forbidden, intParam, notFound, paging, qNum, qStr, validate } from '../lib/http.ts';
import type { Spec } from '../lib/http.ts';
import { requirePerm } from '../lib/auth.ts';
import { CURRENCIES } from '../lib/constants.ts';
import { staffCan } from '../lib/permissions.ts';
import { canonicalCity, cityCoords, distanceKm } from '../lib/geo.ts';
import { emit } from '../lib/queue.ts';
import { userCards } from '../services/users.ts';
import { reindexProduct, searchIds, unindex } from '../services/search-index.ts';
import { track } from '../services/analytics.ts';
import { recordActivity } from '../services/personalization.ts';
import { createPost } from './posts.ts';

export const productsRouter = Router();

export function hydrateProducts(rows: Row[], viewerId?: number, origin?: { lat: number; lng: number } | null) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id as number);
  const cards = userCards(rows.map((r) => r.seller_id));
  const saved = new Set<number>();
  if (viewerId) {
    for (const r of all(`SELECT target_id FROM saves WHERE user_id = ? AND target_type = 'product' AND target_id IN (${qs(ids.length)})`, viewerId, ...ids)) saved.add(r.target_id);
  }
  const ratings = new Map(
    all(`SELECT product_id, AVG(rating) AS avg, COUNT(*) AS count FROM reviews WHERE product_id IN (${qs(ids.length)}) GROUP BY product_id`, ...ids).map((r) => [r.product_id, r]),
  );
  return rows.map((r) => {
    const loc = r.lat != null ? { lat: r.lat, lng: r.lng } : cityCoords(r.city);
    const rating = ratings.get(r.id);
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      category: r.category,
      sale_type: r.sale_type,
      price: r.price,
      currency: r.currency,
      min_order_qty: r.min_order_qty,
      quantity: r.quantity,
      availability: r.availability,
      packaging: r.packaging,
      specs: parseJson<Record<string, string>>(r.specs, {}),
      media: parseJson<string[]>(r.media, []),
      city: r.city,
      location: loc,
      delivery_info: r.delivery_info,
      delivery_options: parseJson<string[]>(r.delivery_options, []),
      contact_method: r.contact_method,
      status: r.status,
      view_count: r.view_count,
      created_at: r.created_at,
      updated_at: r.updated_at,
      seller: cards.get(r.seller_id) ?? null,
      saved: saved.has(r.id),
      rating: rating ? { avg: Math.round(rating.avg * 10) / 10, count: rating.count } : null,
      distance_km: origin && loc ? Math.round(distanceKm(origin, loc) * 10) / 10 : undefined,
    };
  });
}

const PRODUCT_SPEC: Spec = {
  name: { type: 'string', required: true, min: 2, max: 150 },
  description: { type: 'text', max: 5000 },
  category: { type: 'string', required: true, max: 50 },
  sale_type: { type: 'enum', values: ['retail', 'wholesale', 'service'] },
  price: { type: 'number', required: true, min: 0, max: 1e12 },
  currency: { type: 'enum', values: CURRENCIES },
  min_order_qty: { type: 'int', min: 1, max: 1e9 },
  quantity: { type: 'int', min: 0, max: 1e9 },
  availability: { type: 'enum', values: ['in_stock', 'low_stock', 'out_of_stock', 'preorder', 'on_request'] },
  packaging: { type: 'string', max: 200 },
  specs: { type: 'json' },
  media: { type: 'strings', max: 12 },
  city: { type: 'string', max: 60 },
  lat: { type: 'number', min: -90, max: 90 },
  lng: { type: 'number', min: -180, max: 180 },
  delivery_info: { type: 'text', max: 1000 },
  delivery_options: { type: 'strings', max: 10 },
  contact_method: { type: 'string', max: 100 },
  status: { type: 'enum', values: ['active', 'archived'] },
  announce: { type: 'bool' },
};

function cleanProduct(d: Row, seller: Row) {
  if (d.category && !get("SELECT 1 AS x FROM categories WHERE scope = 'product' AND slug = ?", d.category)) throw badRequest('Unknown product category');
  if (d.media?.some((m: string) => !m.startsWith('/uploads/media/'))) throw badRequest('Images must be uploaded first');
  if (d.specs) {
    const specs: Record<string, string> = {};
    for (const [k, v] of Object.entries(d.specs as Row).slice(0, 30)) if (k && v != null && String(v).trim()) specs[String(k).slice(0, 60)] = String(v).slice(0, 200);
    d.specs = specs;
  }
  if (d.city !== undefined) {
    d.city = canonicalCity(d.city);
    if (d.lat === undefined && d.city) Object.assign(d, cityCoords(d.city) ?? {});
  }
  if (d.sale_type === 'wholesale' && seller.account_type === 'customer') throw forbidden();
  delete d.announce;
  return d;
}

// ───────────── browse & search ─────────────
productsRouter.get('/', (req, res) => {
  const { limit, offset } = paging(req, 24, 60);
  const where = ["p.status = 'active'", "u.status = 'active'"];
  const params: unknown[] = [];
  const q = qStr(req, 'q');
  let rankOrder: Map<number, number> | null = null;
  if (q) {
    const ids = searchIds(['product'], q, 500).map((r) => r.ref_id);
    if (!ids.length) return res.json({ items: [], total: 0 });
    rankOrder = new Map(ids.map((id, i) => [id, i]));
    where.push(`p.id IN (${ids.join(',')})`);
    recordActivity(req.user?.id, 'search', { term: q });
  }
  const category = qStr(req, 'category');
  if (category) { where.push('p.category = ?'); params.push(category); recordActivity(req.user?.id, 'search', { category }); }
  const seller = Number(req.query.seller);
  if (seller) { where.push('p.seller_id = ?'); params.push(seller); }
  const saleType = qStr(req, 'sale_type');
  if (saleType) { where.push('p.sale_type = ?'); params.push(saleType); }
  const city = qStr(req, 'city');
  if (city) { where.push('p.city = ? COLLATE NOCASE'); params.push(city); }
  const minPrice = qNum(req, 'min_price');
  if (minPrice != null) { where.push('p.price >= ?'); params.push(minPrice); }
  const maxPrice = qNum(req, 'max_price');
  if (maxPrice != null) { where.push('p.price <= ?'); params.push(maxPrice); }
  if (req.query.in_stock === '1') where.push("p.availability IN ('in_stock','low_stock')");
  if (req.query.verified === '1') where.push('p.seller_id IN (SELECT user_id FROM businesses WHERE verified = 1)');

  const sort = qStr(req, 'sort') ?? (q ? 'relevance' : 'newest');
  const order: Record<string, string> = {
    newest: 'p.created_at DESC', price_asc: 'p.price ASC', price_desc: 'p.price DESC', popular: 'p.view_count DESC',
  };
  let rows = all(
    `SELECT p.* FROM products p JOIN users u ON u.id = p.seller_id WHERE ${where.join(' AND ')} ORDER BY ${order[sort] ?? 'p.created_at DESC'} LIMIT 2000`,
    ...params,
  );
  const lat = qNum(req, 'lat');
  const lng = qNum(req, 'lng');
  const origin = lat != null && lng != null ? { lat, lng } : null;
  if (sort === 'relevance' && rankOrder) rows.sort((a, b) => rankOrder!.get(a.id)! - rankOrder!.get(b.id)!);
  if (sort === 'nearest' && origin) {
    const d = (r: Row) => { const c = r.lat != null ? r : cityCoords(r.city); return c ? distanceKm(origin, c) : 1e9; };
    rows = rows.sort((a, b) => d(a) - d(b));
  }
  const total = rows.length;
  res.json({ items: hydrateProducts(rows.slice(offset, offset + limit), req.user?.id, origin), total });
});

productsRouter.get('/compare', (req, res) => {
  const ids = String(req.query.ids ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 4);
  if (ids.length < 2) throw badRequest('Choose 2 to 4 products to compare');
  const rows = all(`SELECT * FROM products WHERE id IN (${qs(ids.length)}) AND status = 'active'`, ...ids);
  const items = hydrateProducts(rows, req.user?.id);
  const specKeys = [...new Set(items.flatMap((p) => Object.keys(p.specs)))];
  res.json({ items, spec_keys: specKeys });
});

productsRouter.get('/:id', (req, res) => {
  const r = get('SELECT * FROM products WHERE id = ?', intParam(req));
  if (!r) throw notFound('Product');
  const owner = req.user?.id === r.seller_id || (req.user && staffCan(req.user.role, 'content'));
  if (r.status !== 'active' && !owner) throw notFound('Product');
  const [product] = hydrateProducts([r], req.user?.id);
  if (req.user?.id !== r.seller_id) {
    run('UPDATE products SET view_count = view_count + 1 WHERE id = ?', r.id);
    track({ ownerId: r.seller_id, actorId: req.user?.id, type: 'product_view', targetType: 'product', targetId: r.id, source: String(req.query.src ?? 'direct') });
    recordActivity(req.user?.id, 'view_product', { category: r.category, targetType: 'product', targetId: r.id });
  }
  const similar = all("SELECT * FROM products WHERE category = ? AND id != ? AND status = 'active' ORDER BY view_count DESC LIMIT 6", r.category, r.id);
  const reviews = all('SELECT rv.*, u.display_name, u.avatar_url FROM reviews rv JOIN users u ON u.id = rv.user_id WHERE rv.product_id = ? ORDER BY rv.id DESC LIMIT 20', r.id);
  res.json({ product, similar: hydrateProducts(similar, req.user?.id), reviews });
});

// ───────────── manage catalogue ─────────────
productsRouter.post('/', requirePerm('manage_products'), (req, res) => {
  const me = req.user!;
  const d = validate(req.body, PRODUCT_SPEC);
  const announce = d.announce;
  cleanProduct(d, me);
  d.sale_type ??= me.account_type === 'wholesaler' ? 'wholesale' : 'retail';
  if (d.sale_type === 'wholesale' && !d.min_order_qty) throw badRequest('Wholesale products need a minimum order quantity');
  d.currency ??= 'TZS';
  if (d.city === undefined) Object.assign(d, { city: me.city, lat: me.lat, lng: me.lng });
  if (get("SELECT COUNT(*) AS n FROM products WHERE seller_id = ? AND status = 'active'", me.id)!.n >= 5000) throw badRequest('Catalogue limit reached');
  const keys = Object.keys(d);
  const { id } = run(`INSERT INTO products (seller_id, ${keys.join(', ')}) VALUES (?, ${qs(keys.length)})`, me.id, ...keys.map((k) => d[k]));
  reindexProduct(id);
  emit('product.created', { productId: id });
  if (announce) {
    const price = `${d.currency} ${Number(d.price).toLocaleString('en-US')}`;
    createPost(me, { kind: 'product', body: `New: ${d.name} — ${price}${d.sale_type === 'wholesale' ? ` (min. order ${d.min_order_qty})` : ''}\n\n${(d.description ?? '').slice(0, 300)}`, media: (d.media ?? []).slice(0, 4), data: { product_id: id } });
  }
  const [product] = hydrateProducts([get('SELECT * FROM products WHERE id = ?', id)!], me.id);
  res.status(201).json({ product });
});

productsRouter.patch('/:id', requirePerm('manage_products'), (req, res) => {
  const r = get('SELECT * FROM products WHERE id = ?', intParam(req));
  if (!r || r.status === 'removed') throw notFound('Product');
  if (r.seller_id !== req.user!.id) throw forbidden();
  const d = cleanProduct(validate(req.body, PRODUCT_SPEC, { partial: true }), req.user!);
  const keys = Object.keys(d);
  if (keys.length) run(`UPDATE products SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`, ...keys.map((k) => d[k]), r.id);
  reindexProduct(r.id);
  const [product] = hydrateProducts([get('SELECT * FROM products WHERE id = ?', r.id)!], req.user!.id);
  res.json({ product });
});

productsRouter.delete('/:id', requirePerm('manage_products'), (req, res) => {
  const r = get('SELECT * FROM products WHERE id = ?', intParam(req));
  if (!r) throw notFound('Product');
  if (r.seller_id !== req.user!.id) throw forbidden();
  run("UPDATE products SET status = 'archived', updated_at = datetime('now') WHERE id = ?", r.id);
  run('DELETE FROM cart_items WHERE product_id = ?', r.id);
  unindex('product', r.id);
  res.json({ ok: true });
});

productsRouter.get('/mine/all', requirePerm('manage_products'), (req, res) => {
  const rows = all("SELECT * FROM products WHERE seller_id = ? AND status != 'removed' ORDER BY id DESC", req.user!.id);
  res.json({ items: hydrateProducts(rows, req.user!.id) });
});
