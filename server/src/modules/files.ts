import fs from 'node:fs';
import { Router } from 'express';
import type { Request } from 'express';
import { all, get, parseJson, run } from '../db/index.ts';
import type { Row } from '../db/index.ts';
import { badRequest, notFound, forbidden, validate } from '../lib/http.ts';
import { requireAuth } from '../lib/auth.ts';
import { rateLimit } from '../lib/ratelimit.ts';
import { docPath, docUpload, mediaUpload, mediaUrl } from '../lib/storage.ts';
import { DOC_KINDS, VISIBILITY } from '../lib/constants.ts';
import { staffCan } from '../lib/permissions.ts';
import { HOUR } from '../db/index.ts';

export const filesRouter = Router();

// ───────────── public media (images / video) ─────────────
filesRouter.post('/media', requireAuth, rateLimit('media', 120, HOUR), mediaUpload.array('files', 10), (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) throw badRequest('No files received');
  res.status(201).json({ files: files.map((f) => ({ url: mediaUrl(f.filename), mime: f.mimetype, size: f.size, name: f.originalname })) });
});

// ───────────── private documents ─────────────
filesRouter.post('/documents', requireAuth, rateLimit('docs', 60, HOUR), docUpload.single('file'), (req, res) => {
  const f = req.file;
  if (!f) throw badRequest('No file received');
  try {
    const d = validate(req.body, {
      kind: { type: 'enum', values: DOC_KINDS, required: true },
      visibility: { type: 'enum', values: VISIBILITY },
      name: { type: 'string', max: 120 },
    });
    const count = get('SELECT COUNT(*) AS n FROM documents WHERE owner_id = ?', req.user!.id)!.n;
    if (count >= 100) throw badRequest('Document limit reached — delete some documents first');
    const { id } = run(
      'INSERT INTO documents (owner_id, kind, name, storage_key, mime, size, visibility) VALUES (?,?,?,?,?,?,?)',
      req.user!.id, d.kind, d.name || f.originalname.slice(0, 120), f.filename, f.mimetype, f.size, d.visibility ?? 'private',
    );
    res.status(201).json({ document: { id, kind: d.kind, name: d.name || f.originalname, mime: f.mimetype, size: f.size, visibility: d.visibility ?? 'private', url: `/api/documents/${id}/file` } });
  } catch (e) {
    fs.rm(f.path, { force: true }, () => {});
    throw e;
  }
});

filesRouter.get('/documents', requireAuth, (req, res) => {
  const docs = all('SELECT id, kind, name, mime, size, visibility, created_at FROM documents WHERE owner_id = ? ORDER BY id DESC', req.user!.id);
  res.json({ documents: docs.map((d) => ({ ...d, url: `/api/documents/${d.id}/file` })) });
});

filesRouter.patch('/documents/:id', requireAuth, (req, res) => {
  const d = validate(req.body, { kind: { type: 'enum', values: DOC_KINDS }, visibility: { type: 'enum', values: VISIBILITY }, name: { type: 'string', max: 120 } }, { partial: true });
  const doc = get('SELECT * FROM documents WHERE id = ? AND owner_id = ?', Number(req.params.id), req.user!.id);
  if (!doc) throw notFound('Document');
  run('UPDATE documents SET kind = ?, visibility = ?, name = ? WHERE id = ?', d.kind ?? doc.kind, d.visibility ?? doc.visibility, d.name ?? doc.name, doc.id);
  res.json({ ok: true });
});

filesRouter.delete('/documents/:id', requireAuth, (req, res) => {
  const doc = get('SELECT * FROM documents WHERE id = ? AND owner_id = ?', Number(req.params.id), req.user!.id);
  if (!doc) throw notFound('Document');
  run('DELETE FROM documents WHERE id = ?', doc.id);
  fs.rm(docPath(doc.storage_key), { force: true }, () => {});
  res.json({ ok: true });
});

function canReadDocument(req: Request, doc: Row): boolean {
  const v = req.user;
  if (doc.visibility === 'public') return true;
  if (!v) return false;
  if (v.id === doc.owner_id) return true;
  if (staffCan(v.role, 'verification') || staffCan(v.role, 'users.view')) return true;
  if (doc.visibility === 'recruiters' && v.account_type === 'company') return true;
  // A company can read any document an applicant attached to one of its vacancies.
  const apps = all(
    'SELECT a.document_ids FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.applicant_id = ? AND j.company_id = ?',
    doc.owner_id, v.id,
  );
  return apps.some((a) => parseJson<number[]>(a.document_ids, []).includes(doc.id));
}

filesRouter.get('/documents/:id/file', (req, res) => {
  const doc = get('SELECT * FROM documents WHERE id = ?', Number(req.params.id));
  if (!doc) throw notFound('Document');
  if (!canReadDocument(req, doc)) throw req.user ? forbidden() : notFound('Document');
  const file = docPath(doc.storage_key);
  if (!fs.existsSync(file)) throw notFound('File');
  res.setHeader('Content-Type', doc.mime);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.name)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(file).pipe(res);
});
