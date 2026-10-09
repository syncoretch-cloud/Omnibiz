// Admin portal API (spec §26). Every route checks a staff permission; every mutation is audited.
import { Router } from 'express';
import { all, get, parseJson, qs, run, tx, sqlTime, DAY } from '../db/index.ts';
import type { Row } from '../db/index.ts';
import { badRequest, forbidden, intParam, notFound, paging, qStr, validate } from '../lib/http.ts';
import { audit, requireStaff } from '../lib/auth.ts';
import { STAFF_RANK } from '../lib/permissions.ts';
import { ACCOUNT_TYPES, REPORT_REASONS } from '../lib/constants.ts';
import { emit } from '../lib/queue.ts';
import { requireAuth } from '../lib/auth.ts';
import { userCards } from '../services/users.ts';
import { notify } from '../services/notify.ts';
import { reindexJob, reindexPost, reindexProduct, reindexUser, unindex } from '../services/search-index.ts';
import { sendEmail } from '../lib/outbox.ts';

export const adminRouter = Router();
export const reportsRouter = Router();

// ───────────── user-facing reporting ─────────────
reportsRouter.post('/', requireAuth, (req, res) => {
  const d = validate(req.body, {
    target_type: { type: 'enum', values: ['user', 'post', 'comment', 'product', 'job', 'message'], required: true },
    target_id: { type: 'int', required: true, min: 1 },
    reason: { type: 'enum', values: REPORT_REASONS, required: true },
    details: { type: 'text', max: 2000 },
  });
  const table: Record<string, string> = { user: 'users', post: 'posts', comment: 'comments', product: 'products', job: 'jobs', message: 'messages' };
  if (!get(`SELECT 1 AS x FROM ${table[d.target_type]} WHERE id = ?`, d.target_id)) throw notFound('Reported item');
  run('INSERT OR IGNORE INTO reports (reporter_id, target_type, target_id, reason, details) VALUES (?,?,?,?,?)', req.user!.id, d.target_type, d.target_id, d.reason, d.details ?? null);
  emit('report.created', { targetType: d.target_type, targetId: d.target_id });
  res.status(201).json({ ok: true, message: 'Thanks — our moderation team will review this.' });
});

// ───────────── statistics ─────────────
adminRouter.get('/stats', requireStaff('stats'), (_req, res) => {
  const since = sqlTime(-30 * DAY);
  const byType = Object.fromEntries(all("SELECT account_type, COUNT(*) AS n FROM users WHERE status != 'deleted' GROUP BY account_type").map((r) => [r.account_type, r.n]));
  const c = (sql: string, ...p: unknown[]) => get(sql, ...p)!.n as number;
  res.json({
    users: { total: c("SELECT COUNT(*) AS n FROM users WHERE status != 'deleted'"), by_type: byType, suspended: c("SELECT COUNT(*) AS n FROM users WHERE status = 'suspended'"), new_30d: c('SELECT COUNT(*) AS n FROM users WHERE created_at > ?', since) },
    content: {
      posts: c("SELECT COUNT(*) AS n FROM posts WHERE status = 'active'"),
      products: c("SELECT COUNT(*) AS n FROM products WHERE status = 'active'"),
      jobs_open: c("SELECT COUNT(*) AS n FROM jobs WHERE status = 'open'"),
      applications: c('SELECT COUNT(*) AS n FROM applications'),
      orders: c('SELECT COUNT(*) AS n FROM orders'),
      gmv: get("SELECT COALESCE(SUM(subtotal), 0) AS n FROM orders WHERE status != 'cancelled'")!.n,
      flagged: c("SELECT (SELECT COUNT(*) FROM posts WHERE status = 'flagged') + (SELECT COUNT(*) FROM products WHERE status = 'flagged') + (SELECT COUNT(*) FROM jobs WHERE status = 'flagged') AS n"),
    },
    queues: {
      open_reports: c("SELECT COUNT(*) AS n FROM reports WHERE status IN ('open','reviewing')"),
      pending_verifications: c("SELECT COUNT(*) AS n FROM verification_requests WHERE status = 'pending'"),
      suspicious_logins_7d: c('SELECT COUNT(*) AS n FROM login_events WHERE suspicious = 1 AND created_at > ?', sqlTime(-7 * DAY)),
    },
    signups: all('SELECT date(created_at) AS day, COUNT(*) AS n FROM users WHERE created_at > ? GROUP BY day ORDER BY day', since),
    activity: all('SELECT date(created_at) AS day, COUNT(*) AS n FROM posts WHERE created_at > ? GROUP BY day ORDER BY day', since),
  });
});

