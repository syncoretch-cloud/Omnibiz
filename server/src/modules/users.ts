import { Router } from 'express';
import type { Request } from 'express';
import { all, get, parseJson, run, tx } from '../db/index.ts';
import type { Row } from '../db/index.ts';
import { badRequest, conflict, notFound, paging, validate } from '../lib/http.ts';
import type { Spec } from '../lib/http.ts';
import { requireAuth, requirePerm } from '../lib/auth.ts';
import { EDUCATION_LEVELS, EMPLOYMENT_TYPES, VISIBILITY, isBusiness } from '../lib/constants.ts';
import { staffCan } from '../lib/permissions.ts';
import { canonicalCity, cityCoords, coarsen } from '../lib/geo.ts';
import { userCards } from '../services/users.ts';
import { reindexUser } from '../services/search-index.ts';
import { notify } from '../services/notify.ts';
import { track } from '../services/analytics.ts';
import { interestWeights, recordActivity, followedIds } from '../services/personalization.ts';
import { sendEmail } from '../lib/outbox.ts';
import { randomCode, sha256 } from '../lib/crypto.ts';
import { sqlTime, MINUTE } from '../db/index.ts';
import { buildMe } from './auth.ts';

export const usersRouter = Router();

// ───────────── visibility ─────────────
type Audience = 'owner' | 'recruiter' | 'public';

export function audienceFor(req: Request, ownerId: number): Audience {
  const v = req.user;
  if (!v) return 'public';
  if (v.id === ownerId || staffCan(v.role, 'users.view')) return 'owner';
  if (v.account_type === 'company') return 'recruiter';
  return 'public';
}

export function visibleTo(aud: Audience, visibility: string) {
  if (aud === 'owner') return true;
  if (aud === 'recruiter') return visibility !== 'private';
  return visibility === 'public';
}

export function cvFor(ownerId: number, aud: Audience) {
  const items = all('SELECT * FROM cv_items WHERE user_id = ? ORDER BY section, sort, id', ownerId);
  const cv: Record<string, Row[]> = { skill: [], education: [], experience: [], certification: [], language: [], portfolio: [] };
  for (const it of items) {
    if (!visibleTo(aud, it.visibility)) continue;
    cv[it.section].push({ id: it.id, visibility: it.visibility, ...parseJson<Row>(it.data, {}) });
  }
  return cv;
}

export function documentsFor(ownerId: number, aud: Audience) {
  return all('SELECT id, kind, name, mime, size, visibility, created_at FROM documents WHERE owner_id = ? ORDER BY id DESC', ownerId)
    .filter((d) => visibleTo(aud, d.visibility))
    .map((d) => ({ ...d, url: `/api/documents/${d.id}/file` }));
}

function ratingFor(sellerId: number) {
  const r = get('SELECT AVG(rating) AS avg, COUNT(*) AS count FROM reviews WHERE seller_id = ?', sellerId);
  return { avg: r?.avg ? Math.round(r.avg * 10) / 10 : null, count: r?.count ?? 0 };
}

