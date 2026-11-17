// Marketplace trust: order disputes and refunds, seller reviews, and the public seller storefront.
import { Router } from 'express';
import { all, get, run, tx } from '../db/index.ts';
import { badRequest, forbidden, intParam, notFound, paging, qStr, validate } from '../lib/http.ts';
import { audit, requireAuth, requireStaff } from '../lib/auth.ts';
import { sendEmail } from '../lib/outbox.ts';
import { userCard, userCards } from '../services/users.ts';
import { notify } from '../services/notify.ts';
import { DISPUTE_WINDOW_DAYS, openDispute, releaseDuePayouts, sellerPayoutSummary, sellerRatingMap } from '../services/payouts.ts';
import { hydrateProducts } from './products.ts';

/** Mounted on /api/orders next to the main orders router. */
export const orderTrustRouter = Router();
export const disputesAdminRouter = Router();
export const shopsRouter = Router();

function myOrder(id: number, userId: number) {
  const o = get('SELECT * FROM orders WHERE id = ?', id);
  if (!o || (o.buyer_id !== userId && o.seller_id !== userId)) throw notFound('Order');
  return o;
}

// ───────────── disputes and refunds ─────────────
orderTrustRouter.post('/:id/dispute', requireAuth, (req, res) => {
  const o = myOrder(intParam(req), req.user!.id);
  if (o.buyer_id !== req.user!.id) throw forbidden('Only the buyer can open a dispute');
  if (!['confirmed', 'shipped', 'delivered'].includes(o.status)) throw badRequest('You can open a dispute once the seller has confirmed the order');
  if (o.payout_status === 'refunded' || o.payment_status === 'refunded') throw badRequest('This order has already been refunded');
  if (Date.parse(o.updated_at + 'Z') < Date.now() - DISPUTE_WINDOW_DAYS * 86_400_000) throw badRequest(`Disputes must be opened within ${DISPUTE_WINDOW_DAYS} days`);
  if (openDispute(o.id)) throw badRequest('There is already an open dispute on this order');
  if (get('SELECT 1 AS x FROM disputes WHERE order_id = ?', o.id)) throw badRequest('This order already had a dispute');
  const d = validate(req.body, {
    reason: { type: 'enum', values: ['not_received', 'not_as_described', 'damaged', 'wrong_item', 'other'], required: true },
    details: { type: 'text', required: true, min: 10, max: 2000 },
  });
  const { id } = run('INSERT INTO disputes (order_id, opened_by, reason, details) VALUES (?,?,?,?)', o.id, req.user!.id, d.reason, d.details);
  run('INSERT INTO order_events (order_id, status, actor_id, note) VALUES (?,?,?,?)', o.id, o.status, req.user!.id, 'Dispute opened');
  notify([o.seller_id], { type: 'system', title: `A buyer opened a dispute on order #${o.id}`, body: 'Payout is on hold until it is resolved. Reply with your side.', link: `/orders/${o.id}`, actorId: req.user!.id });
  res.status(201).json({ id });
});

orderTrustRouter.post('/:id/dispute/reply', requireAuth, (req, res) => {
  const o = myOrder(intParam(req), req.user!.id);
  if (o.seller_id !== req.user!.id) throw forbidden('Only the seller can reply');
  const dispute = openDispute(o.id);
  if (!dispute) throw notFound('Dispute');
  const { reply } = validate(req.body, { reply: { type: 'text', required: true, min: 2, max: 2000 } });
  run('UPDATE disputes SET seller_reply = ? WHERE id = ?', reply, dispute.id);
  notify([o.buyer_id], { type: 'system', title: `The seller replied to your dispute on order #${o.id}`, link: `/orders/${o.id}`, actorId: req.user!.id });
  res.json({ ok: true });
});

// ───────────── seller reviews ─────────────
orderTrustRouter.post('/:id/seller-review', requireAuth, (req, res) => {
  const o = myOrder(intParam(req), req.user!.id);
  if (o.buyer_id !== req.user!.id) throw forbidden('Only the buyer can review the seller');
  if (o.status !== 'delivered') throw badRequest('You can review the seller once your order is delivered');
  const d = validate(req.body, { rating: { type: 'int', required: true, min: 1, max: 5 }, body: { type: 'text', max: 2000 } });
  run(
    'INSERT INTO seller_reviews (order_id, seller_id, user_id, rating, body) VALUES (?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET rating = excluded.rating, body = excluded.body',
    o.id, o.seller_id, req.user!.id, d.rating, d.body ?? null,
  );
  res.status(201).json({ ok: true });
});

/** A seller's own view of what they are owed and have been paid. */
orderTrustRouter.get('/payouts/summary', requireAuth, (req, res) => {
  res.json({ items: sellerPayoutSummary(req.user!.id) });
});

