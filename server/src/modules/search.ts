// Global search (spec §22) with natural-language interpretation (spec §32 "AI search"):
// "Find software companies around Arusha hiring junior developers" →
//   types: companies + jobs · city: Arusha · experience ≤ 1 year · text: "software developer".
import { Router } from 'express';
import { all, get, qs } from '../db/index.ts';
import type { Row } from '../db/index.ts';
import { paging, qStr } from '../lib/http.ts';
import { KNOWN_CITIES } from '../lib/geo.ts';
import { emit } from '../lib/queue.ts';
import { searchIds, tokenize } from '../services/search-index.ts';
import type { IndexKind } from '../services/search-index.ts';
import { followingSet, userCards } from '../services/users.ts';
import { hydratePosts } from '../services/posts.ts';
import { recordActivity } from '../services/personalization.ts';
import { hydrateProducts } from './products.ts';
import { hydrateJobs } from './jobs.ts';

export const searchRouter = Router();

const TYPE_WORDS: [RegExp, string][] = [
  [/\b(jobs?|vacanc(y|ies)|hiring|careers?|openings?|positions?|employment|internships?)\b/g, 'jobs'],
  [/\b(compan(y|ies)|firms?|organi[sz]ations?|employers?)\b/g, 'companies'],
  [/\b(wholesal(e|ers?)|bulk|suppliers?|distributors?)\b/g, 'wholesalers'],
  [/\b(retail(ers?)?|shops?|stores?|outlets?)\b/g, 'retailers'],
  [/\b(businesses|business)\b/g, 'businesses'],
  [/\b(products?|buy|prices?|cheap|for sale)\b/g, 'products'],
  [/\b(services?|providers?)\b/g, 'services'],
  [/\b(people|candidates?|professionals?|talent|freelancers?)\b/g, 'people'],
  [/\b(posts?|news|updates?)\b/g, 'posts'],
];

export interface Interpretation {
  text: string;
  types: string[];
  city: string | null;
  remote: boolean;
  junior: boolean;
  nearMe: boolean;
  summary: string;
}

const singular = (t: string) => (t.length > 4 && t.endsWith('ies') ? t.slice(0, -3) + 'y' : t.length > 4 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t);

export function interpret(raw: string): Interpretation {
  let s = ` ${raw.toLowerCase()} `;
  let city: string | null = null;
  for (const c of Object.keys(KNOWN_CITIES).sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`\\b${c.toLowerCase()}\\b`);
    if (re.test(s)) {
      city = c;
      s = s.replace(re, ' ');
      break;
    }
  }
  const types = new Set<string>();
  for (const [re, t] of TYPE_WORDS) {
    if (s.match(re)) {
      types.add(t);
      s = s.replace(re, ' ');
    }
  }
  const junior = /\b(junior|entry[- ]level|graduates?|fresh(ers)?|trainees?)\b/.test(s);
  s = s.replace(/\b(junior|entry[- ]level|graduates?|fresh(ers)?|trainees?)\b/g, ' ');
  const remote = /\bremote\b/.test(s);
  s = s.replace(/\bremote\b/g, ' ');
  const nearMe = /\b(near me|nearby|close to me|around me)\b/.test(s);
  s = s.replace(/\b(near me|nearby|close to me|around me|around|near|in|at|looking|want|need|i|we|some|any|good|best|top)\b/g, ' ');
  const text = tokenize(s).map(singular).join(' ');

  const parts: string[] = [];
  if (types.size) parts.push([...types].join(' & '));
  if (text) parts.push(`matching “${text}”`);
  if (city) parts.push(`in ${city}`);
  if (junior) parts.push('suitable for junior / entry level');
  if (remote) parts.push('remote');
  if (nearMe) parts.push('near you');
  return { text, types: [...types], city, remote, junior, nearMe, summary: parts.join(' · ') };
}

const TYPE_TO_KINDS: Record<string, IndexKind[]> = {
  people: ['person'], companies: ['business'], wholesalers: ['business'], retailers: ['business'], businesses: ['business'],
  products: ['product'], services: ['service', 'business'], jobs: ['job'], posts: ['post'],
};

