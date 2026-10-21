import { Router } from 'express';
import type { Request } from 'express';
import { all, get, parseJson, qs, run, tx, sqlTime, DAY } from '../db/index.ts';
import type { Row } from '../db/index.ts';
import { badRequest, conflict, forbidden, intParam, notFound, paging, qNum, qStr, validate } from '../lib/http.ts';
import type { Spec } from '../lib/http.ts';
import { requireAuth, requirePerm } from '../lib/auth.ts';
import { CURRENCIES, EDUCATION_LEVELS, EMPLOYMENT_TYPES, PIPELINE } from '../lib/constants.ts';
import { staffCan } from '../lib/permissions.ts';
import { canonicalCity, cityCoords, distanceKm } from '../lib/geo.ts';
import { emit } from '../lib/queue.ts';
import { userCards } from '../services/users.ts';
import { reindexJob, searchIds, unindex } from '../services/search-index.ts';
import { loadCandidates, matchFor, scoreMatch } from '../services/matching.ts';
import { notify } from '../services/notify.ts';
import { track } from '../services/analytics.ts';
import { recordActivity } from '../services/personalization.ts';
import { cvFor } from './users.ts';
import { createPost } from './posts.ts';

export const jobsRouter = Router();
export const recruitmentRouter = Router();

const REQUIRED_DOC_KINDS = ['cv', 'certificate', 'portfolio', 'cover_letter', 'id', 'academic'] as const;
const today = () => new Date().toISOString().slice(0, 10);

export function hydrateJobs(rows: Row[], viewerId?: number, origin?: { lat: number; lng: number } | null) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id as number);
  const cards = userCards(rows.map((r) => r.company_id));
  const saved = new Set<number>();
  const applied = new Map<number, string>();
  if (viewerId) {
    for (const r of all(`SELECT target_id FROM saves WHERE user_id = ? AND target_type = 'job' AND target_id IN (${qs(ids.length)})`, viewerId, ...ids)) saved.add(r.target_id);
    for (const r of all(`SELECT job_id, stage FROM applications WHERE applicant_id = ? AND job_id IN (${qs(ids.length)})`, viewerId, ...ids)) applied.set(r.job_id, r.stage);
  }
  return rows.map((r) => {
    const loc = r.lat != null ? { lat: r.lat, lng: r.lng } : cityCoords(r.city);
    return {
      id: r.id,
      title: r.title,
      department: r.department,
      industry: r.industry,
      city: r.city,
      location_text: r.location_text,
      location: loc,
      remote: !!r.remote,
      employment_type: r.employment_type,
      description: r.description,
      responsibilities: r.responsibilities,
      skills: parseJson<string[]>(r.skills, []),
      education_req: r.education_req,
      education_field: r.education_field,
      experience_years: r.experience_years,
      salary_min: r.salary_min,
      salary_max: r.salary_max,
      currency: r.currency,
      salary_period: r.salary_period,
      deadline: r.deadline,
      positions: r.positions,
      required_docs: parseJson<string[]>(r.required_docs, []),
      additional: r.additional,
      status: r.status,
      accepting: r.status === 'open' && (!r.deadline || r.deadline >= today()),
      created_at: r.created_at,
      company: cards.get(r.company_id) ?? null,
      saved: saved.has(r.id),
      application_stage: applied.get(r.id) ?? null,
      distance_km: origin && loc ? Math.round(distanceKm(origin, loc) * 10) / 10 : undefined,
    };
  });
}

const JOB_SPEC: Spec = {
  title: { type: 'string', required: true, min: 3, max: 120 },
  department: { type: 'string', max: 80 },
  industry: { type: 'string', max: 50 },
  city: { type: 'string', max: 60 },
  location_text: { type: 'string', max: 150 },
  remote: { type: 'bool' },
  employment_type: { type: 'enum', values: EMPLOYMENT_TYPES, required: true },
  description: { type: 'text', required: true, min: 20, max: 8000 },
  responsibilities: { type: 'text', max: 5000 },
  skills: { type: 'strings', max: 30 },
  education_req: { type: 'enum', values: EDUCATION_LEVELS },
  education_field: { type: 'string', max: 100 },
  experience_years: { type: 'int', min: 0, max: 40 },
  salary_min: { type: 'number', min: 0 },
  salary_max: { type: 'number', min: 0 },
  currency: { type: 'enum', values: CURRENCIES },
  salary_period: { type: 'enum', values: ['hour', 'day', 'month', 'year'] },
  deadline: { type: 'date' },
  positions: { type: 'int', min: 1, max: 10000 },
  required_docs: { type: 'strings', max: 6 },
  additional: { type: 'text', max: 3000 },
  announce: { type: 'bool' },
};

