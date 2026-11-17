import { Router } from 'express';
import { all, get, run } from '../db/index.ts';
import { badRequest, intParam, notFound, paging, validate } from '../lib/http.ts';
import type { Spec } from '../lib/http.ts';
import { audit, requireAuth, requireStaff } from '../lib/auth.ts';
import { userCards } from '../services/users.ts';
import { PERIODS, allPlans, currentPlan, hydratePlan, paymentPlans, subscribe, usage } from '../services/subscriptions.ts';
import { notify } from '../services/notify.ts';
import { setSetting } from '../services/settings.ts';
import { VERIFICATION_CURRENCY, verificationFee } from '../services/verification.ts';

export const subscriptionsRouter = Router();
export const billingAdminRouter = Router();

// What the signed-in person is on, what they've used, and the plans they can move to.
subscriptionsRouter.get('/', requireAuth, (req, res) => {
  const me = req.user!;
  const { plan, subscription } = currentPlan(me);
  res.json({
    plan,
    subscription,
    usage: usage(me.id),
    plans: allPlans(me.account_type).map((p) => ({ ...p, payment_plans: p.price > 0 ? paymentPlans(p.price) : [] })),
    // Billing runs in test mode until a payment provider is connected: choosing a plan switches it on straight away.
    billing: 'test',
  });
});

subscriptionsRouter.post('/subscribe', requireAuth, (req, res) => {
  const me = req.user!;
  const { plan_id, period } = validate(req.body, { plan_id: { type: 'int', required: true }, period: { type: 'enum', values: Object.keys(PERIODS) } });
  const plan = get('SELECT * FROM plans WHERE id = ? AND active = 1', plan_id);
  if (!plan || plan.audience !== me.account_type) throw notFound('Plan');
  const { plan: current, subscription } = currentPlan(me);
  if (current.id === plan.id && (!plan.price || (subscription?.period ?? 'monthly') === (period ?? 'monthly'))) throw badRequest('You are already on this plan');
  const ref = plan.price > 0 ? `test-${Date.now().toString(36)}` : null;
  subscribe(me, plan, ref, period ?? 'monthly');
  notify([me.id], { type: 'system', title: plan.price > 0 ? `You are now on the ${plan.name} plan` : `You moved to the ${plan.name} plan`, link: '/settings/plan' });
  res.json({ plan: hydratePlan(plan) });
});

subscriptionsRouter.post('/cancel', requireAuth, (req, res) => {
  const me = req.user!;
  const { subscription } = currentPlan(me);
  if (!subscription) throw badRequest('You are already on the free plan');
  run("UPDATE subscriptions SET status = 'cancelled', ended_at = datetime('now') WHERE id = ?", subscription.id);
  res.json({ ok: true });
});

// ───────────── Admin: plans and subscribers ─────────────
const PLAN_SPEC: Spec = {
  name: { type: 'string', max: 60 },
  tagline: { type: 'string', max: 160 },
  price: { type: 'number', min: 0 },
  features: { type: 'strings', max: 12 },
  limits: { type: 'json' },
  active: { type: 'bool' },
  highlight: { type: 'bool' },
};

billingAdminRouter.get('/plans', requireStaff('billing'), (_req, res) => {
  const counts = new Map(all("SELECT plan_id, COUNT(*) AS n FROM subscriptions WHERE status = 'active' GROUP BY plan_id").map((r) => [r.plan_id, r.n]));
  res.json({ items: allPlans(undefined, false).map((p) => ({ ...p, subscribers: counts.get(p.id) ?? 0 })) });
});

billingAdminRouter.patch('/plans/:id', requireStaff('billing'), (req, res) => {
  const plan = get('SELECT * FROM plans WHERE id = ?', intParam(req));
  if (!plan) throw notFound('Plan');
  const d = validate(req.body, PLAN_SPEC, { partial: true });
  if (d.limits !== undefined) {
    const l = d.limits;
    if (!l || typeof l !== 'object' || Array.isArray(l)) throw badRequest('Limits must be an object');
    for (const [k, v] of Object.entries(l)) {
      if (!['products', 'jobs'].includes(k) || !(v === null || (typeof v === 'number' && v >= 0))) throw badRequest(`Invalid limit: ${k}`);
    }
  }
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(d)) {
    sets.push(`${k} = ?`);
    params.push(k === 'features' || k === 'limits' ? JSON.stringify(v) : typeof v === 'boolean' ? (v ? 1 : 0) : v);
  }
  if (sets.length) run(`UPDATE plans SET ${sets.join(', ')} WHERE id = ?`, ...params, plan.id);
  audit(req.user!.id, 'plan.update', 'plan', plan.id, d);
  res.json({ plan: hydratePlan(get('SELECT * FROM plans WHERE id = ?', plan.id)!) });
});

billingAdminRouter.get('/subscribers', requireStaff('billing'), (req, res) => {
  const { limit, offset } = paging(req, 30);
  const rows = all(
    `SELECT s.*, p.name AS plan_name, p.code AS plan_code FROM subscriptions s JOIN plans p ON p.id = s.plan_id
     WHERE s.status = 'active' ORDER BY s.id DESC LIMIT ? OFFSET ?`,
    limit, offset,
  );
  const cards = userCards(rows.map((r) => r.user_id));
  const revenue = get("SELECT COALESCE(SUM(price), 0) AS n FROM subscriptions WHERE status = 'active'")?.n ?? 0;
  res.json({ items: rows.map((r) => ({ ...r, user: cards.get(r.user_id) })), monthly_total: revenue });
});

// ───────────── Admin: the verification fee ─────────────
billingAdminRouter.get('/settings', requireStaff('billing'), (_req, res) => {
  res.json({ verification_fee: verificationFee(), currency: VERIFICATION_CURRENCY });
});

billingAdminRouter.put('/settings', requireStaff('billing'), (req, res) => {
  const d = validate(req.body, { verification_fee: { type: 'number', required: true, min: 0 } });
  setSetting('verification_fee', String(Math.round(d.verification_fee)));
  audit(req.user!.id, 'settings.verification_fee', null, null, { fee: d.verification_fee });
  res.json({ verification_fee: verificationFee(), currency: VERIFICATION_CURRENCY });
});