// ───────────── staff: the dispute queue ─────────────
disputesAdminRouter.get('/disputes', requireStaff('disputes'), (req, res) => {
  const status = qStr(req, 'status') ?? 'open';
  const { limit, offset } = paging(req, 30);
  const rows = all(
    `SELECT d.*, o.buyer_id, o.seller_id, o.subtotal, o.currency, o.payment_status, o.payout_status FROM disputes d JOIN orders o ON o.id = d.order_id
     WHERE d.status = ? ORDER BY d.id DESC LIMIT ? OFFSET ?`,
    status, limit, offset,
  );
  const cards = userCards(rows.flatMap((r) => [r.buyer_id, r.seller_id]));
  res.json({ items: rows.map((r) => ({ ...r, buyer: cards.get(r.buyer_id), seller: cards.get(r.seller_id), items: all('SELECT name, qty, unit_price FROM order_items WHERE order_id = ?', r.order_id) })) });
});

disputesAdminRouter.post('/disputes/:id/resolve', requireStaff('disputes'), (req, res) => {
  const { decision, note } = validate(req.body, { decision: { type: 'enum', values: ['refund', 'reject'], required: true }, note: { type: 'text', required: true, min: 2, max: 1000 } });
  const dispute = get('SELECT * FROM disputes WHERE id = ?', intParam(req));
  if (!dispute) throw notFound('Dispute');
  if (dispute.status !== 'open') throw badRequest('This dispute is already resolved');
  const o = get('SELECT * FROM orders WHERE id = ?', dispute.order_id)!;
  tx(() => {
    run("UPDATE disputes SET status = ?, resolution = ?, handled_by = ?, handled_at = datetime('now') WHERE id = ?", decision === 'refund' ? 'refunded' : 'rejected', note, req.user!.id, dispute.id);
    if (decision === 'refund') {
      run("UPDATE orders SET payout_status = 'refunded', payment_status = CASE WHEN payment_status = 'paid' THEN 'refunded' ELSE payment_status END, updated_at = datetime('now') WHERE id = ?", o.id);
      run("UPDATE transactions SET status = 'refunded' WHERE order_id = ? AND status = 'succeeded'", o.id);
    } else if (o.status === 'delivered') {
      run("UPDATE orders SET payout_status = 'released' WHERE id = ? AND payout_status = 'held'", o.id);
    }
    run('INSERT INTO order_events (order_id, status, actor_id, note) VALUES (?,?,?,?)', o.id, o.status, req.user!.id, decision === 'refund' ? 'Dispute resolved: refunded' : 'Dispute resolved: no refund');
  });
  audit(req.user!.id, `dispute.${decision}`, 'order', o.id, { note });
  const verdict = decision === 'refund' ? 'The buyer is being refunded.' : 'No refund was granted.';
  for (const id of [o.buyer_id, o.seller_id]) {
    notify([id], { type: 'system', title: `Dispute on order #${o.id} resolved`, body: `${verdict} ${note}`, link: `/orders/${o.id}` });
    const u = get('SELECT email FROM users WHERE id = ?', id);
    if (u) sendEmail(u.email, `Dispute on order #${o.id} resolved`, `${verdict}\n\n${note}`);
  }
  res.json({ ok: true });
});

// ───────────── public storefront ─────────────
shopsRouter.get('/:username', (req, res) => {
  const row = get("SELECT id FROM users WHERE username = ? AND status = 'active'", String(req.params.username));
  if (!row) throw notFound('Seller');
  releaseDuePayouts();
  const seller = userCard(row.id)!;
  const products = all("SELECT * FROM products WHERE seller_id = ? AND status = 'active' ORDER BY id DESC LIMIT 60", row.id);
  const rating = sellerRatingMap([row.id]).get(row.id) ?? null;
  const reviews = all('SELECT * FROM seller_reviews WHERE seller_id = ? ORDER BY id DESC LIMIT 30', row.id);
  const cards = userCards(reviews.map((r) => r.user_id));
  const spread = all('SELECT rating, COUNT(*) AS n FROM seller_reviews WHERE seller_id = ? GROUP BY rating', row.id);
  res.json({
    seller: { ...seller, rating },
    business: get('SELECT name, category, description, kind FROM businesses WHERE user_id = ?', row.id) ?? null,
    products: hydrateProducts(products, req.user?.id),
    reviews: reviews.map((r) => ({ id: r.id, rating: r.rating, body: r.body, created_at: r.created_at, reviewer: cards.get(r.user_id) })),
    rating_spread: Object.fromEntries(spread.map((r) => [r.rating, r.n])),
    completed_orders: get("SELECT COUNT(*) AS n FROM orders WHERE seller_id = ? AND status = 'delivered'", row.id)?.n ?? 0,
  });
});
