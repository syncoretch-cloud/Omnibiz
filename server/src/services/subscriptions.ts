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
  { code: 'personal_plus', audience: 'personal', name: 'Plus', tagline: 'Stand out to recruiters.', price: 9000, features: ['Priority in recruiter search', 'Profile insights', 'Everything in Free'], limits: {}, highlight: 1 },
  { code: 'customer_free', audience: 'customer', name: 'Free', tagline: 'Browse, follow and buy.', price: 0, features: ['Browse the market', 'Orders and messages', 'Saved items'], limits: {} },
  { code: 'customer_plus', audience: 'customer', name: 'Plus', tagline: 'Shop with extra perks.', price: 5000, features: ['Order tracking alerts', 'Price-drop alerts on saved items', 'Everything in Free'], limits: {}, highlight: 1 },
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

export const VISIBILITY_LABEL = ['Standard', 'Priority', 'Top priority'] as const;

export interface Perks { analytics: boolean; support: 'standard' | 'priority'; verification_discount: number }
const FREE: Perks = { analytics: false, support: 'standard', verification_discount: 0 };
const MID: Perks = { analytics: true, support: 'standard', verification_discount: 10 };
const TOP: Perks = { analytics: true, support: 'priority', verification_discount: 25 };

// How far each plan lifts its owner in marketplace, job, business and people results (0 none, 1 priority, 2 top priority),
// and the other perks shown in the plan comparison. Applied once to a plan that has not been edited in the admin panel.
const TIERS: Record<string, { boost: number; perks: Perks; add: string[] }> = {
  personal_free: { boost: 0, perks: FREE, add: [] },
  personal_plus: { boost: 1, perks: MID, add: ['Priority placement in people search', '10% off the verification fee'] },
  customer_free: { boost: 0, perks: FREE, add: [] },
  customer_plus: { boost: 0, perks: { analytics: false, support: 'priority', verification_discount: 0 }, add: ['Priority support'] },
  company_free: { boost: 0, perks: FREE, add: [] },
  company_business: { boost: 1, perks: MID, add: ['Priority placement for your jobs, products and company page', '10% off the verification fee'] },
  company_enterprise: { boost: 2, perks: TOP, add: ['Top placement everywhere, ahead of every other plan', 'Featured badge on your products and jobs', '25% off the verification fee'] },
  wholesaler_free: { boost: 0, perks: FREE, add: [] },
  wholesaler_pro: { boost: 1, perks: MID, add: ['Priority placement in the marketplace and search', '10% off the verification fee'] },
  wholesaler_scale: { boost: 2, perks: TOP, add: ['Top placement in the marketplace, ahead of every other plan', 'Featured badge on your products', '25% off the verification fee'] },
  retailer_free: { boost: 0, perks: FREE, add: [] },
  retailer_pro: { boost: 1, perks: MID, add: ['Priority placement in the marketplace and search', '10% off the verification fee'] },
  retailer_scale: { boost: 2, perks: TOP, add: ['Top placement in the marketplace, ahead of every other plan', 'Featured badge on your products', '25% off the verification fee'] },
};

export function ensurePlans() {
  tx(() => {
    // Plus used to ship switched off with no price; give it one now, but only while it is still untouched.
    run("DELETE FROM plans WHERE code = 'personal_plus' AND price = 0 AND active = 0 AND tagline = 'Pricing to be announced.' AND NOT EXISTS (SELECT 1 FROM subscriptions WHERE plan_id = plans.id)");
    SEED.forEach((p, i) => {
      const tier = TIERS[p.code];
      run(
        'INSERT OR IGNORE INTO plans (code, audience, name, tagline, price, features, limits, active, highlight, sort, boost, perks) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        p.code, p.audience, p.name, p.tagline, p.price, JSON.stringify([...p.features, ...(tier?.add ?? [])]), JSON.stringify(p.limits), p.active ?? 1, p.highlight ?? 0, i, tier?.boost ?? 0, JSON.stringify(tier?.perks ?? FREE),
      );
      // Plans created before perks existed: give them their tier once, keeping whatever the admin already changed.
      const row = get("SELECT id, features FROM plans WHERE code = ? AND perks = '{}'", p.code);
      if (row && tier) {
        const features: string[] = parseJson(row.features, []);
        run('UPDATE plans SET boost = ?, perks = ?, features = ? WHERE id = ?', tier.boost, JSON.stringify(tier.perks), JSON.stringify([...features, ...tier.add.filter((a) => !features.includes(a))]), row.id);
      }
    });
  });
}

export function hydratePlan(r: Row): Row & { features: string[]; limits: Record<string, number | null>; perks: Perks } {
  return { ...r, perks: { ...FREE, ...parseJson<Partial<Perks>>(r.perks, {}) }, features: parseJson<string[]>(r.features, []), limits: parseJson<Record<string, number | null>>(r.limits, {}), active: !!r.active, highlight: !!r.highlight };
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

// Paying for longer costs less per month. Prices are the plan's monthly price times the months, less the discount.
export const PERIODS = {
  monthly: { label: 'Monthly', months: 1, discount: 0 },
  quarterly: { label: '3 months', months: 3, discount: 0.05 },
  yearly: { label: 'Yearly', months: 12, discount: 0.15 },
} as const;
export type Period = keyof typeof PERIODS;

export function paymentPlans(monthly: number) {
  return (Object.entries(PERIODS) as [Period, (typeof PERIODS)[Period]][]).map(([period, p]) => {
    const total = Math.round((monthly * p.months * (1 - p.discount)) / 100) * 100;
    return { period, label: p.label, months: p.months, total, per_month: Math.round(total / p.months), saving: monthly * p.months - total };
  });
}

export function subscribe(user: { id: number; account_type: string }, plan: Row, paymentRef: string | null, period: Period = 'monthly') {
  return tx(() => {
    run("UPDATE subscriptions SET status = 'cancelled', ended_at = datetime('now') WHERE user_id = ? AND status = 'active'", user.id);
    if (plan.price <= 0) return null;
    const pay = paymentPlans(plan.price).find((x) => x.period === period)!;
    return run(
      'INSERT INTO subscriptions (user_id, plan_id, price, payment_ref, renews_at, period) VALUES (?,?,?,?,?,?)',
      user.id, plan.id, pay.total, paymentRef, sqlTime(pay.months * 30 * DAY), period,
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
