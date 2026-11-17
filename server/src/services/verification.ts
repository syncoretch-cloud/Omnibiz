// Paid verification: the account pays for a term (1, 6 or 12 months), then staff check the documents. Approval puts the
// verified badge on the account and ranks it ahead of unverified ones until the term ends; renewing extends it without
// new documents. Billing is in test mode until a payment provider is connected.
import { all, get, run, sqlTime, tx, DAY } from '../db/index.ts';
import { badRequest, conflict } from '../lib/http.ts';
import { getSetting } from './settings.ts';
import { currentPlan } from './subscriptions.ts';
import { notify } from './notify.ts';

export const VERIFICATION_CURRENCY = 'TZS';

/** The price of one month of verification; longer terms are cheaper per month. */
export const verificationFee = () => Number(getSetting('verification_fee', '25000')) || 0;

export const VERIFICATION_PERIODS = {
  monthly: { label: 'Monthly', months: 1, discount: 0 },
  semiannual: { label: '6 months', months: 6, discount: 10 },
  yearly: { label: 'Yearly', months: 12, discount: 20 },
} as const;
export type VerifyPeriod = keyof typeof VERIFICATION_PERIODS;

/** What one account pays for each term: the monthly price, less the term discount, less whatever its plan takes off. */
export function verificationOptions(user: { id: number; account_type: string }) {
  const base = verificationFee();
  const plan = Math.min(100, Math.max(0, currentPlan(user).plan.perks.verification_discount));
  const options = (Object.entries(VERIFICATION_PERIODS) as [VerifyPeriod, (typeof VERIFICATION_PERIODS)[VerifyPeriod]][]).map(([period, p]) => {
    const total = Math.round((base * p.months * (1 - p.discount / 100) * (1 - plan / 100)) / 100) * 100;
    return { period, label: p.label, months: p.months, term_discount: p.discount, total, per_month: Math.round(total / p.months), saving: base * p.months - total };
  });
  return { base, discount: plan, options };
}

function priceFor(user: { id: number; account_type: string }, period: VerifyPeriod) {
  return verificationOptions(user).options.find((o) => o.period === period)!;
}

export function verificationStatus(userId: number) {
  const u = get('SELECT verified, verified_until FROM users WHERE id = ?', userId);
  const last = get('SELECT status FROM verification_requests WHERE user_id = ? ORDER BY id DESC LIMIT 1', userId);
  const everApproved = !!get("SELECT 1 AS x FROM verification_requests WHERE user_id = ? AND status = 'approved'", userId);
  const verified = !!u?.verified && (!u.verified_until || u.verified_until > sqlTime());
  const status = verified ? 'verified' : last?.status === 'pending' ? 'pending' : last?.status === 'rejected' ? 'rejected' : 'none';
  return {
    verified,
    status,
    verified_until: verified ? u?.verified_until ?? null : null,
    // A timed badge can be renewed any time, and a lapsed one can come back without sending documents again.
    can_renew: everApproved && status !== 'pending' && (!verified || !!u?.verified_until),
    lapsed: everApproved && !verified && status !== 'pending',
    requests: all('SELECT id, status, paid_amount, period, months, review_notes, created_at, reviewed_at FROM verification_requests WHERE user_id = ? ORDER BY id DESC', userId),
  };
}

export function requestVerification(user: { id: number; account_type: string }, documentIds: number[], notes: string | null | undefined, period: VerifyPeriod = 'monthly') {
  const userId = user.id;
  if (verificationStatus(userId).verified) throw conflict('Your account is already verified');
  if (get("SELECT 1 AS x FROM verification_requests WHERE user_id = ? AND status = 'pending'", userId)) throw conflict('You already have a verification request under review');
  const owned = all(`SELECT id FROM documents WHERE owner_id = ? AND id IN (${documentIds.join(',')})`, userId);
  if (owned.length !== documentIds.length || !owned.length) throw badRequest('Attach at least one of your uploaded documents');
  const price = priceFor(user, period);
  const ref = price.total > 0 ? `test-${Date.now().toString(36)}` : null;
  const { id } = run('INSERT INTO verification_requests (user_id, document_ids, notes, paid_amount, payment_ref, period, months) VALUES (?,?,?,?,?,?,?)', userId, documentIds, notes ?? null, price.total, ref, period, price.months);
  run("UPDATE businesses SET verification_status = 'pending' WHERE user_id = ?", userId);
  return id;
}

/** Puts the badge on an account for `months` (null = for good), counted from the end of any term still running. */
export function grantVerification(userId: number, months: number | null) {
  const u = get('SELECT verified_until FROM users WHERE id = ?', userId);
  const from = u?.verified_until && u.verified_until > sqlTime() ? Date.parse(u.verified_until.replace(' ', 'T') + 'Z') : Date.now();
  const until = months ? sqlTime(from - Date.now() + months * 30 * DAY) : null;
  tx(() => {
    run('UPDATE users SET verified = 1, verified_until = ? WHERE id = ?', until, userId);
    run("UPDATE businesses SET verified = 1, verification_status = 'verified' WHERE user_id = ?", userId);
  });
  return until;
}

/** Renewal: pay for another term and keep (or get back) the badge. No documents needed, since staff approved them before. */
export function renewVerification(user: { id: number; account_type: string }, period: VerifyPeriod) {
  const st = verificationStatus(user.id);
  if (!st.can_renew) throw badRequest(st.status === 'pending' ? 'Your verification request is still being reviewed' : st.verified ? 'Your verification does not expire' : 'Request verification first');
  const price = priceFor(user, period);
  const ref = price.total > 0 ? `test-${Date.now().toString(36)}` : null;
  const until = grantVerification(user.id, price.months);
  run("INSERT INTO verification_requests (user_id, status, review_notes, reviewed_at, paid_amount, payment_ref, period, months) VALUES (?, 'approved', 'Renewal', datetime('now'), ?, ?, ?, ?)", user.id, price.total, ref, period, price.months);
  return until;
}

/** Takes the badge off accounts whose term has ended, and reminds those whose term ends within a week. */
export function expireVerifications() {
  const now = sqlTime();
  const ended = all('SELECT id FROM users WHERE verified = 1 AND verified_until IS NOT NULL AND verified_until <= ?', now);
  for (const { id } of ended) {
    tx(() => {
      run('UPDATE users SET verified = 0 WHERE id = ?', id);
      run("UPDATE businesses SET verified = 0, verification_status = 'none' WHERE user_id = ?", id);
    });
    notify([id], { type: 'verification', title: 'Your verified badge has expired', body: 'Renew it in Settings to be shown first again.', link: '/settings/verification' });
  }
  const soon = all('SELECT id, verified_until FROM users WHERE verified = 1 AND verified_until > ? AND verified_until <= ?', now, sqlTime(7 * DAY));
  for (const u of soon) {
    if (get("SELECT 1 AS x FROM notifications WHERE user_id = ? AND title = 'Your verified badge expires soon' AND created_at > ?", u.id, sqlTime(-7 * DAY))) continue;
    notify([u.id], { type: 'verification', title: 'Your verified badge expires soon', body: `It ends on ${u.verified_until.slice(0, 10)}. Renew to keep your priority placement.`, link: '/settings/verification' });
  }
  return ended.length;
}