// ───────────── users ─────────────
adminRouter.get('/users', requireStaff('users.view'), (req, res) => {
  const { limit, offset } = paging(req, 30, 100);
  const where = ["u.status != 'deleted'"];
  const params: unknown[] = [];
  const q = qStr(req, 'q');
  if (q) { where.push('(u.username LIKE ? OR u.email LIKE ? OR u.display_name LIKE ? OR u.phone LIKE ?)'); params.push(...Array(4).fill(`%${q}%`)); }
  const type = qStr(req, 'type');
  if (type && (ACCOUNT_TYPES as readonly string[]).includes(type)) { where.push('u.account_type = ?'); params.push(type); }
  const status = qStr(req, 'status');
  if (status) { where.push('u.status = ?'); params.push(status); }
  if (req.query.staff === '1') where.push("u.role != 'user'");
  const rows = all(
    `SELECT u.id, u.username, u.email, u.phone, u.display_name, u.account_type, u.role, u.status, u.city, u.created_at, u.last_login_at,
       u.email_verified, u.phone_verified, b.verified,
       (SELECT COUNT(*) FROM reports r WHERE r.target_type = 'user' AND r.target_id = u.id) AS reports
     FROM users u LEFT JOIN businesses b ON b.user_id = u.id WHERE ${where.join(' AND ')} ORDER BY u.id DESC LIMIT ? OFFSET ?`,
    ...params, limit, offset,
  );
  const total = get(`SELECT COUNT(*) AS n FROM users u WHERE ${where.join(' AND ')}`, ...params)!.n;
  res.json({ users: rows, total });
});

adminRouter.get('/users/:id', requireStaff('users.view'), (req, res) => {
  const u = get('SELECT * FROM users WHERE id = ?', intParam(req));
  if (!u) throw notFound('User');
  delete u.password_hash;
  delete u.totp_secret_enc;
  res.json({
    user: u,
    business: get('SELECT * FROM businesses WHERE user_id = ?', u.id) ?? null,
    logins: all('SELECT ip, user_agent, success, suspicious, created_at FROM login_events WHERE user_id = ? ORDER BY id DESC LIMIT 20', u.id),
    reports: all("SELECT * FROM reports WHERE target_type = 'user' AND target_id = ? ORDER BY id DESC", u.id),
    counts: get(
      `SELECT (SELECT COUNT(*) FROM posts WHERE author_id = ?) AS posts, (SELECT COUNT(*) FROM products WHERE seller_id = ?) AS products,
              (SELECT COUNT(*) FROM jobs WHERE company_id = ?) AS jobs, (SELECT COUNT(*) FROM applications WHERE applicant_id = ?) AS applications`,
      u.id, u.id, u.id, u.id,
    ),
    audit: all("SELECT * FROM audit_log WHERE target_type = 'user' AND target_id = ? ORDER BY id DESC LIMIT 30", u.id),
  });
});

function assertOutranks(actorRole: string, targetRole: string) {
  if (STAFF_RANK.indexOf(actorRole) <= STAFF_RANK.indexOf(targetRole)) throw forbidden('You cannot act on an account with an equal or higher role');
}

