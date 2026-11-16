import { Router } from 'express';
import { all } from '../db/index.ts';
import { requirePerm } from '../lib/auth.ts';
import { validate } from '../lib/http.ts';
import { staffCan } from '../lib/permissions.ts';
import { notify } from '../services/notify.ts';
import { VERIFICATION_CURRENCY, requestVerification, verificationFee, verificationStatus } from '../services/verification.ts';

export const verificationRouter = Router();

/** Everyone who can post (people and businesses, not plain customers) can buy verification. */
verificationRouter.get('/', requirePerm('create_posts'), (req, res) => {
  res.json({ fee: verificationFee(), currency: VERIFICATION_CURRENCY, billing: 'test', ...verificationStatus(req.user!.id) });
});

verificationRouter.post('/', requirePerm('create_posts'), (req, res) => {
  const d = validate(req.body, { document_ids: { type: 'ints', required: true, max: 10 }, notes: { type: 'text', max: 1000 } });
  const id = requestVerification(req.user!.id, d.document_ids, d.notes);
  const team = all("SELECT id, role FROM users WHERE role != 'user' AND status = 'active'").filter((u) => staffCan(u.role, 'verification')).map((u) => u.id);
  notify(team, { type: 'verification', title: 'New verification request (paid)', body: req.user!.display_name });
  res.status(201).json({ id });
});
