// Commerce layer (spec §33): Product → Cart → Checkout → Payment → Seller confirmation → Delivery → Tracking → Review.
// Payment methods are recorded as transactions; wiring a real provider (M-Pesa/Tigo Pesa/Airtel Money
// aggregators, card processors) means confirming those transactions from the provider's webhook.
import { Router } from 'express';
import { all, get, qs, run, tx } from '../db/index.ts';
import type { Row } from '../db/index.ts';
import { badRequest, forbidden, intParam, notFound, validate } from '../lib/http.ts';
import { requireAuth, requirePerm } from '../lib/auth.ts';
import { PAYMENT_METHODS } from '../lib/constants.ts';
import { randomToken } from '../lib/crypto.ts';
import { emit } from '../lib/queue.ts';
import { userCards } from '../services/users.ts';
import { hydrateProducts } from './products.ts';

export const cartRouter = Router();
export const ordersRouter = Router();
cartRouter.use(requirePerm('purchase'));
ordersRouter.use(requireAuth);

function cartView(userId: number) {
  const items = all('SELECT * FROM cart_items WHERE user_id = ? ORDER BY added_at', userId);
  const products = items.length ? all(`SELECT * FROM products WHERE id IN (${qs(items.length)})`, ...items.map((i) => i.product_id)) : [];
  const byId = new Map(hydrateProducts(products, userId).map((p) => [p.id, p]));
  const groups = new Map<number, { seller: unknown; items: Row[]; subtotal: number; currency: string; problems: string[] }>();
  for (const it of items) {
    const p = byId.get(it.product_id);
    if (!p) continue;
    const sellerId = p.seller!.id;
    const g = groups.get(sellerId) ?? { seller: p.seller, items: [] as Row[], subtotal: 0, currency: p.currency as string, problems: [] as string[] };
    const problems: string[] = [];
    if (p.status !== 'active') problems.push('No longer available');
    if (p.availability === 'out_of_stock') problems.push('Out of stock');
    if (it.qty < p.min_order_qty) problems.push(`Minimum order is ${p.min_order_qty}`);
    if (p.quantity != null && it.qty > p.quantity) problems.push(`Only ${p.quantity} available`);
    if (p.currency !== g.currency) problems.push('Different currency — check out separately');
    g.items.push({ product: p, qty: it.qty, line_total: p.price * it.qty, problems });
    g.subtotal += p.price * it.qty;
    g.problems.push(...problems);
    groups.set(sellerId, g);
  }
  return { groups: [...groups.values()], count: items.reduce((s, i) => s + i.qty, 0) };
}

cartRouter.get('/', (req, res) => res.json(cartView(req.user!.id)));

cartRouter.post('/', (req, res) => {
  const d = validate(req.body, { product_id: { type: 'int', required: true, min: 1 }, qty: { type: 'int', min: 1, max: 1_000_000 } });
  const p = get("SELECT * FROM products WHERE id = ? AND status = 'active'", d.product_id);
  if (!p) throw notFound('Product');
  if (p.seller_id === req.user!.id) throw badRequest('You cannot buy your own product');
  if (p.availability === 'out_of_stock') throw badRequest('This product is out of stock');
  const existing = get('SELECT qty FROM cart_items WHERE user_id = ? AND product_id = ?', req.user!.id, p.id);
  const qty = Math.max(p.min_order_qty, (existing?.qty ?? 0) + (d.qty ?? p.min_order_qty));
  run('INSERT INTO cart_items (user_id, product_id, qty) VALUES (?,?,?) ON CONFLICT(user_id, product_id) DO UPDATE SET qty = excluded.qty', req.user!.id, p.id, qty);
  res.json(cartView(req.user!.id));
});

cartRouter.patch('/:productId', (req, res) => {
  const { qty } = validate(req.body, { qty: { type: 'int', required: true, min: 0, max: 1_000_000 } });
  const pid = intParam(req, 'productId');
  if (qty === 0) run('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?', req.user!.id, pid);
  else run('UPDATE cart_items SET qty = ? WHERE user_id = ? AND product_id = ?', qty, req.user!.id, pid);
  res.json(cartView(req.user!.id));
});

cartRouter.delete('/:productId', (req, res) => {
  run('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?', req.user!.id, intParam(req, 'productId'));
  res.json(cartView(req.user!.id));
});

