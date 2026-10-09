import { Router } from 'express';
import { all } from '../db/index.ts';
import {
  ACCOUNT_TYPES, ANNOUNCEMENT_KINDS, CURRENCIES, DOC_KINDS, EDUCATION_LEVELS, EMPLOYMENT_TYPES,
  ORDER_STATUSES, PAYMENT_METHODS, PIPELINE, POST_KINDS, REPORT_REASONS,
} from '../lib/constants.ts';
import { KNOWN_CITIES } from '../lib/geo.ts';
import { ACCOUNT_PERMISSIONS } from '../lib/permissions.ts';

export const metaRouter = Router();

/** Reference data the clients need to render forms and filters. Cacheable. */
metaRouter.get('/', (_req, res) => {
  const cats = all('SELECT scope, slug, name FROM categories WHERE active = 1 ORDER BY sort, name');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({
    industries: cats.filter((c) => c.scope === 'industry').map(({ slug, name }) => ({ slug, name })),
    product_categories: cats.filter((c) => c.scope === 'product').map(({ slug, name }) => ({ slug, name })),
    account_types: ACCOUNT_TYPES,
    account_permissions: ACCOUNT_PERMISSIONS,
    employment_types: EMPLOYMENT_TYPES,
    education_levels: EDUCATION_LEVELS,
    document_kinds: DOC_KINDS,
    post_kinds: POST_KINDS,
    announcement_kinds: ANNOUNCEMENT_KINDS,
    pipeline: PIPELINE,
    order_statuses: ORDER_STATUSES,
    payment_methods: PAYMENT_METHODS,
    report_reasons: REPORT_REASONS,
    currencies: CURRENCIES,
    cities: Object.entries(KNOWN_CITIES).map(([name, c]) => ({ name, ...c })),
  });
});