function cleanJob(d: Row, me: Row) {
  if (d.required_docs?.some((k: string) => !(REQUIRED_DOC_KINDS as readonly string[]).includes(k))) throw badRequest('Unknown required document type');
  if (d.salary_min != null && d.salary_max != null && d.salary_max < d.salary_min) throw badRequest('Maximum salary must be at least the minimum');
  if (d.deadline && d.deadline < today()) throw badRequest('Deadline must be in the future');
  if (d.city !== undefined) {
    d.city = canonicalCity(d.city);
    const c = cityCoords(d.city);
    d.lat = c?.lat ?? (d.city === me.city ? me.lat : null);
    d.lng = c?.lng ?? (d.city === me.city ? me.lng : null);
  }
  delete d.announce;
  return d;
}

/** Which of the job's required items an application (or a draft) still lacks, and how many of the attached documents exist. */
function requirementsCheck(j: Row, applicantId: number, cover: string | null | undefined, docIds: number[]) {
  const docs = docIds.length ? all(`SELECT id, kind FROM documents WHERE owner_id = ? AND id IN (${qs(docIds.length)})`, applicantId, ...docIds) : [];
  const kinds = new Set(docs.map((x) => x.kind));
  const hasPortfolio = !!get("SELECT 1 AS x FROM cv_items WHERE user_id = ? AND section = 'portfolio'", applicantId);
  const missing = parseJson<string[]>(j.required_docs, []).filter((k) => {
    if (k === 'cover_letter') return !(cover && cover.length >= 50) && !kinds.has('cover_letter');
    if (k === 'portfolio') return !kinds.has('portfolio') && !hasPortfolio;
    return !kinds.has(k);
  });
  return { found: docs.length, missing };
}

function shapeDraft(d: Row, j: Row) {
  const docIds = parseJson<number[]>(d.document_ids, []);
  return {
    id: d.id, job_id: d.job_id, cover_letter: d.cover_letter, answers: parseJson<Row>(d.answers, {}), document_ids: docIds, step: d.step,
    created_at: d.created_at, updated_at: d.updated_at, missing: requirementsCheck(j, d.applicant_id, d.cover_letter, docIds).missing,
  };
}

function loadJob(req: Request) {
  const j = get('SELECT * FROM jobs WHERE id = ?', intParam(req));
  if (!j) throw notFound('Job');
  const owner = req.user?.id === j.company_id || (req.user && staffCan(req.user.role, 'content'));
  if (['flagged', 'removed'].includes(j.status) && !owner) throw notFound('Job');
  return j;
}

