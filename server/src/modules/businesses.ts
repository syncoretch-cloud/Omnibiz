import { Router } from 'express';
import { all, get, parseJson, run } from '../db/index.ts';
import type { Row } from '../db/index.ts';
import { badRequest, conflict, paging, qNum, qStr, validate } from '../lib/http.ts';
import { requirePerm } from '../lib/auth.ts';
import { encrypt } from '../lib/crypto.ts';
import { BUSINESS_TYPES } from '../lib/constants.ts';
import { boundingBox, cityCoords, distanceKm } from '../lib/geo.ts';
import { followingSet, userCards } from '../services/users.ts';
import { reindexUser, searchIds } from '../services/search-index.ts';
import { notify } from '../services/notify.ts';
import { staffCan } from '../lib/permissions.ts';
import { buildMe } from './auth.ts';
import { config } from '../config.ts';

export const businessesRouter = Router();

function shapeBusiness(r: Row, cardMap: ReturnType<typeof userCards>, origin?: { lat: number; lng: number } | null, following?: Set<number>) {
  const loc = r.lat != null ? { lat: r.lat, lng: r.lng } : cityCoords(r.city);
  return {
    ...cardMap.get(r.user_id),
    name: r.name,
    kind: r.kind,
    category: r.category,
    custom_category: r.custom_category,
    description: r.description,
    services: parseJson<string[]>(r.services, []),
    verified: !!r.verified,
    city: r.city,
    address: r.address,
    location: loc,
    followers: r.followers ?? 0,
    following: following?.has(r.user_id) ?? false,
    rating: r.rating_avg ? { avg: Math.round(r.rating_avg * 10) / 10, count: r.rating_count } : null,
    distance_km: origin && loc ? Math.round(distanceKm(origin, loc) * 10) / 10 : undefined,
  };
}

const SELECT = `SELECT b.*, u.city, u.lat, u.lng, u.country,
  (SELECT COUNT(*) FROM follows f WHERE f.followee_id = b.user_id) AS followers,
  (SELECT AVG(rating) FROM reviews r WHERE r.seller_id = b.user_id) AS rating_avg,
  (SELECT COUNT(*) FROM reviews r WHERE r.seller_id = b.user_id) AS rating_count
  FROM businesses b JOIN users u ON u.id = b.user_id`;

