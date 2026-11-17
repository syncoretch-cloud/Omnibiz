// Seller payouts are held until the buyer has the goods. They are released when the buyer confirms delivery, or
// automatically a few days after the seller marks the order delivered, and never while a dispute is open.
// With no payment provider connected yet this is the ledger a provider payout would read from.
import { all, get, qs, run, sqlTime, DAY } from '../db/index.ts';
import type { Row } from '../db/index.ts';

export const AUTO_RELEASE_DAYS = 3;
/** How long after the last update a buyer can still open a dispute. */
export const DISPUTE_WINDOW_DAYS = 14;

/** Pays out orders that were delivered and are past their release date, unless a dispute is open. */
export function releaseDuePayouts() {
  return run(
    `UPDATE orders SET payout_status = 'released'
     WHERE payout_status = 'held' AND status = 'delivered' AND COALESCE(payout_release_at, updated_at) <= ?
       AND NOT EXISTS (SELECT 1 FROM disputes d WHERE d.order_id = orders.id AND d.status = 'open')`,
    sqlTime(),
  ).changes;
}

/** Called when an order becomes delivered: the buyer's own confirmation pays out at once, the seller's starts the wait. */
export function onDelivered(orderId: number, byBuyer: boolean) {
  if (byBuyer) run("UPDATE orders SET payout_status = 'released', payout_release_at = datetime('now') WHERE id = ? AND payout_status = 'held'", orderId);
  else run('UPDATE orders SET payout_release_at = ? WHERE id = ?', sqlTime(AUTO_RELEASE_DAYS * DAY), orderId);
}

export function sellerRatingMap(ids: (number | null | undefined)[]): Map<number, { avg: number; count: number }> {
  const uniq = [...new Set(ids.filter((x): x is number => typeof x === 'number'))];
  if (!uniq.length) return new Map();
  return new Map(
    all(`SELECT seller_id, AVG(rating) AS avg, COUNT(*) AS count FROM seller_reviews WHERE seller_id IN (${qs(uniq.length)}) GROUP BY seller_id`, ...uniq)
      .map((r) => [r.seller_id as number, { avg: Math.round(r.avg * 10) / 10, count: r.count as number }]),
  );
}

/** Money a seller is owed (held) and has been paid (released), per currency. */
export function sellerPayoutSummary(sellerId: number): Row[] {
  releaseDuePayouts();
  return all(
    `SELECT currency, payout_status AS status, COALESCE(SUM(subtotal), 0) AS amount, COUNT(*) AS orders FROM orders
     WHERE seller_id = ? AND status != 'cancelled' GROUP BY currency, payout_status`,
    sellerId,
  );
}

export const openDispute = (orderId: number): Row | undefined => get("SELECT * FROM disputes WHERE order_id = ? AND status = 'open'", orderId);