searchRouter.get('/', (req, res) => {
  const q = qStr(req, 'q') ?? '';
  const explicitType = qStr(req, 'type');
  const { limit } = paging(req, 10, 50);
  const it = interpret(q);
  const city = qStr(req, 'city') ?? it.city;
  const category = qStr(req, 'category');
  const types = explicitType && explicitType !== 'all' ? [explicitType] : it.types.length ? it.types : ['people', 'businesses', 'products', 'services', 'jobs', 'posts'];
  const text = it.text || (it.types.length || city ? '' : q);
  const viewer = req.user;
  const results: Record<string, unknown[]> = {};
  const owners: number[] = [];
  const cityMatch = (c?: string | null) => !city || (c ?? '').toLowerCase() === city.toLowerCase();

  const ids = (kinds: IndexKind[], n = 200) => (text ? searchIds(kinds, text, n) : []);

  // Businesses (companies / wholesalers / retailers)
  const bizTypes = types.filter((t) => ['companies', 'wholesalers', 'retailers', 'businesses', 'services'].includes(t));
  if (bizTypes.length) {
    const kinds = bizTypes.includes('businesses') || bizTypes.includes('services') ? ['company', 'wholesaler', 'retailer'] : bizTypes.map((t) => t.replace(/ies$/, 'y').replace(/s$/, ''));
    let bizIds = [...new Set(ids(['business', 'service'], 300).map((r) => r.ref_id))];
    // "companies … hiring …": companies whose open jobs match rank first.
    if (types.includes('jobs') && text) {
      const jobIds = searchIds(['job'], text, 200).map((r) => r.ref_id);
      const hiring = jobIds.length ? all(`SELECT DISTINCT company_id FROM jobs WHERE id IN (${qs(jobIds.length)}) AND status = 'open'`, ...jobIds).map((r) => r.company_id as number) : [];
      bizIds = [...new Set([...hiring, ...bizIds])];
    }
    let rows = bizIds.length
      ? all(`SELECT b.user_id, b.kind, b.category, u.city FROM businesses b JOIN users u ON u.id = b.user_id WHERE u.status = 'active' AND b.user_id IN (${qs(bizIds.length)})`, ...bizIds)
      : !text ? all("SELECT b.user_id, b.kind, b.category, u.city FROM businesses b JOIN users u ON u.id = b.user_id WHERE u.status = 'active' ORDER BY b.verified DESC LIMIT 300") : [];
    const order = new Map(bizIds.map((id, i) => [id, i]));
    rows = rows
      .filter((r) => kinds.includes(r.kind) && cityMatch(r.city) && (!category || r.category === category))
      .sort((a, b) => (order.get(a.user_id) ?? 0) - (order.get(b.user_id) ?? 0))
      .slice(0, limit);
    const pageIds = rows.map((r) => r.user_id as number);
    const cards = userCards(pageIds);
    const following = followingSet(viewer?.id, pageIds);
    const followers = new Map(pageIds.length ? all(`SELECT followee_id, COUNT(*) AS n FROM follows WHERE followee_id IN (${qs(pageIds.length)}) GROUP BY followee_id`, ...pageIds).map((f) => [f.followee_id, f.n]) : []);
    results.businesses = rows.map((r) => ({ ...cards.get(r.user_id), kind: r.kind, following: following.has(r.user_id), followers: followers.get(r.user_id) ?? 0 }));
    owners.push(...rows.map((r) => r.user_id));
  }

  if (types.includes('people')) {
    const pIds = ids(['person']).map((r) => r.ref_id);
    const rows = pIds.length ? all(`SELECT id, city FROM users WHERE id IN (${qs(pIds.length)}) AND status = 'active'`, ...pIds) : [];
    const order = new Map(pIds.map((id, i) => [id, i]));
    const keep = rows.filter((r) => cityMatch(r.city)).sort((a, b) => order.get(a.id)! - order.get(b.id)!).slice(0, limit);
    const cards = userCards(keep.map((r) => r.id));
    results.people = keep.map((r) => cards.get(r.id));
  }

  if (types.includes('jobs')) {
    const jIds = ids(['job'], 300).map((r) => r.ref_id);
    const where = ["status = 'open'", "(deadline IS NULL OR deadline >= date('now'))"];
    const params: unknown[] = [];
    if (text) { if (!jIds.length) where.push('0'); else where.push(`id IN (${jIds.join(',')})`); }
    if (city) { where.push('(city = ? COLLATE NOCASE OR remote = 1)'); params.push(city); }
    if (it.junior) where.push("(experience_years <= 1 OR employment_type = 'internship')");
    if (it.remote) where.push('remote = 1');
    if (category) { where.push('industry = ?'); params.push(category); }
    const order = new Map(jIds.map((id, i) => [id, i]));
    const rows = all(`SELECT * FROM jobs WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 300`, ...params)
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
      .slice(0, limit);
    results.jobs = hydrateJobs(rows, viewer?.id);
    owners.push(...rows.map((r) => r.company_id));
  }

  if (types.includes('products')) {
    const pIds = ids(['product'], 300).map((r) => r.ref_id);
    const where = ["status = 'active'"];
    const params: unknown[] = [];
    if (text) { if (!pIds.length) where.push('0'); else where.push(`id IN (${pIds.join(',')})`); }
    if (city) { where.push('city = ? COLLATE NOCASE'); params.push(city); }
    if (category) { where.push('category = ?'); params.push(category); }
    if (types.includes('wholesalers') && !types.includes('retailers')) where.push("sale_type = 'wholesale'");
    const order = new Map(pIds.map((id, i) => [id, i]));
    const rows = all(`SELECT * FROM products WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 300`, ...params)
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
      .slice(0, limit);
    results.products = hydrateProducts(rows, viewer?.id);
    owners.push(...rows.map((r) => r.seller_id));
  }

  if (types.includes('services')) {
    const sRows = text ? all(
      `SELECT s.ref_id, s.title FROM search_index s WHERE search_index MATCH ? AND s.kind = 'service' LIMIT 50`,
      tokenize(text).map((t) => `"${t}"*`).join(' OR '),
    ) : [];
    const cards = userCards(sRows.map((r) => Number(r.ref_id)));
    results.services = sRows
      .map((r) => ({ service: r.title, business: cards.get(Number(r.ref_id)) }))
      .filter((r) => r.business && cityMatch(r.business.city))
      .slice(0, limit);
  }

  if (types.includes('posts')) {
    const pIds = ids(['post']).map((r) => r.ref_id);
    const rows = pIds.length ? all(`SELECT * FROM posts WHERE id IN (${qs(pIds.length)}) AND status = 'active'`, ...pIds) : [];
    const order = new Map(pIds.map((id, i) => [id, i]));
    results.posts = hydratePosts(rows.filter((r) => cityMatch(r.city) || !city).sort((a, b) => order.get(a.id)! - order.get(b.id)!).slice(0, limit), viewer?.id);
  }

  if (q) {
    recordActivity(viewer?.id, 'search', { term: q, category });
    emit('search.appearances', { viewerId: viewer?.id ?? null, owners, query: q.slice(0, 50) });
  }
  const counts = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.length]));
  res.json({ query: q, interpreted: { ...it, city }, results, counts });
});

