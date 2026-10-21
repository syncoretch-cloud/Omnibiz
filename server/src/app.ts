import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { run, tx, MINUTE } from './db/index.ts';
import { config } from './config.ts';
import { HttpError } from './lib/http.ts';
import { loadUser } from './lib/auth.ts';
import { rateLimit } from './lib/ratelimit.ts';
import { MEDIA_DIR } from './lib/storage.ts';
import { INDUSTRIES, PRODUCT_CATEGORIES } from './lib/constants.ts';
import { registerEventHandlers } from './services/events.ts';
import { authRouter, devRouter } from './modules/auth.ts';
import { usersRouter } from './modules/users.ts';
import { filesRouter } from './modules/files.ts';
import { businessesRouter } from './modules/businesses.ts';
import { postsRouter, savesRouter } from './modules/posts.ts';
import { productsRouter } from './modules/products.ts';
import { jobsRouter, recruitmentRouter } from './modules/jobs.ts';
import { announcementsRouter } from './modules/announcements.ts';
import { notificationsRouter } from './modules/notifications.ts';
import { messagesRouter } from './modules/messages.ts';
import { cartRouter, ordersRouter } from './modules/orders.ts';
import { searchRouter } from './modules/search.ts';
import { analyticsRouter } from './modules/analytics.ts';
import { adminRouter, reportsRouter } from './modules/admin.ts';
import { metaRouter } from './modules/meta.ts';
import { reelsRouter } from './modules/reels.ts';
import { storiesRouter } from './modules/stories.ts';

export function ensureCategories() {
  tx(() => {
    INDUSTRIES.forEach(([slug, name], i) => run("INSERT OR IGNORE INTO categories (scope, slug, name, sort) VALUES ('industry', ?, ?, ?)", slug, name, i));
    PRODUCT_CATEGORIES.forEach(([slug, name], i) => run("INSERT OR IGNORE INTO categories (scope, slug, name, sort) VALUES ('product', ?, ?, ?)", slug, name, i));
  });
}

let handlersRegistered = false;

export function createApp() {
  ensureCategories();
  if (!handlersRegistered) {
    registerEventHandlers();
    handlersRegistered = true;
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY ?? 'loopback');

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
    if (config.isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  app.use(express.json({ limit: '1mb' }));

  // CSRF guard: state-changing API calls must carry a custom header (which cross-site forms cannot set)
  // or a bearer token. Combined with SameSite=Lax cookies this blocks cross-site request forgery.
  app.use('/api', (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.headers['x-omnibiz'] === '1' || req.headers.authorization?.startsWith('Bearer ')) return next();
    next(new HttpError(403, 'Missing request header'));
  });

  app.use(loadUser);
  app.use('/api', rateLimit('api', 900, MINUTE));

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  app.use('/api/meta', metaRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/dev', devRouter);
  app.use('/api/users', usersRouter);
  app.use('/api', filesRouter);
  app.use('/api/businesses', businessesRouter);
  app.use('/api/posts', postsRouter);
  app.use('/api/saves', savesRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api/recruitment', recruitmentRouter);
  app.use('/api/announcements', announcementsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/messages', messagesRouter);
  app.use('/api/cart', cartRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/reels', reelsRouter);
  app.use('/api/stories', storiesRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  app.use('/uploads/media', express.static(MEDIA_DIR, { maxAge: '30d', immutable: true, fallthrough: false }));

  // Serve the built web app (single-page app with client-side routing).
  if (fs.existsSync(path.join(config.webDist, 'index.html'))) {
    app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
    app.get('/{*splat}', (_req, res) => {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; img-src 'self' data: blob: https://*.tile.openstreetmap.org; media-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
      );
      res.sendFile(path.join(config.webDist, 'index.html'));
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? `Files must be smaller than ${Math.round(config.maxUploadBytes / 1048576)} MB` : err.message;
      return res.status(400).json({ error: msg });
    }
    const e = err as { type?: string; status?: number; code?: string; message?: string };
    if (e?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    if (e?.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large' });
    if (e?.status === 404) return res.status(404).json({ error: 'Not found' });
    if (e?.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint/.test(e.message ?? '')) return res.status(409).json({ error: 'That already exists' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
  });

  return app;
}