adminRouter.post('/users/:id/suspend', requireStaff('users.suspend'), (req, res) => {
  const { reason } = validate(req.body, { reason: { type: 'text', required: true, max: 500 } });
  const u = get('SELECT * FROM users WHERE id = ?', intParam(req));
  if (!u) throw notFound('User');
  assertOutranks(req.user!.role, u.role);
  tx(() => {
    run("UPDATE users SET status = 'suspended', suspended_reason = ? WHERE id = ?", reason, u.id);
    run('DELETE FROM sessions WHERE user_id = ?', u.id);
  });
  reindexUser(u.id);
  audit(req.user!.id, 'user.suspend', 'user', u.id, { reason });
  sendEmail(u.email, 'Your OmniBiz account has been suspended', `Reason: ${reason}. Contact support if you believe this is a mistake.`);
  res.json({ ok: true });
});

adminRouter.post('/users/:id/unsuspend', requireStaff('users.suspend'), (req, res) => {
  const u = get('SELECT * FROM users WHERE id = ?', intParam(req));
  if (!u) throw notFound('User');
  run("UPDATE users SET status = 'active', suspended_reason = NULL WHERE id = ?", u.id);
  reindexUser(u.id);
  audit(req.user!.id, 'user.unsuspend', 'user', u.id);
  res.json({ ok: true });
});

adminRouter.post('/users/:id/role', requireStaff('*'), (req, res) => {
  const { role } = validate(req.body, { role: { type: 'enum', values: STAFF_RANK, required: true } });
  const u = get('SELECT * FROM users WHERE id = ?', intParam(req));
  if (!u) throw notFound('User');
  if (u.id === req.user!.id) throw badRequest('You cannot change your own role');
  run('UPDATE users SET role = ? WHERE id = ?', role, u.id);
  audit(req.user!.id, 'user.role', 'user', u.id, { from: u.role, to: role });
  res.json({ ok: true });
});

// ───────────── content moderation ─────────────
const CONTENT: Record<string, { table: string; active: string; reindex?: (id: number) => void; kind?: 'post' | 'product' | 'job' }> = {
  posts: { table: 'posts', active: 'active', reindex: reindexPost, kind: 'post' },
  comments: { table: 'comments', active: 'active' },
  products: { table: 'products', active: 'active', reindex: reindexProduct, kind: 'product' },
  jobs: { table: 'jobs', active: 'open', reindex: reindexJob, kind: 'job' },
};

adminRouter.get('/content/:type', requireStaff('content'), (req, res) => {
  const c = CONTENT[String(req.params.type)];
  if (!c) throw notFound();
  const { limit, offset } = paging(req, 30, 100);
  const status = qStr(req, 'status');
  const q = qStr(req, 'q');
  const textCol = { posts: 'body', comments: 'body', products: 'name', jobs: 'title' }[String(req.params.type)]!;
  const ownerCol = { posts: 'author_id', comments: 'author_id', products: 'seller_id', jobs: 'company_id' }[String(req.params.type)]!;
  const rows = all(
    `SELECT t.*, (SELECT COUNT(*) FROM reports r WHERE r.target_type = ? AND r.target_id = t.id) AS reports FROM ${c.table} t
     WHERE 1 = 1 ${status ? 'AND t.status = ?' : ''} ${q ? `AND t.${textCol} LIKE ?` : ''} ORDER BY t.id DESC LIMIT ? OFFSET ?`,
    String(req.params.type).replace(/s$/, ''), ...(status ? [status] : []), ...(q ? [`%${q}%`] : []), limit, offset,
  );
  const cards = userCards(rows.map((r) => r[ownerCol]));
  res.json({ items: rows.map((r) => ({ id: r.id, text: String(r[textCol]).slice(0, 300), status: r.status, created_at: r.created_at, reports: r.reports, owner: cards.get(r[ownerCol]) })) });
});