// ───────────── discovery ─────────────
jobsRouter.get('/', (req, res) => {
  const { limit, offset } = paging(req, 20);
  const where = ["j.status = 'open'", '(j.deadline IS NULL OR j.deadline >= ?)'];
  const params: unknown[] = [today()];
  let rank: Map<number, number> | null = null;
  const q = qStr(req, 'q');
  if (q) {
    const ids = searchIds(['job'], q, 500).map((r) => r.ref_id);
    if (!ids.length) return res.json({ items: [], total: 0 });
    rank = new Map(ids.map((id, i) => [id, i]));
    where.push(`j.id IN (${ids.join(',')})`);
    recordActivity(req.user?.id, 'search', { term: q });
  }
  const company = Number(req.query.company);
  if (company) { where.push('j.company_id = ?'); params.push(company); }
  const industry = qStr(req, 'industry');
  if (industry) { where.push('j.industry = ?'); params.push(industry); }
  const city = qStr(req, 'city');
  if (city) { where.push('(j.city = ? COLLATE NOCASE OR j.remote = 1)'); params.push(city); }
  const type = qStr(req, 'employment_type');
  if (type) { where.push('j.employment_type = ?'); params.push(type); }
  if (req.query.remote === '1') where.push('j.remote = 1');
  const minSalary = qNum(req, 'min_salary');
  if (minSalary != null) { where.push('COALESCE(j.salary_max, j.salary_min) >= ?'); params.push(minSalary); }
  const posted = qNum(req, 'posted_within');
  if (posted) { where.push('j.created_at > ?'); params.push(sqlTime(-posted * DAY)); }
  const skill = qStr(req, 'skill');
  if (skill) { where.push('EXISTS (SELECT 1 FROM json_each(j.skills) s WHERE lower(s.value) = lower(?))'); params.push(skill); }
  if (company && req.user?.id === company) where[0] = "j.status IN ('open','closed')";

  const sort = qStr(req, 'sort') ?? 'newest';
  const order = sort === 'salary' ? 'COALESCE(j.salary_max, j.salary_min, 0) DESC' : sort === 'deadline' ? 'j.deadline IS NULL, j.deadline ASC' : 'j.created_at DESC';
  const rows = all(`SELECT j.* FROM jobs j JOIN users u ON u.id = j.company_id WHERE u.status = 'active' AND ${where.join(' AND ')} ORDER BY ${order} LIMIT 2000`, ...params);
  if (rank && sort === 'relevance') rows.sort((a, b) => rank!.get(a.id)! - rank!.get(b.id)!);
  res.json({ items: hydrateJobs(rows.slice(offset, offset + limit), req.user?.id), total: rows.length });
});

jobsRouter.get('/recommended', requireAuth, (req, res) => {
  const { limit, offset } = paging(req, 20);
  const [cand] = loadCandidates([req.user!.id]);
  const rows = all("SELECT * FROM jobs WHERE status = 'open' AND (deadline IS NULL OR deadline >= ?) ORDER BY id DESC LIMIT 1500", today());
  if (!cand) {
    // Non-personal accounts get the newest jobs in their interests instead.
    return res.json({ items: hydrateJobs(rows.slice(offset, offset + limit), req.user!.id), total: rows.length });
  }
  const scored = rows
    .map((j) => ({ j, m: scoreMatch(j, cand) }))
    .filter((x) => x.m.score >= 30)
    .sort((a, b) => b.m.score - a.m.score || b.j.id - a.j.id);
  const page = scored.slice(offset, offset + limit);
  const items = hydrateJobs(page.map((x) => x.j), req.user!.id);
  res.json({
    items: items.map((it, i) => ({ ...it, match: { score: page[i].m.score, strengths: page[i].m.strengths.slice(0, 2), missing: page[i].m.missingSkills } })),
    total: scored.length,
  });
});

jobsRouter.get('/nearby', (req, res) => {
  const { limit, offset } = paging(req, 20);
  const lat = qNum(req, 'lat') ?? req.user?.lat ?? cityCoords(req.user?.city)?.lat;
  const lng = qNum(req, 'lng') ?? req.user?.lng ?? cityCoords(req.user?.city)?.lng;
  if (lat == null || lng == null) return res.json({ items: [], total: 0, needs_location: true });
  const origin = { lat, lng };
  const radius = Math.min(500, qNum(req, 'radius') ?? 100);
  const rows = all("SELECT * FROM jobs WHERE status = 'open' AND remote = 0 AND (deadline IS NULL OR deadline >= ?) LIMIT 3000", today())
    .map((j) => {
      const c = j.lat != null ? { lat: j.lat, lng: j.lng } : cityCoords(j.city);
      return { j, d: c ? distanceKm(origin, c) : Infinity };
    })
    .filter((x) => x.d <= radius)
    .sort((a, b) => a.d - b.d);
  res.json({ items: hydrateJobs(rows.slice(offset, offset + limit).map((x) => x.j), req.user?.id, origin), total: rows.length });
});

