// Paid verification: the account pays a fee, then staff check the documents. Approval puts the verified badge on the
// account and gives its posts a ranking boost. Billing is in test mode until a payment provider is connected.
import { all, get, run } from '../db/index.ts';
import { badRequest, conflict } from '../lib/http.ts';
import { getSetting } from './settings.ts';

export const VERIFICATION_CURRENCY = 'TZS';

export const verificationFee = () => Number(getSetting('verification_fee', '25000')) || 0;

export function verificationStatus(userId: number) {
  const u = get('SELECT verified FROM users WHERE id = ?', userId);
  const last = get('SELECT status FROM verification_requests WHERE user_id = ? ORDER BY id DESC LIMIT 1', userId);
  const status = u?.verified ? 'verified' : last?.status === 'pending' ? 'pending' : last?.status === 'rejected' ? 'rejected' : 'none';
  return { verified: !!u?.verified, status, requests: all('SELECT id, status, paid_amount, review_notes, created_at, reviewed_at FROM verification_requests WHERE user_id = ? ORDER BY id DESC', userId) };
}

export function requestVerification(userId: number, documentIds: number[], notes?: string | null) {
  if (verificationStatus(userId).verified) throw conflict('Your account is already verified');
  if (get("SELECT 1 AS x FROM verification_requests WHERE user_id = ? AND status = 'pending'", userId)) throw conflict('You already have a verification request under review');
  const owned = all(`SELECT id FROM documents WHERE owner_id = ? AND id IN (${documentIds.join(',')})`, userId);
  if (owned.length !== documentIds.length || !owned.length) throw badRequest('Attach at least one of your uploaded documents');
  const fee = verificationFee();
  const ref = fee > 0 ? `test-${Date.now().toString(36)}` : null;
  const { id } = run('INSERT INTO verification_requests (user_id, document_ids, notes, paid_amount, payment_ref) VALUES (?,?,?,?,?)', userId, documentIds, notes ?? null, fee, ref);
  run("UPDATE businesses SET verification_status = 'pending' WHERE user_id = ?", userId);
  return id;
}
