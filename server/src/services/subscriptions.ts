// Plans and entitlements. Everyone is on the free plan of their account type until they subscribe; a paid
// subscription that has run past its renewal date drops back to free. Limits are enforced where things are created.
import { all, get, parseJson, run, sqlTime, tx, DAY } from '../db/index.ts';
import type { Row } from '../db/index.ts';
import { HttpError } from '../lib/http.ts';

export type LimitKey = 'products' | 'jobs';

// Starting plans. Prices are placeholders to be set from the admin panel; INSERT OR IGNORE keeps later edits.
// Personal and customer paid plans start switched off until their pricing is decided.
const SEED: { code: string; audience: string; name: string; tagline: string; price: number; features: string[]; limits: Record<string, number | null>; active?: number; highlight?: number }[] = [
  { code: 'personal_free', audience: 'personal', name: 'Free', tagline: 'Everything you need to build your profile and apply.', price: 0, features: ['Profile and CV', 'Apply to jobs', 'Posts, messages and saves'], limits: {} },
  { code: 'personal_plus', audience: 'personal', name: 'Plus', tagline: 'Pricing to be announced.', price: 0, features: ['Priority in recruiter search', 'Profile insights'], limits: {}, active: 0 },
  { code: 'customer_free', audience: 'customer', name: 'Free', tagline: 'Browse, follow and buy.', price: 0, features: ['Browse the market', 'Orders and messages', 'Saved items'], limits: {} },
  { code: 'company_free', audience: 'company', name: 'Starter', tagline: 'Get your company on OmniBiz.', price: 0, features: ['Company page', '2 open jobs', '5 products'], limits: { jobs: 2, products: 5 } },
  { code: 'company_business', audience: 'company', name: 'Business', tagline: 'Hire and sell at a steady pace.', price: 49000, features: ['15 open jobs', '100 products', 'Applicant pipeline and analytics'], limits: { jobs: 15, products: 100 }, highlight: 1 },
  { code: 'company_enterprise', audience: 'company', name: 'Enterprise', tagline: 'No limits for large teams.', price: 149000, features: ['Unlimited jobs and products', 'Priority support'], limits: { jobs: null, products: null } },
  { code: 'wholesaler_free', audience: 'wholesaler', name: 'Starter', tagline: 'List your first products.', price: 0, features: ['10 products', 'Wholesale orders'], limits: { products: 10 } },
  { code: 'wholesaler_pro', audience: 'wholesaler', name: 'Pro', tagline: 'A full catalogue for growing suppliers.', price: 19000, features: ['200 products', 'Sales analytics'], limits: { products: 200 }, highlight: 1 },
  { code: 'wholesaler_scale', audience: 'wholesaler', name: 'Scale', tagline: 'Unlimited catalogue.', price: 59000, features: ['Unlimited products', 'Priority support'], limits: { products: null } },
  { code: 'retailer_free', audience: 'retailer', name: 'Starter', tagline: 'List your first products.', price: 0, features: ['10 products', 'Retail orders'], limits: { products: 10 } },
  { code: 'retailer_pro', audience: 'retailer', name: 'Pro', tagline: 'A full shop front.', price: 19000, features: ['200 products', 'Sales analytics'], limits: { products: 200 }, highlight: 1 },
  { code: 'retailer_scale', audience: 'retailer', name: 'Scale', tagline: 'Unlimited catalogue.', price: 59000, features: ['Unlimited products', 'Priority support'], limits: { products: null } },
];

export function ensurePlans() {
  tx(() => {
    SEED.forEach((p, i) =>
      run(
        'INSERT OR IGNORE INTO plans (code, audience, name, tagline, price, features, limits, active, highlight, sort) VALUES (?,?,?,?,?,?,?,?,?,?)',
        p.code, p.audience, p.name, p.tagline, p.price, JSON.stringify(p.features), JSON.stringify(p.limits), p.active ?? 1, p.highlight ?? 0, i,
      ),
    );
  });
}

export function hydratePlan(r: Row): Row & { features: string[]; limits: Record<string, number | null> } {
  return { ...r, features: parseJson<string[]>(r.features, []), limits: parseJson<Record<string, number | null>>(r.limits, {}), active: !!r.active, highlight: !!r.highlight };
}

function freePlan(accountType: string): Row {
  return get('SELECT * FROM plans WHERE audience = ? AND price = 0 ORDER BY sort LIMIT 1', accountType) as Row;
}

/** The plan a user is on right now, with the subscription behind it (null on the free plan). */
export function currentPlan(user: { id: number; account_type: string }) {
  const sub = get(
    "SELECT * FROM subscriptions WHERE user_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
    user.id,
  );
  if (sub && sub.renews_at && sub.renews_at < sqlTime()) {
    run("UPDATE subscriptions SET status = 'expired', ended_at = datetime('now') WHERE id = ?", sub.id);
  } else if (sub) {
    const plan = get('SELECT * FROM plans WHERE id = ?', sub.plan_id);
    if (plan) return { plan: hydratePlan(plan), subscription: sub };
  }
  return { plan: hydratePlan(freePlan(user.account_type)), subscription: null as Row | null };
}

export function usage(userId: number) {
  return {
    products: get("SELECT COUNT(*) AS n FROM products WHERE seller_id = ? AND status = 'active'", userId)?.n ?? 0,
    jobs: get("SELECT COUNT(*) AS n FROM jobs WHERE company_id = ? AND status = 'open'", userId)?.n ?? 0,
  };
}

/** Throws 402 when creating one more `key` would pass the plan's limit. */
export function assertWithinLimit(user: { id: number; account_type: string }, key: LimitKey) {
  const { plan } = currentPlan(user);
  const max = plan.limits[key];
  if (max === undefined || max === null) return;
  if (usage(user.id)[key] >= max) {
    throw new HttpError(402, `The ${plan.name} plan allows ${max} active ${key}. Upgrade your plan to add more.`, { upgrade: true, limit: key });
  }
}

export function subscribe(user: { id: number; account_type: string }, plan: Row, paymentRef: string | null) {
  return tx(() => {
    run("UPDATE subscriptions SET status = 'cancelled', ended_at = datetime('now') WHERE user_id = ? AND status = 'active'", user.id);
    if (plan.price <= 0) return null;
    return run(
      'INSERT INTO subscriptions (user_id, plan_id, price, payment_ref, renews_at) VALUES (?,?,?,?,?)',
      user.id, plan.id, plan.price, paymentRef, sqlTime(30 * DAY),
    ).id;
  });
}

export function allPlans(audience?: string, activeOnly = true) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (audience) { where.push('audience = ?'); params.push(audience); }
  if (activeOnly) where.push('active = 1');
  return all(`SELECT * FROM plans ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY sort`, ...params).map(hydratePlan);
}