function setContentStatus(type: string, id: number, status: 'removed' | 'restore', actorId: number) {
  const c = CONTENT[type];
  if (!c) throw notFound();
  const row = get(`SELECT * FROM ${c.table} WHERE id = ?`, id);
  if (!row) throw notFound();
  run(`UPDATE ${c.table} SET status = ? WHERE id = ?`, status === 'restore' ? c.active : 'removed', id);
  if (c.kind) {
    if (status === 'restore') c.reindex?.(id);
    else unindex(c.kind, id);
  }
  audit(actorId, `content.${status}`, type, id);
  return row;
}

adminRouter.post('/content/:type/:id/remove', requireStaff('content'), (req, res) => {
  const { reason } = validate(req.body, { reason: { type: 'text', max: 500 } });
  const row = setContentStatus(String(req.params.type), intParam(req), 'removed', req.user!.id);
  const owner = row.author_id ?? row.seller_id ?? row.company_id;
  notify([owner], { type: 'system', title: 'Some of your content was removed', body: reason ?? 'It did not meet the OmniBiz community guidelines.' });
  res.json({ ok: true });
});

adminRouter.post('/content/:type/:id/restore', requireStaff('content'), (req, res) => {
  setContentStatus(String(req.params.type), intParam(req), 'restore', req.user!.id);
  res.json({ ok: true });
});

// ───────────── reports queue ─────────────
adminRouter.get('/reports', requireStaff('reports'), (req, res) => {
  const status = qStr(req, 'status') ?? 'open';
  const rows = all(
    `SELECT target_type, target_id, COUNT(*) AS count, GROUP_CONCAT(DISTINCT reason) AS reasons, MIN(created_at) AS first_at, MAX(id) AS latest_id,
       MAX(status) AS status
     FROM reports WHERE status = ? GROUP BY target_type, target_id ORDER BY count DESC, first_at ASC LIMIT 100`,
    status,
  );
  const items = rows.map((r) => {
    const preview = previewTarget(r.target_type, r.target_id);
    const details = all('SELECT reason, details, created_at FROM reports WHERE target_type = ? AND target_id = ? ORDER BY id DESC LIMIT 5', r.target_type, r.target_id);
    return { ...r, reasons: String(r.reasons).split(','), preview, details };
  });
  res.json({ items });
});

function previewTarget(type: string, id: number): Row | null {
  switch (type) {
    case 'user': {
      const u = get('SELECT id, username, display_name, status, account_type FROM users WHERE id = ?', id);
      return u ? { text: `${u.display_name} (@${u.username}, ${u.account_type})`, status: u.status, link: `/u/${u.username}`, owner_id: u.id } : null;
    }
    case 'post': {
      const p = get('SELECT id, body, status, author_id FROM posts WHERE id = ?', id);
      return p ? { text: p.body.slice(0, 300), status: p.status, link: `/posts/${p.id}`, owner_id: p.author_id } : null;
    }
    case 'comment': {
      const c = get('SELECT id, body, status, author_id, post_id FROM comments WHERE id = ?', id);
      return c ? { text: c.body.slice(0, 300), status: c.status, link: `/posts/${c.post_id}`, owner_id: c.author_id } : null;
    }
    case 'product': {
      const p = get('SELECT id, name, status, seller_id FROM products WHERE id = ?', id);
      return p ? { text: p.name, status: p.status, link: `/marketplace/${p.id}`, owner_id: p.seller_id } : null;
    }
    case 'job': {
      const j = get('SELECT id, title, status, company_id FROM jobs WHERE id = ?', id);
      return j ? { text: j.title, status: j.status, link: `/jobs/${j.id}`, owner_id: j.company_id } : null;
    }
    case 'message': {
      const m = get('SELECT id, body, sender_id FROM messages WHERE id = ?', id);
      return m ? { text: m.body.slice(0, 300), status: 'n/a', owner_id: m.sender_id } : null;
    }
  }
  return null;
}

