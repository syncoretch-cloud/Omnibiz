import { Router } from 'express';
import { all, get, run } from '../db/index.ts';
import { badRequest, intParam, notFound, validate } from '../lib/http.ts';
import { requireAuth } from '../lib/auth.ts';
import { SEARCH_KEYS } from '../services/savedSearches.ts';

export const savedSearchesRouter = Router();
savedSearchesRouter.use(requireAuth);

const MAX_SAVED = 20;

savedSearchesRouter.get('/', (req, res) => {
  const items = all('SELECT * FROM saved_searches WHERE user_id = ? ORDER BY id DESC', req.user!.id).map((s) => ({ ...s, params: JSON.parse(s.params) }));
  res.json({ items });
});

savedSearchesRouter.post('/', (req, res) => {
  const d = validate(req.body, { kind: { type: 'enum', values: ['product', 'job'], required: true }, label: { type: 'string', max: 80 }, params: { type: 'json', required: true } });
  const kind = d.kind as 'product' | 'job';
  const clean: Record<string, string> = {};
  for (const k of SEARCH_KEYS[kind]) {
    const v = d.params?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') clean[k] = String(v).trim().slice(0, 100);
  }
  if (!Object.keys(clean).length) throw badRequest('Add a search word or a filter first');
  if ((get('SELECT COUNT(*) AS n FROM saved_searches WHERE user_id = ?', req.user!.id)?.n ?? 0) >= MAX_SAVED) throw badRequest(`You can keep up to ${MAX_SAVED} saved searches`);
  const params = JSON.stringify(clean);
  if (get('SELECT 1 AS x FROM saved_searches WHERE user_id = ? AND kind = ? AND params = ?', req.user!.id, kind, params)) throw badRequest('You already saved this search');
  const label = d.label?.trim() || [clean.q, clean.category, clean.city].filter(Boolean).join(' · ') || 'My search';
  const { id } = run('INSERT INTO saved_searches (user_id, kind, label, params) VALUES (?,?,?,?)', req.user!.id, kind, label, params);
  res.status(201).json({ id });
});

savedSearchesRouter.delete('/:id', (req, res) => {
  const { changes } = run('DELETE FROM saved_searches WHERE id = ? AND user_id = ?', intParam(req), req.user!.id);
  if (!changes) throw notFound('Saved search');
  res.json({ ok: true });
});