/** Directory: filter by kind, category, city, verification, text and proximity ("Businesses near me"). */
businessesRouter.get('/', (req, res) => {
  const { limit, offset } = paging(req, 20);
  const where = ["u.status = 'active'"];
  const params: unknown[] = [];
  const kind = qStr(req, 'kind');
  if (kind && (BUSINESS_TYPES as readonly string[]).includes(kind)) { where.push('b.kind = ?'); params.push(kind); }
  const category = qStr(req, 'category');
  if (category) { where.push('b.category = ?'); params.push(category); }
  const city = qStr(req, 'city');
  if (city) { where.push('u.city = ? COLLATE NOCASE'); params.push(city); }
  if (req.query.verified === '1') where.push('b.verified = 1');
  const q = qStr(req, 'q');
  if (q) {
    const ids = searchIds(['business', 'service'], q, 500).map((r) => r.ref_id);
    if (!ids.length) return res.json({ businesses: [], total: 0 });
    where.push(`b.user_id IN (${ids.join(',')})`);
  }
  const lat = qNum(req, 'lat');
  const lng = qNum(req, 'lng');
  const radius = Math.min(500, qNum(req, 'radius') ?? 50);
  const origin = lat != null && lng != null ? { lat, lng } : null;
  if (origin) {
    const bb = boundingBox(origin.lat, origin.lng, radius);
    where.push('u.lat BETWEEN ? AND ? AND u.lng BETWEEN ? AND ?');
    params.push(bb.minLat, bb.maxLat, bb.minLng, bb.maxLng);
  }
  let rows = all(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY b.verified DESC, followers DESC LIMIT 1000`, ...params);
  if (origin) {
    rows = rows
      .map((r) => ({ r, d: distanceKm(origin, { lat: r.lat, lng: r.lng }) }))
      .filter((x) => x.d <= radius)
      .sort((a, b) => a.d - b.d)
      .map((x) => x.r);
  }
  const total = rows.length;
  const pageRows = rows.slice(offset, offset + limit);
  const cards = userCards(pageRows.map((r) => r.user_id));
  const following = followingSet(req.user?.id, pageRows.map((r) => r.user_id));
  res.json({ businesses: pageRows.map((r) => shapeBusiness(r, cards, origin, following)), total });
});

/** Map pins for businesses and open jobs inside a viewport or radius. */
businessesRouter.get('/map', (req, res) => {
  const lat = qNum(req, 'lat') ?? -6.3690;
  const lng = qNum(req, 'lng') ?? 34.8888;
  const radius = Math.min(1500, qNum(req, 'radius') ?? 50);
  const bb = boundingBox(lat, lng, radius);
  const kinds = (qStr(req, 'layers') ?? 'company,wholesaler,retailer,jobs').split(',');
  const bizKinds = kinds.filter((k) => (BUSINESS_TYPES as readonly string[]).includes(k));
  const category = qStr(req, 'category');
  const pins: Row[] = [];
  if (bizKinds.length) {
    const rows = all(
      `SELECT b.user_id, b.name, b.kind, b.category, b.verified, b.address, u.username, u.avatar_url, u.lat, u.lng, u.city
       FROM businesses b JOIN users u ON u.id = b.user_id
       WHERE u.status = 'active' AND u.lat BETWEEN ? AND ? AND u.lng BETWEEN ? AND ?
         AND b.kind IN (${bizKinds.map(() => '?').join(',')}) ${category ? 'AND b.category = ?' : ''} LIMIT 1500`,
      bb.minLat, bb.maxLat, bb.minLng, bb.maxLng, ...bizKinds, ...(category ? [category] : []),
    );
    for (const r of rows) {
      pins.push({ type: r.kind, id: r.user_id, username: r.username, title: r.name, subtitle: r.address ?? r.city, category: r.category, verified: !!r.verified, avatar_url: r.avatar_url, lat: r.lat, lng: r.lng, distance_km: Math.round(distanceKm({ lat, lng }, r) * 10) / 10 });
    }
  }
  if (kinds.includes('jobs')) {
    const rows = all(
      `SELECT j.id, j.title, j.city, j.industry, COALESCE(j.lat, u.lat) AS lat, COALESCE(j.lng, u.lng) AS lng, b.name AS company
       FROM jobs j JOIN users u ON u.id = j.company_id JOIN businesses b ON b.user_id = j.company_id
       WHERE j.status = 'open' AND COALESCE(j.lat, u.lat) BETWEEN ? AND ? AND COALESCE(j.lng, u.lng) BETWEEN ? AND ?
       ${category ? 'AND j.industry = ?' : ''} LIMIT 500`,
      bb.minLat, bb.maxLat, bb.minLng, bb.maxLng, ...(category ? [category] : []),
    );
    for (const r of rows) pins.push({ type: 'job', id: r.id, title: r.title, subtitle: r.company, category: r.industry, lat: r.lat, lng: r.lng, distance_km: Math.round(distanceKm({ lat, lng }, r) * 10) / 10 });
  }
  res.json({ pins: pins.filter((p) => p.distance_km <= radius) });
});

// ───────────── manage own business profile ─────────────
businessesRouter.patch('/me', requirePerm('manage_business_profile'), (req, res) => {
  const d = validate(req.body, {
    name: { type: 'string', min: 2, max: 120 },
    category: { type: 'string', max: 50 },
    custom_category: { type: 'string', max: 60 },
    description: { type: 'text', max: 4000 },
    website: { type: 'url' },
    portfolio_links: { type: 'strings', max: 20 },
    services: { type: 'strings', max: 40 },
    product_lines: { type: 'strings', max: 40 },
    wholesale_categories: { type: 'strings', max: 30 },
    address: { type: 'string', max: 200 },
    contact_email: { type: 'email' },
    contact_phone: { type: 'string', max: 20 },
    registration_number: { type: 'string', max: 60 },
    employee_count: { type: 'string', max: 20 },
    founded_year: { type: 'int', min: 1800, max: 2100 },
    opening_hours: { type: 'string', max: 200 },
  }, { partial: true });
  if (d.category && !get("SELECT 1 AS x FROM categories WHERE scope = 'industry' AND slug = ?", d.category)) throw badRequest('Unknown category');
  if (d.registration_number !== undefined) {
    d.registration_number_enc = d.registration_number ? encrypt(d.registration_number) : null;
    delete d.registration_number;
  }
  const keys = Object.keys(d);
  if (keys.length) run(`UPDATE businesses SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE user_id = ?`, ...keys.map((k) => d[k]), req.user!.id);
  if (d.name) run('UPDATE users SET display_name = ? WHERE id = ?', d.name, req.user!.id);
  reindexUser(req.user!.id);
  res.json(buildMe(req.user!.id));
});

// ───────────── verification (spec §27) ─────────────
businessesRouter.get('/me/verification', requirePerm('manage_business_profile'), (req, res) => {
  res.json({ requests: all('SELECT * FROM verification_requests WHERE user_id = ? ORDER BY id DESC', req.user!.id) });
});

businessesRouter.post('/me/verification', requirePerm('manage_business_profile'), (req, res) => {
  const d = validate(req.body, { document_ids: { type: 'ints', required: true, max: 10 }, notes: { type: 'text', max: 1000 } });
  const me = get('SELECT email_verified, phone_verified FROM users WHERE id = ?', req.user!.id)!;
  if (config.contactVerification && (!me.email_verified || !me.phone_verified)) throw badRequest('Verify your email and phone number before requesting business verification');
  const owned = all(`SELECT id FROM documents WHERE owner_id = ? AND id IN (${(d.document_ids as number[]).join(',')})`, req.user!.id);
  if (owned.length !== d.document_ids.length || !owned.length) throw badRequest('Attach at least one of your uploaded documents');
  if (get("SELECT 1 AS x FROM verification_requests WHERE user_id = ? AND status = 'pending'", req.user!.id)) throw conflict('You already have a verification request under review');
  const { id } = run('INSERT INTO verification_requests (user_id, document_ids, notes) VALUES (?,?,?)', req.user!.id, d.document_ids, d.notes ?? null);
  run("UPDATE businesses SET verification_status = 'pending' WHERE user_id = ?", req.user!.id);
  const team = all("SELECT id, role FROM users WHERE role != 'user' AND status = 'active'").filter((u) => staffCan(u.role, 'verification')).map((u) => u.id);
  notify(team, { type: 'verification', title: 'New business verification request', body: req.user!.display_name, link: '/admin/verification' });
  res.status(201).json({ id });
});
