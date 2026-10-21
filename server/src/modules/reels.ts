// Reels & Explore: one vertical stream mixing ranked posts with products and jobs, so the whole
// ecosystem (people, businesses, products, opportunities) can be browsed reel by reel.
import { Router } from 'express';
import { all, get, DAY } from '../db/index.ts';
import type { Row } from '../db/index.ts';
import { paging } from '../lib/http.ts';
import { requireAuth } from '../lib/auth.ts';
import { cityCoords, distanceKm } from '../lib/geo.ts';
import { hydratePosts, rankedFeed } from '../services/posts.ts';
import { loadCandidates, scoreMatch } from '../services/matching.ts';
import { hydrateProducts } from './products.ts';
import { hydrateJobs } from './jobs.ts';

export const reelsRouter = Router();

const POSTS_PER_PAGE = 6;
const PRODUCTS_PER_PAGE = 2;
const JOBS_PER_PAGE = 1;

function rankedProducts(viewer: Row): Row[] {
  const rows = all("SELECT * FROM products WHERE status = 'active' AND seller_id != ? ORDER BY id DESC LIMIT 800", viewer.id);
  const here = viewer.lat != null ? { lat: viewer.lat, lng: viewer.lng } : cityCoords(viewer.city);
  const now = Date.now();
  const score = (p: Row) => {
    const ageDays = (now - Date.parse(p.created_at.replace(' ', 'T') + 'Z')) / DAY;
    const there = p.lat != null ? { lat: p.lat, lng: p.lng } : cityCoords(p.city);
    const near = here && there ? Math.max(0, 1 - distanceKm(here, there) / 400) * 3 : 0;
    return Math.log1p(p.view_count) + near + 4 * Math.exp(-ageDays / 20) + (p.media !== '[]' ? 1 : 0);
  };
  return rows.sort((a, b) => score(b) - score(a) || b.id - a.id);
}

function rankedJobs(viewer: Row): Row[] {
  if (viewer.account_type === 'customer') return [];
  const rows = all("SELECT * FROM jobs WHERE status = 'open' AND company_id != ? AND (deadline IS NULL OR deadline >= date('now')) ORDER BY id DESC LIMIT 600", viewer.id);
  const [cand] = viewer.account_type === 'personal' ? loadCandidates([viewer.id]) : [];
  if (!cand) return rows;
  return rows.map((j) => ({ j, s: scoreMatch(j, cand).score })).sort((a, b) => b.s - a.s || b.j.id - a.j.id).map((x) => x.j);
}

function startItem(start: string, viewerId: number) {
  const [type, idStr] = start.split(':');
  const id = Number(idStr);
  if (!Number.isInteger(id)) return null;
  if (type === 'post') {
    const r = get("SELECT * FROM posts WHERE id = ? AND status = 'active'", id);
    return r ? { key: `post:${id}`, type, post: hydratePosts([r], viewerId)[0] } : null;
  }
  if (type === 'product') {
    const r = get("SELECT * FROM products WHERE id = ? AND status = 'active'", id);
    return r ? { key: `product:${id}`, type, product: hydrateProducts([r], viewerId)[0] } : null;
  }
  if (type === 'job') {
    const r = get("SELECT * FROM jobs WHERE id = ? AND status = 'open'", id);
    return r ? { key: `job:${id}`, type, job: hydrateJobs([r], viewerId)[0] } : null;
  }
  return null;
}

reelsRouter.get('/', requireAuth, (req, res) => {
  const viewer = req.user!;
  const { page } = paging(req, 9);
  const feed = rankedFeed(viewer, (page - 1) * POSTS_PER_PAGE, POSTS_PER_PAGE);
  const products = rankedProducts(viewer);
  const jobs = rankedJobs(viewer);
  const prodSlice = hydrateProducts(products.slice((page - 1) * PRODUCTS_PER_PAGE, page * PRODUCTS_PER_PAGE), viewer.id);
  const jobSlice = hydrateJobs(jobs.slice((page - 1) * JOBS_PER_PAGE, page * JOBS_PER_PAGE), viewer.id);

  // Interleave: post, post, product, post, post, job, post, post, product …
  const items: Row[] = [];
  const posts = [...feed.items];
  const prods = [...prodSlice];
  const js = [...jobSlice];
  let n = 0;
  while (posts.length || prods.length || js.length) {
    const p = posts.shift();
    if (p) items.push({ key: `post:${p.id}`, type: 'post', post: p });
    n++;
    if (n % 2 === 0) {
      const next = n % 4 === 0 ? js.shift() ?? prods.shift() : prods.shift() ?? js.shift();
      if (next) items.push('price' in next ? { key: `product:${next.id}`, type: 'product', product: next } : { key: `job:${next.id}`, type: 'job', job: next });
    }
    if (!p && n > 20) break;
  }

  const startKey = typeof req.query.start === 'string' ? req.query.start : '';
  if (page === 1 && startKey) {
    const first = startItem(startKey, viewer.id);
    if (first) {
      const rest = items.filter((it) => it.key !== first.key);
      items.splice(0, items.length, first, ...rest);
    }
  }

  const hasMore = feed.hasMore || products.length > page * PRODUCTS_PER_PAGE || jobs.length > page * JOBS_PER_PAGE;
  res.json({ items, hasMore });
});