jobsRouter.get('/saved', requireAuth, (req, res) => {
  const rows = all("SELECT j.* FROM saves s JOIN jobs j ON j.id = s.target_id WHERE s.user_id = ? AND s.target_type = 'job' ORDER BY s.created_at DESC", req.user!.id);
  res.json({ items: hydrateJobs(rows, req.user!.id) });
});

jobsRouter.get('/applied', requireAuth, (req, res) => {
  const apps = all('SELECT * FROM applications WHERE applicant_id = ? ORDER BY updated_at DESC', req.user!.id);
  const jobs = apps.length ? all(`SELECT * FROM jobs WHERE id IN (${qs(apps.length)})`, ...apps.map((a) => a.job_id)) : [];
  const byId = new Map(hydrateJobs(jobs, req.user!.id).map((j) => [j.id, j]));
  res.json({
    items: apps.map((a) => ({
      application: { id: a.id, stage: a.stage, match_score: a.match_score, created_at: a.created_at, updated_at: a.updated_at },
      job: byId.get(a.job_id),
    })),
  });
});

/** The applicant's unfinished applications, each with what is still missing. */
jobsRouter.get('/drafts', requirePerm('apply_jobs'), (req, res) => {
  const drafts = all('SELECT * FROM application_drafts WHERE applicant_id = ? ORDER BY updated_at DESC', req.user!.id);
  const jobs = drafts.length ? all(`SELECT * FROM jobs WHERE id IN (${qs(drafts.length)})`, ...drafts.map((d) => d.job_id)) : [];
  const raw = new Map(jobs.map((j) => [j.id, j]));
  const shaped = new Map(hydrateJobs(jobs, req.user!.id).map((j) => [j.id, j]));
  res.json({ items: drafts.filter((d) => raw.has(d.job_id)).map((d) => ({ draft: shapeDraft(d, raw.get(d.job_id)!), job: shaped.get(d.job_id) })) });
});

jobsRouter.get('/:id', (req, res) => {
  const j = loadJob(req);
  const [job] = hydrateJobs([j], req.user?.id);
  let match = null;
  let application = null;
  let draft = null;
  if (req.user) {
    if (req.user.account_type === 'personal') match = matchFor(j, req.user.id);
    application = get('SELECT id, stage, created_at, updated_at, match_score FROM applications WHERE job_id = ? AND applicant_id = ?', j.id, req.user.id) ?? null;
    const d = application ? null : get('SELECT * FROM application_drafts WHERE job_id = ? AND applicant_id = ?', j.id, req.user.id);
    if (d) draft = shapeDraft(d, j);
  }
  if (req.user?.id !== j.company_id) {
    run('UPDATE jobs SET view_count = view_count + 1 WHERE id = ?', j.id);
    track({ ownerId: j.company_id, actorId: req.user?.id, type: 'job_view', targetType: 'job', targetId: j.id, source: String(req.query.src ?? 'direct') });
    recordActivity(req.user?.id, 'view_job', { category: j.industry, targetType: 'job', targetId: j.id });
  }
  const similar = all("SELECT * FROM jobs WHERE status = 'open' AND id != ? AND (industry = ? OR company_id = ?) ORDER BY id DESC LIMIT 5", j.id, j.industry, j.company_id);
  res.json({ job, match, application, draft, similar: hydrateJobs(similar, req.user?.id) });
});

// ───────────── company: create & manage vacancies ─────────────
jobsRouter.post('/', requirePerm('create_jobs'), (req, res) => {
  const me = req.user!;
  const d = validate(req.body, JOB_SPEC);
  const announce = d.announce;
  cleanJob(d, me);
  d.industry ??= get('SELECT category FROM businesses WHERE user_id = ?', me.id)?.category ?? null;
  d.required_docs ??= ['cv'];
  if (d.city === undefined && !d.remote) Object.assign(d, { city: me.city, lat: me.lat, lng: me.lng });
  const keys = Object.keys(d);
  const { id } = run(`INSERT INTO jobs (company_id, ${keys.join(', ')}) VALUES (?, ${qs(keys.length)})`, me.id, ...keys.map((k) => d[k]));
  reindexJob(id);
  emit('job.published', { jobId: id });
  if (announce !== false) {
    createPost(me, {
      kind: 'hiring',
      body: `We're hiring: ${d.title}${d.city ? ` in ${d.city}` : d.remote ? ' (remote)' : ''}.\n\n${String(d.description).slice(0, 280)}${(d.skills ?? []).length ? `\n\nSkills: ${(d.skills as string[]).join(', ')}` : ''}\n\n#hiring #jobs`,
      category: d.industry,
      data: { job_id: id },
    });
  }
  const [job] = hydrateJobs([get('SELECT * FROM jobs WHERE id = ?', id)!], me.id);
  res.status(201).json({ job });
});