// ───────────── public profile ─────────────
usersRouter.get('/suggestions', requireAuth, (req, res) => {
  const me = req.user!;
  const weights = interestWeights(me.id);
  const following = followedIds(me.id);
  const rows = all(
    `SELECT u.id, u.city, b.category, b.verified,
       (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) AS followers
     FROM users u JOIN businesses b ON b.user_id = u.id
     WHERE u.status = 'active' AND u.id != ? LIMIT 2000`,
    me.id,
  ).filter((r) => !following.has(r.id));
  const scored = rows
    .map((r) => ({
      id: r.id as number,
      score: (weights.get(r.category) ?? 0) * 10 + (r.city && r.city === me.city ? 4 : 0) + (r.verified ? 2 : 0) + Math.log1p(r.followers),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Number(req.query.limit) || 8);
  const cards = userCards(scored.map((s) => s.id));
  res.json({ users: scored.map((s) => cards.get(s.id)).filter(Boolean) });
});

usersRouter.get('/:username', (req, res) => {
  const param = String(req.params.username);
  const u = /^\d+$/.test(param)
    ? get("SELECT * FROM users WHERE id = ? AND status != 'deleted'", Number(param))
    : get("SELECT * FROM users WHERE username = ? AND status != 'deleted'", param);
  if (!u) throw notFound('Profile');
  const aud = audienceFor(req, u.id);
  if (u.status === 'suspended' && aud !== 'owner') throw notFound('Profile');

  const stats = get(
    `SELECT (SELECT COUNT(*) FROM follows WHERE followee_id = ?) AS followers,
            (SELECT COUNT(*) FROM follows WHERE follower_id = ?) AS following,
            (SELECT COUNT(*) FROM posts WHERE author_id = ? AND status = 'active') AS posts,
            (SELECT COUNT(*) FROM products WHERE seller_id = ? AND status = 'active') AS products,
            (SELECT COUNT(*) FROM jobs WHERE company_id = ? AND status = 'open') AS jobs`,
    u.id, u.id, u.id, u.id, u.id,
  );

  const out: Row = {
    user: {
      id: u.id, username: u.username, display_name: u.display_name, account_type: u.account_type,
      avatar_url: u.avatar_url, cover_url: u.cover_url, bio: u.bio, country: u.country, region: u.region, city: u.city,
      created_at: u.created_at, status: aud === 'owner' ? u.status : undefined,
    },
    stats,
    viewer: {
      is_self: req.user?.id === u.id,
      following: !!(req.user && get('SELECT 1 AS x FROM follows WHERE follower_id = ? AND followee_id = ?', req.user.id, u.id)),
      saved: !!(req.user && get("SELECT 1 AS x FROM saves WHERE user_id = ? AND target_type = 'business' AND target_id = ?", req.user.id, u.id)),
    },
  };

  if (isBusiness(u.account_type)) {
    const b = get('SELECT * FROM businesses WHERE user_id = ?', u.id)!;
    out.business = {
      ...b,
      registration_number_enc: undefined,
      has_registration_number: !!b.registration_number_enc,
      verified: !!b.verified,
      portfolio_links: parseJson(b.portfolio_links, []),
      services: parseJson(b.services, []),
      product_lines: parseJson(b.product_lines, []),
      wholesale_categories: parseJson(b.wholesale_categories, []),
    };
    out.location = u.lat != null ? { lat: u.lat, lng: u.lng } : cityCoords(u.city);
    out.rating = ratingFor(u.id);
    if (req.user?.id !== u.id) {
      track({ ownerId: u.id, actorId: req.user?.id, type: 'profile_view', source: String(req.query.src ?? 'direct') });
      recordActivity(req.user?.id, 'view_business', { category: b.category, targetType: 'business', targetId: u.id });
    }
  } else if (u.account_type === 'personal') {
    const p = get('SELECT * FROM profiles WHERE user_id = ?', u.id);
    const fv = parseJson<Record<string, string>>(p?.field_visibility, {});
    out.profile = {
      full_name: p?.full_name, headline: p?.headline, summary: p?.summary, open_to_work: !!p?.open_to_work,
      preferred_industries: parseJson(p?.preferred_industries, []), preferred_locations: parseJson(p?.preferred_locations, []),
      job_types: parseJson(p?.job_types, []),
      email: visibleTo(aud, fv.email ?? 'recruiters') ? u.email : undefined,
      phone: visibleTo(aud, fv.phone ?? 'recruiters') ? u.phone : undefined,
      dob: visibleTo(aud, fv.dob ?? 'private') ? p?.dob : undefined,
      field_visibility: aud === 'owner' ? fv : undefined,
    };
    out.cv = cvFor(u.id, aud);
    out.documents = documentsFor(u.id, aud);
  }
  res.json(out);
});

usersRouter.get('/:id/followers', (req, res) => {
  const id = Number(req.params.id);
  const { limit, offset } = paging(req, 30);
  const ids = all('SELECT follower_id AS id FROM follows WHERE followee_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?', id, limit, offset).map((r) => r.id);
  const cards = userCards(ids);
  res.json({ users: ids.map((i) => cards.get(i)).filter(Boolean) });
});

usersRouter.get('/:id/following', (req, res) => {
  const id = Number(req.params.id);
  const { limit, offset } = paging(req, 30);
  const ids = all('SELECT followee_id AS id FROM follows WHERE follower_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?', id, limit, offset).map((r) => r.id);
  const cards = userCards(ids);
  res.json({ users: ids.map((i) => cards.get(i)).filter(Boolean) });
});

// ───────────── follow ─────────────
usersRouter.post('/:id/follow', requirePerm('follow'), (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user!.id) throw badRequest('You cannot follow yourself');
  const target = get("SELECT id, account_type FROM users WHERE id = ? AND status = 'active'", id);
  if (!target) throw notFound('Account');
  const { changes } = run('INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?,?)', req.user!.id, id);
  if (changes) {
    notify([id], { type: 'follow', title: `${req.user!.display_name} started following you`, link: `/u/${req.user!.username}`, actorId: req.user!.id });
    track({ ownerId: id, actorId: req.user!.id, type: 'follow' });
  }
  res.json({ following: true });
});

usersRouter.delete('/:id/follow', requireAuth, (req, res) => {
  run('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?', req.user!.id, Number(req.params.id));
  res.json({ following: false });
});

// ───────────── own account ─────────────
usersRouter.patch('/me', requireAuth, (req, res) => {
  const me = req.user!;
  const d = validate(req.body, {
    display_name: { type: 'string', min: 2, max: 100 },
    bio: { type: 'text', max: 1000 },
    avatar_url: { type: 'string', max: 300 },
    cover_url: { type: 'string', max: 300 },
    email: { type: 'email' },
    phone: { type: 'string', max: 20 },
    country: { type: 'string', max: 60 },
    region: { type: 'string', max: 60 },
    city: { type: 'string', max: 60 },
    lat: { type: 'number', min: -90, max: 90 },
    lng: { type: 'number', min: -180, max: 180 },
    share_precise_location: { type: 'bool' },
  }, { partial: true });

  for (const k of ['avatar_url', 'cover_url'] as const) {
    if (d[k] && !String(d[k]).startsWith('/uploads/media/') && !/^https:\/\//.test(d[k])) throw badRequest('Invalid image');
  }
  if (d.city !== undefined) {
    d.city = canonicalCity(d.city);
    if (d.lat === undefined && d.city) {
      const c = cityCoords(d.city);
      if (c) Object.assign(d, c);
    }
  }
  const precise = d.share_precise_location ?? !!get('SELECT share_precise_location AS s FROM users WHERE id = ?', me.id)!.s;
  if (d.lat != null && d.lng != null && !isBusiness(me.account_type) && !precise) Object.assign(d, coarsen(d.lat, d.lng));
  if (d.phone !== undefined && d.phone !== null) {
    d.phone = String(d.phone).replace(/[\s\-()]/g, '');
    if (!/^\+?\d{9,15}$/.test(d.phone)) throw badRequest('Enter a valid phone number');
    if (get('SELECT 1 AS x FROM users WHERE phone = ? AND id != ?', d.phone, me.id)) throw conflict('That phone number is in use');
    if (d.phone !== me.phone) d.phone_verified = 0;
  }
  if (d.email && d.email !== me.email) {
    if (get('SELECT 1 AS x FROM users WHERE email = ? AND id != ?', d.email, me.id)) throw conflict('That email is in use');
    d.email_verified = 0;
  }
  const keys = Object.keys(d);
  if (keys.length) run(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => d[k]), me.id);
  if (d.email_verified === 0) {
    const code = randomCode();
    run('INSERT INTO verification_codes (user_id, purpose, code_hash, target, expires_at) VALUES (?,?,?,?,?)', me.id, 'email', sha256(`${me.id}:${code}`), d.email, sqlTime(15 * MINUTE));
    sendEmail(d.email, 'Verify your new OmniBiz email', `Your verification code is ${code}.`);
  }
  if (d.display_name && isBusiness(me.account_type)) run('UPDATE businesses SET name = ? WHERE user_id = ?', d.display_name, me.id);
  reindexUser(me.id);
  res.json(buildMe(me.id));
});

usersRouter.patch('/me/profile', requirePerm('manage_cv'), (req, res) => {
  const d = validate(req.body, {
    full_name: { type: 'string', min: 2, max: 100 },
    dob: { type: 'date' },
    headline: { type: 'string', max: 160 },
    summary: { type: 'text', max: 3000 },
    open_to_work: { type: 'bool' },
    preferred_industries: { type: 'strings', max: 10 },
    preferred_locations: { type: 'strings', max: 10 },
    job_types: { type: 'strings', max: 6 },
    expected_salary: { type: 'number', min: 0 },
    field_visibility: { type: 'json' },
  }, { partial: true });
  if (d.job_types?.some((t: string) => !(EMPLOYMENT_TYPES as readonly string[]).includes(t))) throw badRequest('Invalid job type');
  if (d.field_visibility) {
    const fv: Record<string, string> = {};
    for (const k of ['email', 'phone', 'dob']) {
      const v = d.field_visibility[k];
      if (v !== undefined) {
        if (!(VISIBILITY as readonly string[]).includes(v)) throw badRequest('Invalid visibility');
        fv[k] = v;
      }
    }
    d.field_visibility = fv;
  }
  const keys = Object.keys(d);
  if (keys.length) run(`UPDATE profiles SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE user_id = ?`, ...keys.map((k) => d[k]), req.user!.id);
  if (d.full_name) run('UPDATE users SET display_name = ? WHERE id = ?', d.full_name, req.user!.id);
  reindexUser(req.user!.id);
  res.json(buildMe(req.user!.id));
});

usersRouter.put('/me/interests', requireAuth, (req, res) => {
  const { slugs } = validate(req.body, { slugs: { type: 'strings', required: true, max: 30 } });
  const valid = new Set(all("SELECT slug FROM categories WHERE scope = 'industry' AND active = 1").map((r) => r.slug));
  const chosen = (slugs as string[]).filter((s) => valid.has(s));
  tx(() => {
    run('DELETE FROM user_interests WHERE user_id = ?', req.user!.id);
    for (const s of chosen) run('INSERT INTO user_interests (user_id, slug) VALUES (?,?)', req.user!.id, s);
    run('UPDATE users SET onboarded = 1 WHERE id = ?', req.user!.id);
  });
  res.json(buildMe(req.user!.id));
});

// ───────────── CV builder ─────────────
const CV_SPECS: Record<string, Spec> = {
  skill: { name: { type: 'string', required: true, max: 60 }, level: { type: 'enum', values: ['beginner', 'intermediate', 'advanced', 'expert'] } },
  education: {
    school: { type: 'string', required: true, max: 120 }, program: { type: 'string', max: 120 },
    level: { type: 'enum', values: EDUCATION_LEVELS }, start_year: { type: 'int', min: 1950, max: 2100 },
    end_year: { type: 'int', min: 1950, max: 2100 }, achievements: { type: 'text', max: 1000 },
  },
  experience: {
    company: { type: 'string', required: true, max: 120 }, position: { type: 'string', required: true, max: 120 },
    responsibilities: { type: 'text', max: 2000 }, start_date: { type: 'string', max: 10 }, end_date: { type: 'string', max: 10 },
    current: { type: 'bool' },
  },
  certification: {
    name: { type: 'string', required: true, max: 120 }, issuer: { type: 'string', max: 120 },
    issued_on: { type: 'string', max: 10 }, url: { type: 'url' },
  },
  language: { name: { type: 'string', required: true, max: 40 }, proficiency: { type: 'enum', values: ['basic', 'conversational', 'fluent', 'native'] } },
  portfolio: {
    title: { type: 'string', required: true, max: 120 }, description: { type: 'text', max: 1500 },
    url: { type: 'url' }, media_url: { type: 'string', max: 300 },
  },
};

usersRouter.get('/me/cv', requirePerm('manage_cv'), (req, res) => {
  res.json({ cv: cvFor(req.user!.id, 'owner'), documents: documentsFor(req.user!.id, 'owner') });
});

usersRouter.post('/me/cv', requirePerm('manage_cv'), (req, res) => {
  const { section, visibility } = validate(req.body, {
    section: { type: 'enum', values: Object.keys(CV_SPECS), required: true },
    visibility: { type: 'enum', values: VISIBILITY },
  });
  const data = validate(req.body.data, CV_SPECS[section]);
  const count = get('SELECT COUNT(*) AS n FROM cv_items WHERE user_id = ?', req.user!.id)!.n;
  if (count >= 300) throw badRequest('Your CV has too many entries');
  const { id } = run('INSERT INTO cv_items (user_id, section, data, visibility, sort) VALUES (?,?,?,?,?)', req.user!.id, section, data, visibility ?? 'public', count);
  reindexUser(req.user!.id);
  res.status(201).json({ id, cv: cvFor(req.user!.id, 'owner') });
});

usersRouter.patch('/me/cv/:id', requirePerm('manage_cv'), (req, res) => {
  const item = get('SELECT * FROM cv_items WHERE id = ? AND user_id = ?', Number(req.params.id), req.user!.id);
  if (!item) throw notFound('CV entry');
  const { visibility } = validate(req.body, { visibility: { type: 'enum', values: VISIBILITY } });
  const data = req.body.data ? validate(req.body.data, CV_SPECS[item.section]) : parseJson(item.data, {});
  run('UPDATE cv_items SET data = ?, visibility = ? WHERE id = ?', data, visibility ?? item.visibility, item.id);
  reindexUser(req.user!.id);
  res.json({ cv: cvFor(req.user!.id, 'owner') });
});

usersRouter.delete('/me/cv/:id', requirePerm('manage_cv'), (req, res) => {
  run('DELETE FROM cv_items WHERE id = ? AND user_id = ?', Number(req.params.id), req.user!.id);
  reindexUser(req.user!.id);
  res.json({ cv: cvFor(req.user!.id, 'owner') });
});

// Bulk card lookup used by the client for mentions etc.
usersRouter.post('/cards', (req, res) => {
  const { ids } = validate(req.body, { ids: { type: 'ints', required: true, max: 100 } });
  const cards = userCards(ids);
  res.json({ users: (ids as number[]).map((i) => cards.get(i)).filter(Boolean) });
});