adminRouter.post('/reports/resolve', requireStaff('reports'), (req, res) => {
  const d = validate(req.body, {
    target_type: { type: 'string', required: true, max: 20 },
    target_id: { type: 'int', required: true, min: 1 },
    decision: { type: 'enum', values: ['dismiss', 'remove_content', 'suspend_user'], required: true },
    resolution: { type: 'text', max: 1000 },
  });
  const preview = previewTarget(d.target_type, d.target_id);
  if (!preview) throw notFound('Reported item');
  if (d.decision === 'remove_content') {
    const type = { post: 'posts', comment: 'comments', product: 'products', job: 'jobs' }[d.target_type as string];
    if (!type) throw badRequest('This item cannot be removed — suspend the user instead');
    setContentStatus(type, d.target_id, 'removed', req.user!.id);
  }
  if (d.decision === 'suspend_user') {
    const owner = get('SELECT * FROM users WHERE id = ?', preview.owner_id);
    if (owner) {
      assertOutranks(req.user!.role, owner.role);
      run("UPDATE users SET status = 'suspended', suspended_reason = ? WHERE id = ?", d.resolution ?? 'Violation of community guidelines', owner.id);
      run('DELETE FROM sessions WHERE user_id = ?', owner.id);
      reindexUser(owner.id);
      audit(req.user!.id, 'user.suspend', 'user', owner.id, { via: 'report' });
    }
  }
  if (d.decision === 'dismiss') {
    // Restore content that was auto-flagged pending review.
    const type = { post: 'posts', product: 'products', job: 'jobs', comment: 'comments' }[d.target_type as string];
    if (type && preview.status === 'flagged') setContentStatus(type, d.target_id, 'restore', req.user!.id);
  }
  run(
    "UPDATE reports SET status = ?, handled_by = ?, resolution = ?, handled_at = datetime('now') WHERE target_type = ? AND target_id = ? AND status IN ('open','reviewing')",
    d.decision === 'dismiss' ? 'dismissed' : 'actioned', req.user!.id, d.resolution ?? d.decision, d.target_type, d.target_id,
  );
  audit(req.user!.id, `report.${d.decision}`, d.target_type, d.target_id, { resolution: d.resolution });
  res.json({ ok: true });
});

// ───────────── business verification ─────────────
adminRouter.get('/verifications', requireStaff('verification'), (req, res) => {
  const status = qStr(req, 'status') ?? 'pending';
  const rows = all('SELECT * FROM verification_requests WHERE status = ? ORDER BY id ASC LIMIT 100', status);
  const cards = userCards(rows.map((r) => r.user_id));
  res.json({
    items: rows.map((r) => {
      const ids = parseJson<number[]>(r.document_ids, []);
      const b = get('SELECT name, kind, category, address, contact_email, contact_phone, website, registration_number_enc FROM businesses WHERE user_id = ?', r.user_id);
      const u = get('SELECT email_verified, phone_verified, created_at FROM users WHERE id = ?', r.user_id);
      return {
        ...r,
        user: cards.get(r.user_id),
        business: b ? { ...b, registration_number_enc: undefined, has_registration_number: !!b.registration_number_enc } : null,
        checks: u,
        documents: ids.length ? all(`SELECT id, kind, name, mime FROM documents WHERE id IN (${qs(ids.length)})`, ...ids).map((d) => ({ ...d, url: `/api/documents/${d.id}/file` })) : [],
      };
    }),
  });
});