jobsRouter.patch('/:id', requirePerm('create_jobs'), (req, res) => {
  const j = loadJob(req);
  if (j.company_id !== req.user!.id) throw forbidden();
  const d = cleanJob(validate(req.body, { ...JOB_SPEC, status: { type: 'enum', values: ['open', 'closed'] } }, { partial: true }), req.user!);
  if (j.status === 'flagged' || j.status === 'removed') delete d.status;
  const keys = Object.keys(d);
  if (keys.length) run(`UPDATE jobs SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => d[k]), j.id);
  reindexJob(j.id);
  const [job] = hydrateJobs([get('SELECT * FROM jobs WHERE id = ?', j.id)!], req.user!.id);
  res.json({ job });
});

jobsRouter.delete('/:id', requirePerm('create_jobs'), (req, res) => {
  const j = loadJob(req);
  if (j.company_id !== req.user!.id) throw forbidden();
  run("UPDATE jobs SET status = 'closed' WHERE id = ?", j.id);
  unindex('job', j.id);
  res.json({ ok: true });
});

// ───────────── application flow (spec §14) ─────────────
jobsRouter.post('/:id/apply', requirePerm('apply_jobs'), (req, res) => {
  const j = loadJob(req);
  const me = req.user!;
  if (j.status !== 'open' || (j.deadline && j.deadline < today())) throw badRequest('This vacancy is no longer accepting applications');
  if (get('SELECT 1 AS x FROM applications WHERE job_id = ? AND applicant_id = ?', j.id, me.id)) throw conflict('You have already applied for this job');
  const d = validate(req.body, {
    cover_letter: { type: 'text', max: 6000 },
    answers: { type: 'json' },
    document_ids: { type: 'ints', max: 10 },
    source: { type: 'string', max: 40 },
  });
  const docIds = (d.document_ids ?? []) as number[];
  const { found, missing } = requirementsCheck(j, me.id, d.cover_letter, docIds);
  if (found !== docIds.length) throw badRequest('One of the attached documents was not found');
  if (missing.length) throw badRequest(`Missing required: ${missing.map((m) => m.replace('_', ' ')).join(', ')}`, { missing });

  const match = matchFor(j, me.id);
  const source = d.source ?? 'direct';
  const id = tx(() => {
    const { id } = run(
      'INSERT INTO applications (job_id, applicant_id, cover_letter, answers, document_ids, match_score, source) VALUES (?,?,?,?,?,?,?)',
      j.id, me.id, d.cover_letter ?? null, d.answers ?? {}, docIds, match?.score ?? null, source,
    );
    run("INSERT INTO application_events (application_id, stage, actor_id, note) VALUES (?, 'applied', ?, NULL)", id, me.id);
    run('DELETE FROM application_drafts WHERE job_id = ? AND applicant_id = ?', j.id, me.id);
    return id;
  });
  track({ ownerId: j.company_id, actorId: me.id, type: 'application', targetType: 'job', targetId: j.id, source });
  recordActivity(me.id, 'apply', { category: j.industry, targetType: 'job', targetId: j.id });
  emit('application.submitted', { applicationId: id });
  res.status(201).json({ application: { id, stage: 'applied', match_score: match?.score ?? null } });
});

/** Save an unfinished application: anything can be skipped now and completed later. */
jobsRouter.put('/:id/draft', requirePerm('apply_jobs'), (req, res) => {
  const j = loadJob(req);
  const me = req.user!;
  if (get('SELECT 1 AS x FROM applications WHERE job_id = ? AND applicant_id = ?', j.id, me.id)) throw conflict('You have already applied for this job');
  const d = validate(req.body, {
    cover_letter: { type: 'text', max: 6000 },
    answers: { type: 'json' },
    document_ids: { type: 'ints', max: 10 },
    step: { type: 'int', min: 1, max: 4 },
  });
  const docIds = (d.document_ids ?? []) as number[];
  if (requirementsCheck(j, me.id, null, docIds).found !== docIds.length) throw badRequest('One of the attached documents was not found');
  run(
    `INSERT INTO application_drafts (job_id, applicant_id, cover_letter, answers, document_ids, step) VALUES (?,?,?,?,?,?)
     ON CONFLICT(job_id, applicant_id) DO UPDATE SET cover_letter = excluded.cover_letter, answers = excluded.answers,
       document_ids = excluded.document_ids, step = excluded.step, updated_at = datetime('now')`,
    j.id, me.id, d.cover_letter ?? null, d.answers ?? {}, docIds, d.step ?? 1,
  );
  res.json({ draft: shapeDraft(get('SELECT * FROM application_drafts WHERE job_id = ? AND applicant_id = ?', j.id, me.id)!, j) });
});

jobsRouter.delete('/:id/draft', requireAuth, (req, res) => {
  run('DELETE FROM application_drafts WHERE job_id = ? AND applicant_id = ?', intParam(req), req.user!.id);
  res.json({ ok: true });
});

jobsRouter.post('/applications/:id/withdraw', requireAuth, (req, res) => {
  const a = get('SELECT * FROM applications WHERE id = ? AND applicant_id = ?', intParam(req), req.user!.id);
  if (!a) throw notFound('Application');
  if (['accepted', 'rejected', 'withdrawn'].includes(a.stage)) throw badRequest('This application can no longer be withdrawn');
  run("UPDATE applications SET stage = 'withdrawn', updated_at = datetime('now') WHERE id = ?", a.id);
  run("INSERT INTO application_events (application_id, stage, actor_id) VALUES (?, 'withdrawn', ?)", a.id, req.user!.id);
  res.json({ ok: true });
});

// ───────────── recruitment dashboard (spec §15) ─────────────
const STAGE_MESSAGES: Record<string, string> = {
  reviewing: 'Your application is being reviewed',
  shortlisted: 'Good news — you have been shortlisted',
  interview: 'You have been invited to the interview stage',
  final_review: 'Your application is in final review',
  accepted: 'Congratulations — your application was accepted',
  rejected: 'Update on your application',
};

recruitmentRouter.use(requirePerm('manage_applications'));

recruitmentRouter.get('/overview', (req, res) => {
  const me = req.user!.id;
  const jobs = all(
    `SELECT j.id, j.title, j.status, j.deadline, j.created_at, j.view_count, j.positions,
       (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id AND a.stage != 'withdrawn') AS applications,
       (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id AND a.stage = 'applied') AS new_applications
     FROM jobs j WHERE j.company_id = ? AND j.status != 'removed' ORDER BY j.created_at DESC`,
    me,
  );
  const stages = all(
    `SELECT a.stage, COUNT(*) AS n FROM applications a JOIN jobs j ON j.id = a.job_id WHERE j.company_id = ? GROUP BY a.stage`,
    me,
  );
  const sources = all(
    `SELECT COALESCE(a.source, 'direct') AS source, COUNT(*) AS n FROM applications a JOIN jobs j ON j.id = a.job_id WHERE j.company_id = ? GROUP BY 1 ORDER BY n DESC`,
    me,
  );
  const daily = all(
    `SELECT date(a.created_at) AS day, COUNT(*) AS n FROM applications a JOIN jobs j ON j.id = a.job_id
     WHERE j.company_id = ? AND a.created_at > ? GROUP BY day ORDER BY day`,
    me, sqlTime(-30 * DAY),
  );
  res.json({ jobs, stages: Object.fromEntries(stages.map((s) => [s.stage, s.n])), sources, daily });
});

recruitmentRouter.get('/jobs/:id/applications', (req, res) => {
  const j = get('SELECT * FROM jobs WHERE id = ? AND company_id = ?', intParam(req), req.user!.id);
  if (!j) throw notFound('Job');
  const stage = qStr(req, 'stage');
  const sort = qStr(req, 'sort') === 'newest' ? 'a.created_at DESC' : 'a.match_score DESC, a.created_at DESC';
  const rows = all(
    `SELECT a.id, a.applicant_id, a.stage, a.match_score, a.source, a.created_at, a.updated_at FROM applications a
     WHERE a.job_id = ? ${stage ? 'AND a.stage = ?' : "AND a.stage != 'withdrawn'"} ORDER BY ${sort}`,
    j.id, ...(stage ? [stage] : []),
  );
  const cards = userCards(rows.map((r) => r.applicant_id));
  const [job] = hydrateJobs([j], req.user!.id);
  res.json({ job, applications: rows.map((r) => ({ ...r, applicant: cards.get(r.applicant_id) })) });
});

recruitmentRouter.get('/applications/:id', (req, res) => {
  const a = get('SELECT a.* FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.id = ? AND j.company_id = ?', intParam(req), req.user!.id);
  if (!a) throw notFound('Application');
  const j = get('SELECT * FROM jobs WHERE id = ?', a.job_id)!;
  const u = get('SELECT id, username, display_name, email, phone, avatar_url, city, country, bio FROM users WHERE id = ?', a.applicant_id)!;
  const p = get('SELECT full_name, headline, summary FROM profiles WHERE user_id = ?', a.applicant_id);
  const docIds = parseJson<number[]>(a.document_ids, []);
  const documents = docIds.length
    ? all(`SELECT id, kind, name, mime, size FROM documents WHERE id IN (${qs(docIds.length)})`, ...docIds).map((d) => ({ ...d, url: `/api/documents/${d.id}/file` }))
    : [];
  if (a.stage === 'applied') {
    run("UPDATE applications SET stage = 'reviewing', updated_at = datetime('now') WHERE id = ?", a.id);
    run("INSERT INTO application_events (application_id, stage, actor_id, note) VALUES (?, 'reviewing', ?, 'Opened by recruiter')", a.id, req.user!.id);
    a.stage = 'reviewing';
  }
  const events = all('SELECT stage, note, created_at FROM application_events WHERE application_id = ? ORDER BY id', a.id);
  const [job] = hydrateJobs([j], req.user!.id);
  res.json({
    application: { ...a, answers: parseJson(a.answers, {}), document_ids: docIds },
    job,
    applicant: { ...u, ...p },
    cv: cvFor(a.applicant_id, 'recruiter'),
    documents,
    match: matchFor(j, a.applicant_id),
    events,
  });
});

recruitmentRouter.patch('/applications/:id', (req, res) => {
  const a = get('SELECT a.*, j.title, j.company_id FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.id = ? AND j.company_id = ?', intParam(req), req.user!.id);
  if (!a) throw notFound('Application');
  if (a.stage === 'withdrawn') throw badRequest('The candidate withdrew this application');
  const d = validate(req.body, { stage: { type: 'enum', values: PIPELINE }, note: { type: 'text', max: 2000 }, recruiter_notes: { type: 'text', max: 5000 }, message: { type: 'text', max: 2000 } });
  tx(() => {
    if (d.recruiter_notes !== undefined) run('UPDATE applications SET recruiter_notes = ? WHERE id = ?', d.recruiter_notes, a.id);
    if (d.stage && d.stage !== a.stage) {
      run("UPDATE applications SET stage = ?, updated_at = datetime('now') WHERE id = ?", d.stage, a.id);
      run('INSERT INTO application_events (application_id, stage, actor_id, note) VALUES (?,?,?,?)', a.id, d.stage, req.user!.id, d.note ?? null);
    }
  });
  if (d.stage && d.stage !== a.stage && STAGE_MESSAGES[d.stage]) {
    notify([a.applicant_id], {
      type: 'application_update',
      title: `${STAGE_MESSAGES[d.stage]}: ${a.title}`,
      body: d.message ?? `${req.user!.display_name} updated your application.`,
      link: '/jobs?tab=applied',
      actorId: req.user!.id,
    });
  }
  res.json({ ok: true, stage: d.stage ?? a.stage });
});
