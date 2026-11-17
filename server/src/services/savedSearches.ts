// Saved searches with alerts: a person saves a marketplace or job search, and is told when something new matches it.
import { all } from '../db/index.ts';
import type { Row } from '../db/index.ts';
import { parseJson } from '../db/index.ts';
import { notify } from './notify.ts';

export const SEARCH_KEYS: Record<'product' | 'job', string[]> = {
  product: ['q', 'category', 'city', 'sale_type', 'min_price', 'max_price', 'in_stock', 'verified'],
  job: ['q', 'industry', 'city', 'employment_type', 'remote', 'skill'],
};

const text = (...parts: unknown[]) => parts.filter(Boolean).join(' ').toLowerCase();
const words = (q: unknown) => String(q ?? '').toLowerCase().split(/\s+/).filter(Boolean);

export function productMatches(p: Row, f: Record<string, string>, sellerVerified: boolean): boolean {
  if (f.category && f.category !== p.category) return false;
  if (f.city && f.city !== p.city) return false;
  if (f.sale_type && f.sale_type !== p.sale_type) return false;
  if (f.min_price && p.price < Number(f.min_price)) return false;
  if (f.max_price && p.price > Number(f.max_price)) return false;
  if (f.in_stock === '1' && p.availability === 'out_of_stock') return false;
  if (f.verified === '1' && !sellerVerified) return false;
  const hay = text(p.name, p.description, p.category);
  return words(f.q).every((w) => hay.includes(w));
}

export function jobMatches(j: Row, f: Record<string, string>): boolean {
  if (f.industry && f.industry !== j.industry) return false;
  if (f.city && f.city !== j.city) return false;
  if (f.employment_type && f.employment_type !== j.employment_type) return false;
  if (f.remote === '1' && !j.remote) return false;
  const hay = text(j.title, j.description, j.department, j.skills);
  if (f.skill && !hay.includes(f.skill.toLowerCase())) return false;
  return words(f.q).every((w) => hay.includes(w));
}

/** Tells everyone whose saved search matches a new product or job. The seller or employer is never alerted about their own listing. */
export function alertSavedSearches(kind: 'product' | 'job', item: Row, ownerId: number, link: string, verified = false) {
  const rows = all('SELECT user_id, label, params FROM saved_searches WHERE kind = ? AND user_id != ?', kind, ownerId);
  const byUser = new Map<number, string>();
  for (const s of rows) {
    if (byUser.has(s.user_id)) continue;
    const f = parseJson<Record<string, string>>(s.params, {});
    if (kind === 'product' ? productMatches(item, f, verified) : jobMatches(item, f)) byUser.set(s.user_id, s.label);
  }
  for (const [userId, label] of byUser) {
    notify([userId], {
      type: 'saved_search',
      title: kind === 'product' ? `New in "${label}"` : `New job for "${label}"`,
      body: kind === 'product' ? item.name : item.title,
      link,
    });
  }
}