adminRouter.post('/verifications/:id', requireStaff('verification'), (req, res) => {
  const d = validate(req.body, { decision: { type: 'enum', values: ['approve', 'reject'], required: true }, notes: { type: 'text', max: 1000 } });
  const v = get("SELECT * FROM verification_requests WHERE id = ? AND status = 'pending'", intParam(req));
  if (!v) throw notFound('Pending request');
  const approved = d.decision === 'approve';
  tx(() => {
    run("UPDATE verification_requests SET status = ?, reviewer_id = ?, review_notes = ?, reviewed_at = datetime('now') WHERE id = ?", approved ? 'approved' : 'rejected', req.user!.id, d.notes ?? null, v.id);
    run('UPDATE businesses SET verified = ?, verification_status = ? WHERE user_id = ?', approved, approved ? 'verified' : 'rejected', v.user_id);
  });
  audit(req.user!.id, `verification.${d.decision}`, 'user', v.user_id, { notes: d.notes });
  notify([v.user_id], {
    type: 'verification',
    title: approved ? 'Your business is now verified ✓' : 'Business verification was not approved',
    body: approved ? 'The Verified Business badge now appears on your profile.' : (d.notes ?? 'Please check your documents and try again.'),
    link: '/settings/business',
  });
  res.json({ ok: true });
});

// ───────────── categories ─────────────
adminRouter.get('/categories', requireStaff('categories'), (_req, res) => {
  res.json({ categories: all('SELECT * FROM categories ORDER BY scope, sort, name') });
});

adminRouter.post('/categories', requireStaff('categories'), (req, res) => {
  const d = validate(req.body, { scope: { type: 'enum', values: ['industry', 'product'], required: true }, name: { type: 'string', required: true, max: 60 } });
  const slug = d.name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (get('SELECT 1 AS x FROM categories WHERE scope = ? AND slug = ?', d.scope, slug)) throw badRequest('That category already exists');
  const { id } = run('INSERT INTO categories (scope, slug, name, sort) VALUES (?,?,?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM categories WHERE scope = ?))', d.scope, slug, d.name, d.scope);
  audit(req.user!.id, 'category.create', 'category', id, d);
  res.status(201).json({ id, slug });
});

adminRouter.patch('/categories/:id', requireStaff('categories'), (req, res) => {
  const d = validate(req.body, { name: { type: 'string', max: 60 }, active: { type: 'bool' } }, { partial: true });
  const c = get('SELECT * FROM categories WHERE id = ?', intParam(req));
  if (!c) throw notFound('Category');
  run('UPDATE categories SET name = ?, active = ? WHERE id = ?', d.name ?? c.name, d.active ?? c.active, c.id);
  audit(req.user!.id, 'category.update', 'category', c.id, d);
  res.json({ ok: true });
});

// ───────────── platform broadcast ─────────────
adminRouter.post('/broadcast', requireStaff('broadcast'), (req, res) => {
  const d = validate(req.body, {
    title: { type: 'string', required: true, max: 160 },
    body: { type: 'text', max: 1000 },
    link: { type: 'string', max: 200 },
    account_type: { type: 'enum', values: ACCOUNT_TYPES },
    city: { type: 'string', max: 60 },
    interest: { type: 'string', max: 50 },
  });
  const where = ["u.status = 'active'"];
  const params: unknown[] = [];
  if (d.account_type) { where.push('u.account_type = ?'); params.push(d.account_type); }
  if (d.city) { where.push('u.city = ? COLLATE NOCASE'); params.push(d.city); }
  if (d.interest) { where.push('u.id IN (SELECT user_id FROM user_interests WHERE slug = ?)'); params.push(d.interest); }
  const ids = all(`SELECT u.id FROM users u WHERE ${where.join(' AND ')}`, ...params).map((r) => r.id as number);
  const sent = notify(ids, { type: 'system', title: d.title, body: d.body, link: d.link?.startsWith('/') ? d.link : null });
  audit(req.user!.id, 'broadcast', null, null, { ...d, recipients: sent });
  res.json({ sent });
});

adminRouter.get('/audit', requireStaff('audit'), (req, res) => {
  const { limit, offset } = paging(req, 50, 200);
  const rows = all('SELECT * FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?', limit, offset);
  const cards = userCards(rows.map((r) => r.actor_id));
  res.json({ items: rows.map((r) => ({ ...r, details: parseJson(r.details, null), actor: cards.get(r.actor_id) })) });
});
