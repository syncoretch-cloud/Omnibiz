// Full-text index over people, businesses, services, products, jobs and posts (SQLite FTS5).
// At larger scale this module becomes the writer for a dedicated engine (OpenSearch/Meilisearch/Typesense).
import { all, get, parseJson, run, tx } from '../db/index.ts';

export type IndexKind = 'person' | 'business' | 'service' | 'product' | 'job' | 'post';

function put(kind: IndexKind, refId: number, doc: { title: string; body?: string | null; tags?: string | null; city?: string | null }) {
  run(
    'INSERT INTO search_index (kind, ref_id, title, body, tags, city) VALUES (?,?,?,?,?,?)',
    kind, refId, doc.title, doc.body ?? '', doc.tags ?? '', doc.city ?? '',
  );
}

export function unindex(kind: IndexKind, refId: number) {
  run('DELETE FROM search_index WHERE kind = ? AND ref_id = ?', kind, refId);
}

export function reindexUser(userId: number) {
  tx(() => {
    unindex('person', userId);
    unindex('business', userId);
    unindex('service', userId);
    const u = get("SELECT * FROM users WHERE id = ? AND status = 'active'", userId);
    if (!u) return;
    const b = get('SELECT * FROM businesses WHERE user_id = ?', userId);
    if (b) {
      const services = parseJson<string[]>(b.services, []);
      const lines = parseJson<string[]>(b.product_lines, []).concat(parseJson<string[]>(b.wholesale_categories, []));
      put('business', userId, {
        title: `${b.name} @${u.username}`,
        body: [b.description, services.join(', '), lines.join(', '), b.address].filter(Boolean).join(' · '),
        tags: [b.kind, b.category, b.custom_category].filter(Boolean).join(' '),
        city: [u.city, u.region, u.country].filter(Boolean).join(' '),
      });
      for (const s of services) put('service', userId, { title: s, body: `${b.name} ${b.description ?? ''}`, tags: b.category, city: u.city });
      return;
    }
    if (u.account_type !== 'personal') return;
    const p = get('SELECT * FROM profiles WHERE user_id = ?', userId);
    const skills = all("SELECT data FROM cv_items WHERE user_id = ? AND section IN ('skill','experience') AND visibility = 'public'", userId)
      .map((r) => {
        const d = parseJson<Record<string, string>>(r.data, {});
        return d.name ?? d.position ?? '';
      })
      .filter(Boolean);
    put('person', userId, {
      title: `${u.display_name} @${u.username}`,
      body: [p?.headline, p?.summary, u.bio].filter(Boolean).join(' · '),
      tags: skills.join(' '),
      city: [u.city, u.region, u.country].filter(Boolean).join(' '),
    });
  });
}

export function reindexProduct(id: number) {
  tx(() => {
    unindex('product', id);
    const p = get("SELECT p.*, b.name AS seller_name FROM products p LEFT JOIN businesses b ON b.user_id = p.seller_id WHERE p.id = ? AND p.status = 'active'", id);
    if (!p) return;
    put('product', id, {
      title: p.name,
      body: [p.description, p.seller_name].filter(Boolean).join(' · '),
      tags: [p.category, p.sale_type].join(' '),
      city: p.city,
    });
  });
}

export function reindexJob(id: number) {
  tx(() => {
    unindex('job', id);
    const j = get("SELECT j.*, b.name AS company_name FROM jobs j LEFT JOIN businesses b ON b.user_id = j.company_id WHERE j.id = ? AND j.status = 'open'", id);
    if (!j) return;
    put('job', id, {
      title: j.title,
      body: [j.company_name, j.department, j.description].filter(Boolean).join(' · '),
      tags: [j.industry, j.employment_type, ...parseJson<string[]>(j.skills, [])].filter(Boolean).join(' '),
      city: [j.city, j.location_text, j.remote ? 'remote' : ''].filter(Boolean).join(' '),
    });
  });
}

export function reindexPost(id: number) {
  tx(() => {
    unindex('post', id);
    const p = get("SELECT * FROM posts WHERE id = ? AND status = 'active'", id);
    if (!p || !p.body) return;
    const tags = all('SELECT tag FROM post_tags WHERE post_id = ?', id).map((r) => r.tag);
    put('post', id, { title: p.body.slice(0, 120), body: p.body, tags: [p.kind, p.category, ...tags].filter(Boolean).join(' '), city: p.city });
  });
}

const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'at', 'for', 'to', 'with', 'by', 'me', 'my', 'find', 'show', 'around', 'near', 'that', 'are', 'is', 'who']);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => !STOP.has(t)).slice(0, 10);
}

/** Runs an FTS query (AND first, OR fallback) and returns matching ref ids per kind, best first. */
export function searchIds(kinds: IndexKind[], text: string, limit = 50): { kind: IndexKind; ref_id: number }[] {
  const toks = tokenize(text);
  if (!toks.length || !kinds.length) return [];
  const kindList = kinds.map(() => '?').join(',');
  const exec = (q: string) =>
    all<{ kind: IndexKind; ref_id: number }>(
      `SELECT kind, ref_id FROM search_index WHERE search_index MATCH ? AND kind IN (${kindList})
       ORDER BY bm25(search_index, 0, 0, 10.0, 3.0, 5.0, 2.0) LIMIT ?`,
      q, ...kinds, limit,
    );
  const quoted = toks.map((t) => `"${t}"*`);
  let rows = exec(quoted.join(' AND '));
  if (rows.length < 3 && quoted.length > 1) {
    const seen = new Set(rows.map((r) => `${r.kind}:${r.ref_id}`));
    for (const r of exec(quoted.join(' OR '))) if (!seen.has(`${r.kind}:${r.ref_id}`)) rows.push(r);
    rows = rows.slice(0, limit);
  }
  return rows.map((r) => ({ kind: r.kind, ref_id: Number(r.ref_id) }));
}

export function rebuildIndex() {
  tx(() => {
    run('DELETE FROM search_index');
    for (const r of all("SELECT id FROM users WHERE status = 'active'")) reindexUser(r.id);
    for (const r of all("SELECT id FROM products WHERE status = 'active'")) reindexProduct(r.id);
    for (const r of all("SELECT id FROM jobs WHERE status = 'open'")) reindexJob(r.id);
    for (const r of all("SELECT id FROM posts WHERE status = 'active'")) reindexPost(r.id);
  });
}