searchRouter.get('/suggest', (req, res) => {
  const q = qStr(req, 'q');
  if (!q || q.length < 2) return res.json({ suggestions: [] });
  const hits = searchIds(['business', 'person', 'job', 'product'], q, 8);
  const out: Row[] = [];
  for (const h of hits) {
    if (h.kind === 'business' || h.kind === 'person') {
      const u = get('SELECT id, username, display_name, avatar_url, account_type FROM users WHERE id = ?', h.ref_id);
      if (u) out.push({ kind: h.kind, id: u.id, username: u.username, account_type: u.account_type, label: u.display_name, sub: `@${u.username}`, href: `/u/${u.username}`, avatar_url: u.avatar_url });
    } else if (h.kind === 'job') {
      const j = get("SELECT j.id, j.title, b.name FROM jobs j JOIN businesses b ON b.user_id = j.company_id WHERE j.id = ?", h.ref_id);
      if (j) out.push({ kind: 'job', label: j.title, sub: j.name, href: `/jobs/${j.id}` });
    } else {
      const p = get('SELECT id, name, price, currency FROM products WHERE id = ?', h.ref_id);
      if (p) out.push({ kind: 'product', label: p.name, sub: `${p.currency} ${Number(p.price).toLocaleString('en-US')}`, href: `/marketplace/${p.id}` });
    }
  }
  res.json({ suggestions: out });
});