// ───────────── checkout ─────────────
ordersRouter.post('/checkout', requirePerm('purchase'), (req, res) => {
  const d = validate(req.body, {
    payment_method: { type: 'enum', values: PAYMENT_METHODS, required: true },
    delivery_address: { type: 'text', required: true, min: 5, max: 500 },
    delivery_phone: { type: 'string', required: true, max: 20 },
    note: { type: 'text', max: 1000 },
    seller_id: { type: 'int', min: 1 },
  });
  const view = cartView(req.user!.id);
  const groups = view.groups.filter((g) => !d.seller_id || (g.seller as Row).id === d.seller_id);
  if (!groups.length) throw badRequest('Your cart is empty');
  const problem = groups.find((g) => g.problems.length);
  if (problem) throw badRequest(`Please fix your cart: ${problem.problems[0]}`);

  const orderIds = tx(() =>
    groups.map((g) => {
      const sellerId = (g.seller as Row).id as number;
      const { id } = run(
        `INSERT INTO orders (buyer_id, seller_id, subtotal, currency, payment_method, payment_status, delivery_address, delivery_phone, note)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        req.user!.id, sellerId, g.subtotal, g.currency, d.payment_method, d.payment_method === 'cash_on_delivery' ? 'unpaid' : 'pending',
        d.delivery_address, d.delivery_phone, d.note ?? null,
      );
      for (const it of g.items) {
        const p = it.product as Row;
        // Re-check stock inside the transaction so concurrent checkouts cannot oversell.
        const { changes } = run('UPDATE products SET quantity = quantity - ? WHERE id = ? AND (quantity IS NULL OR quantity >= ?)', it.qty, p.id, it.qty);
        if (!changes) throw badRequest(`${p.name} no longer has enough stock`);
        run("UPDATE products SET availability = 'out_of_stock' WHERE id = ? AND quantity = 0", p.id);
        run('INSERT INTO order_items (order_id, product_id, name, unit_price, qty) VALUES (?,?,?,?,?)', id, p.id, p.name, p.price, it.qty);
        run('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?', req.user!.id, p.id);
      }
      run("INSERT INTO order_events (order_id, status, actor_id, note) VALUES (?, 'pending', ?, 'Order placed')", id, req.user!.id);
      run('INSERT INTO transactions (order_id, amount, currency, method, reference) VALUES (?,?,?,?,?)', id, g.subtotal, g.currency, d.payment_method, `OB-${id}-${randomToken(4).toUpperCase()}`);
      return id;
    }),
  );
  for (const id of orderIds) emit('order.updated', { orderId: id, status: 'pending', actorId: req.user!.id });
  res.status(201).json({ order_ids: orderIds });
});

// ───────────── orders ─────────────
function hydrateOrders(rows: Row[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const items = all(`SELECT * FROM order_items WHERE order_id IN (${qs(ids.length)})`, ...ids);
  const cards = userCards(rows.flatMap((r) => [r.buyer_id, r.seller_id]));
  return rows.map((r) => ({ ...r, buyer: cards.get(r.buyer_id), seller: cards.get(r.seller_id), items: items.filter((i) => i.order_id === r.id) }));
}

ordersRouter.get('/', (req, res) => {
  const role = req.query.role === 'seller' ? 'seller_id' : 'buyer_id';
  const status = typeof req.query.status === 'string' ? req.query.status : null;
  const rows = all(`SELECT * FROM orders WHERE ${role} = ? ${status ? 'AND status = ?' : ''} ORDER BY id DESC LIMIT 200`, req.user!.id, ...(status ? [status] : []));
  res.json({ orders: hydrateOrders(rows) });
});

function loadOrder(id: number, userId: number) {
  const o = get('SELECT * FROM orders WHERE id = ?', id);
  if (!o || (o.buyer_id !== userId && o.seller_id !== userId)) throw notFound('Order');
  return o;
}

ordersRouter.get('/:id', (req, res) => {
  const o = loadOrder(intParam(req), req.user!.id);
  const [order] = hydrateOrders([o]);
  res.json({
    order,
    events: all('SELECT status, note, created_at, actor_id FROM order_events WHERE order_id = ? ORDER BY id', o.id),
    transactions: all('SELECT method, amount, currency, status, reference, created_at FROM transactions WHERE order_id = ?', o.id),
    reviewed: all('SELECT product_id FROM reviews WHERE order_id = ?', o.id).map((r) => r.product_id),
    role: o.seller_id === req.user!.id ? 'seller' : 'buyer',
  });
});

const SELLER_FLOW: Record<string, string[]> = { pending: ['confirmed', 'cancelled'], confirmed: ['shipped', 'cancelled'], shipped: ['delivered'] };
const BUYER_FLOW: Record<string, string[]> = { pending: ['cancelled'], shipped: ['delivered'] };

ordersRouter.post('/:id/status', (req, res) => {
  const o = loadOrder(intParam(req), req.user!.id);
  const { status, note } = validate(req.body, { status: { type: 'enum', values: ['confirmed', 'shipped', 'delivered', 'cancelled'], required: true }, note: { type: 'text', max: 500 } });
  const flow = o.seller_id === req.user!.id ? SELLER_FLOW : BUYER_FLOW;
  if (!flow[o.status]?.includes(status)) throw badRequest(`An order that is ${o.status} cannot be marked ${status}`);
  tx(() => {
    run("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?", status, o.id);
    run('INSERT INTO order_events (order_id, status, actor_id, note) VALUES (?,?,?,?)', o.id, status, req.user!.id, note ?? null);
    if (status === 'cancelled') {
      for (const it of all('SELECT * FROM order_items WHERE order_id = ?', o.id)) {
        run("UPDATE products SET quantity = quantity + ?, availability = CASE WHEN availability = 'out_of_stock' THEN 'in_stock' ELSE availability END WHERE id = ? AND quantity IS NOT NULL", it.qty, it.product_id);
      }
      run("UPDATE transactions SET status = CASE WHEN status = 'succeeded' THEN 'refunded' ELSE 'failed' END WHERE order_id = ?", o.id);
      if (o.payment_status === 'paid') run("UPDATE orders SET payment_status = 'refunded' WHERE id = ?", o.id);
    }
    if (status === 'delivered' && o.payment_method === 'cash_on_delivery') {
      run("UPDATE orders SET payment_status = 'paid' WHERE id = ?", o.id);
      run("UPDATE transactions SET status = 'succeeded' WHERE order_id = ?", o.id);
    }
  });
  emit('order.updated', { orderId: o.id, status, actorId: req.user!.id });
  res.json({ ok: true, status });
});

/** Seller confirms receipt of a mobile-money / bank payment (until provider webhooks do it automatically). */
ordersRouter.post('/:id/payment-received', (req, res) => {
  const o = loadOrder(intParam(req), req.user!.id);
  if (o.seller_id !== req.user!.id) throw forbidden();
  if (o.payment_status === 'paid') return res.json({ ok: true });
  tx(() => {
    run("UPDATE orders SET payment_status = 'paid', updated_at = datetime('now') WHERE id = ?", o.id);
    run("UPDATE transactions SET status = 'succeeded' WHERE order_id = ?", o.id);
    run("INSERT INTO order_events (order_id, status, actor_id, note) VALUES (?, ?, ?, 'Payment received')", o.id, o.status, req.user!.id);
  });
  res.json({ ok: true });
});

ordersRouter.post('/:id/reviews', (req, res) => {
  const o = loadOrder(intParam(req), req.user!.id);
  if (o.buyer_id !== req.user!.id) throw forbidden();
  if (o.status !== 'delivered') throw badRequest('You can review products once your order is delivered');
  const d = validate(req.body, { product_id: { type: 'int', required: true, min: 1 }, rating: { type: 'int', required: true, min: 1, max: 5 }, body: { type: 'text', max: 2000 } });
  if (!get('SELECT 1 AS x FROM order_items WHERE order_id = ? AND product_id = ?', o.id, d.product_id)) throw badRequest('That product is not part of this order');
  run(
    'INSERT INTO reviews (product_id, seller_id, order_id, user_id, rating, body) VALUES (?,?,?,?,?,?) ON CONFLICT(order_id, product_id) DO UPDATE SET rating = excluded.rating, body = excluded.body',
    d.product_id, o.seller_id, o.id, req.user!.id, d.rating, d.body ?? null,
  );
  res.status(201).json({ ok: true });
});
