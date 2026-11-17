import { Router } from 'express';
import { all } from '../db/index.ts';
import { requirePerm } from '../lib/auth.ts';
import { validate } from '../lib/http.ts';
import { staffCan } from '../lib/permissions.ts';
import { notify } from '../services/notify.ts';
import type { VerifyPeriod } from '../services/verification.ts';
import { VERIFICATION_CURRENCY, VERIFICATION_PERIODS, expireVerifications, renewVerification, requestVerification, verificationOptions, verificationStatus } from '../services/verification.ts';

export const verificationRouter = Router();

/** Everyone who can post (people and businesses, not plain customers) can buy verification. */
verificationRouter.get('/', requirePerm('create_posts'), (req, res) => {
  expireVerifications();
  res.json({ ...verificationOptions(req.user!), currency: VERIFICATION_CURRENCY, billing: 'test', ...verificationStatus(req.user!.id) });
});

const PERIOD = { type: 'enum', values: Object.keys(VERIFICATION_PERIODS) } as const;

verificationRouter.post('/', requirePerm('create_posts'), (req, res) => {
  const d = validate(req.body, { document_ids: { type: 'ints', required: true, max: 10 }, notes: { type: 'text', max: 1000 }, period: PERIOD });
  const id = requestVerification(req.user!, d.document_ids, d.notes, (d.period ?? 'monthly') as VerifyPeriod);
  const team = all("SELECT id, role FROM users WHERE role != 'user' AND status = 'active'").filter((u) => staffCan(u.role, 'verification')).map((u) => u.id);
  notify(team, { type: 'verification', title: 'New verification request (paid)', body: req.user!.display_name });
  res.status(201).json({ id });
});

verificationRouter.post('/renew', requirePerm('create_posts'), (req, res) => {
  const { period } = validate(req.body, { period: { ...PERIOD, required: true } });
  const until = renewVerification(req.user!, period as VerifyPeriod);
  notify([req.user!.id], { type: 'verification', title: 'Verification renewed', body: until ? `Your verified badge now runs until ${until.slice(0, 10)}.` : 'Your verified badge is active.' });
  res.json({ ok: true, verified_until: until });
});
