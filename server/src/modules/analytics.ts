// Business analytics (spec §25) and a lightweight business assistant (spec §32) that answers
// common questions from the same numbers. The assistant is rule-based today; its answer() function
// is the seam for an LLM that receives these metrics as structured context.
import { Router } from 'express';
import { all, get, sqlTime, DAY } from '../db/index.ts';
import type { Row } from '../db/index.ts';
import { validate } from '../lib/http.ts';
import { requirePerm } from '../lib/auth.ts';
import { userCards } from '../services/users.ts';

export const analyticsRouter = Router();
analyticsRouter.use(requirePerm('view_analytics'));

const METRICS = ['profile_view', 'product_view', 'job_view', 'post_impression', 'search_appearance', 'inquiry', 'application', 'follow'];

function overview(ownerId: number, days: number) {
  const from = sqlTime(-days * DAY);
  const prevFrom = sqlTime(-2 * days * DAY);
  const count = (start: string, end: string | null) =>
    Object.fromEntries(
      all(
        `SELECT type, COUNT(*) AS n FROM analytics_events WHERE owner_id = ? AND created_at > ? ${end ? 'AND created_at <= ?' : ''} GROUP BY type`,
        ownerId, start, ...(end ? [end] : []),
      ).map((r) => [r.type, r.n]),
    );
  const current = count(from, null);
  const previous = count(prevFrom, from);
  const totals = Object.fromEntries(METRICS.map((m) => [m, { value: current[m] ?? 0, previous: previous[m] ?? 0 }]));

  const engagement = get(
    `SELECT
      (SELECT COUNT(*) FROM likes l JOIN posts p ON p.id = l.post_id WHERE p.author_id = ? AND l.created_at > ?) AS likes,
      (SELECT COUNT(*) FROM comments c JOIN posts p ON p.id = c.post_id WHERE p.author_id = ? AND c.created_at > ? AND c.status = 'active') AS comments,
      (SELECT COUNT(*) FROM posts r JOIN posts p ON p.id = r.repost_of WHERE p.author_id = ? AND r.created_at > ?) AS reposts,
      (SELECT COUNT(*) FROM saves s JOIN products p ON p.id = s.target_id AND s.target_type = 'product' WHERE p.seller_id = ? AND s.created_at > ?) AS product_saves`,
    ownerId, from, ownerId, from, ownerId, from, ownerId, from,
  )!;

  const daily = all(
    `SELECT date(created_at) AS day, type, COUNT(*) AS n FROM analytics_events
     WHERE owner_id = ? AND created_at > ? AND type IN ('profile_view','product_view','post_impression','search_appearance','job_view')
     GROUP BY day, type ORDER BY day`,
    ownerId, from,
  );
  const series: Record<string, number[]> = {};
  const daysList: string[] = [];
  for (let i = days - 1; i >= 0; i--) daysList.push(new Date(Date.now() - i * DAY).toISOString().slice(0, 10));
  for (const t of ['profile_view', 'product_view', 'post_impression', 'search_appearance', 'job_view']) series[t] = daysList.map(() => 0);
  for (const r of daily) {
    const i = daysList.indexOf(r.day);
    if (i >= 0) series[r.type][i] = r.n;
  }

  const topProducts = all(
    `SELECT p.id, p.name, p.price, p.currency, p.media,
       (SELECT COUNT(*) FROM analytics_events e WHERE e.owner_id = ? AND e.type = 'product_view' AND e.target_id = p.id AND e.created_at > ?) AS views,
       (SELECT COUNT(*) FROM analytics_events e WHERE e.owner_id = ? AND e.type = 'product_view' AND e.target_id = p.id AND e.created_at > ? AND e.created_at <= ?) AS prev_views,
       (SELECT COUNT(*) FROM saves s WHERE s.target_type = 'product' AND s.target_id = p.id) AS saves,
       (SELECT COUNT(*) FROM analytics_events e WHERE e.owner_id = ? AND e.type = 'inquiry' AND e.target_type = 'product' AND e.target_id = p.id AND e.created_at > ?) AS inquiries,
       (SELECT COALESCE(SUM(oi.qty), 0) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = p.id AND o.status != 'cancelled' AND o.created_at > ?) AS units_sold
     FROM products p WHERE p.seller_id = ? AND p.status = 'active' ORDER BY views DESC, saves DESC LIMIT 10`,
    ownerId, from, ownerId, prevFrom, from, ownerId, from, from, ownerId,
  );
  const topPosts = all(
    `SELECT p.id, substr(p.body, 1, 120) AS body, p.like_count, p.comment_count, p.share_count,
       (SELECT COUNT(*) FROM analytics_events e WHERE e.owner_id = ? AND e.type = 'post_impression' AND e.target_id = p.id AND e.created_at > ?) AS reach
     FROM posts p WHERE p.author_id = ? AND p.status = 'active' ORDER BY reach DESC LIMIT 5`,
    ownerId, from, ownerId,
  );
  const applicationSources = all(
    "SELECT COALESCE(source, 'direct') AS source, COUNT(*) AS n FROM analytics_events WHERE owner_id = ? AND type = 'application' AND created_at > ? GROUP BY 1 ORDER BY n DESC",
    ownerId, from,
  );
  const searchTerms = all(
    "SELECT source AS term, COUNT(*) AS n FROM analytics_events WHERE owner_id = ? AND type = 'search_appearance' AND created_at > ? AND source IS NOT NULL GROUP BY source ORDER BY n DESC LIMIT 10",
    ownerId, from,
  );
  const viewSources = all(
    "SELECT COALESCE(source, 'direct') AS source, COUNT(*) AS n FROM analytics_events WHERE owner_id = ? AND type IN ('profile_view','product_view') AND created_at > ? GROUP BY 1 ORDER BY n DESC",
    ownerId, from,
  );
  const sales = get(
    "SELECT COUNT(*) AS orders, COALESCE(SUM(subtotal), 0) AS revenue, MAX(currency) AS currency FROM orders WHERE seller_id = ? AND status != 'cancelled' AND created_at > ?",
    ownerId, from,
  )!;

  // Orders received, and the people the business has dealt with: buyers plus anyone it exchanged messages with.
  const orderRow = (start: string, end: string | null) =>
    get(
      `SELECT COUNT(*) AS total, COALESCE(SUM(status = 'pending'), 0) AS pending, COALESCE(SUM(status = 'confirmed'), 0) AS confirmed,
              COALESCE(SUM(status = 'shipped'), 0) AS shipped, COALESCE(SUM(status = 'delivered'), 0) AS delivered, COALESCE(SUM(status = 'cancelled'), 0) AS cancelled
       FROM orders WHERE seller_id = ? AND created_at > ? ${end ? 'AND created_at <= ?' : ''}`,
      ownerId, start, ...(end ? [end] : []),
    )!;
  const buyersIn = (start: string, end: string | null) =>
    all(`SELECT DISTINCT buyer_id AS uid FROM orders WHERE seller_id = ? AND status != 'cancelled' AND created_at > ? ${end ? 'AND created_at <= ?' : ''}`, ownerId, start, ...(end ? [end] : [])).map((r) => r.uid as number);
  const chattersIn = (start: string, end: string | null) =>
    all(
      `SELECT DISTINCT other.user_id AS uid FROM conversation_members mine
       JOIN conversation_members other ON other.conversation_id = mine.conversation_id AND other.user_id != mine.user_id
       JOIN messages m ON m.conversation_id = mine.conversation_id
       WHERE mine.user_id = ? AND m.created_at > ? ${end ? 'AND m.created_at <= ?' : ''}`,
      ownerId, start, ...(end ? [end] : []),
    ).map((r) => r.uid as number);
  const buyers = buyersIn(from, null);
  const chatters = chattersIn(from, null);
  const everyone = new Set([...buyers, ...chatters]);
  const previousEveryone = new Set([...buyersIn(prevFrom, from), ...chattersIn(prevFrom, from)]);
  const repeat = get(
    `SELECT COUNT(*) AS n FROM (SELECT buyer_id FROM orders WHERE seller_id = ? AND status != 'cancelled' AND created_at > ? GROUP BY buyer_id HAVING COUNT(*) >= 2)`,
    ownerId, from,
  )!.n as number;
  const orders = {
    ...orderRow(from, null),
    previous: orderRow(prevFrom, from).total,
    awaiting: get("SELECT COUNT(*) AS n FROM orders WHERE seller_id = ? AND status = 'pending'", ownerId)!.n as number,
  };
  const customers = { total: everyone.size, previous: previousEveryone.size, ordered: buyers.length, chatted: chatters.length, repeat };
  const recentRows = all('SELECT id, buyer_id, status, subtotal, currency, created_at FROM orders WHERE seller_id = ? ORDER BY id DESC LIMIT 5', ownerId);
  const cards = userCards(recentRows.map((r) => r.buyer_id));
  const recentOrders = recentRows.map((r) => ({ id: r.id, status: r.status, subtotal: r.subtotal, currency: r.currency, created_at: r.created_at, buyer: cards.get(r.buyer_id) }));

  return { days, totals, engagement, orders, customers, recentOrders, series: { days: daysList, ...series }, topProducts, topPosts, applicationSources, searchTerms, viewSources, sales };
}

function pct(cur: number, prev: number) {
  if (!prev) return cur ? 'new this period' : 'no change';
  const p = Math.round(((cur - prev) / prev) * 100);
  return `${p >= 0 ? '+' : ''}${p}% vs previous period`;
}

function insights(o: ReturnType<typeof overview>): string[] {
  const out: string[] = [];
  const t = o.totals as Record<string, { value: number; previous: number }>;
  const best = o.topProducts[0] as Row | undefined;
  if (best?.views) out.push(`Your best-performing product is “${best.name}” with ${best.views} views (${pct(best.views, best.prev_views)}).`);
  if (t.profile_view.value) out.push(`Profile views: ${t.profile_view.value} (${pct(t.profile_view.value, t.profile_view.previous)}).`);
  if (t.search_appearance.value) out.push(`You appeared in search ${t.search_appearance.value} times${o.searchTerms[0] ? `, most often for “${o.searchTerms[0].term}”` : ''}.`);
  if (t.inquiry.value) out.push(`${t.inquiry.value} customer inquiries started a conversation with you.`);
  if (o.orders.awaiting) out.push(`${o.orders.awaiting} order${o.orders.awaiting === 1 ? ' is' : 's are'} waiting for you to confirm.`);
  if (o.customers.total) out.push(`You dealt with ${o.customers.total} customer${o.customers.total === 1 ? '' : 's'}: ${o.customers.ordered} ordered and ${o.customers.chatted} messaged you${o.customers.repeat ? `, and ${o.customers.repeat} bought more than once` : ''}.`);
  if (t.application.value) out.push(`${t.application.value} job applications received${o.applicationSources[0] ? `, mostly via ${o.applicationSources[0].source}` : ''}.`);
  const lowConv = (o.topProducts as Row[]).find((p) => p.views >= 20 && !p.inquiries && !p.units_sold);
  if (lowConv) out.push(`“${lowConv.name}” gets attention (${lowConv.views} views) but no inquiries — consider clearer pricing, photos or a promotion.`);
  if (!out.length) out.push('Not much activity yet. Publish posts, add products with photos and follow your industry to start appearing in feeds and search.');
  return out;
}

analyticsRouter.get('/overview', (req, res) => {
  const days = Math.min(365, Math.max(7, Number(req.query.days) || 30));
  const o = overview(req.user!.id, days);
  res.json({ ...o, insights: insights(o) });
});

analyticsRouter.post('/ask', (req, res) => {
  const { question } = validate(req.body, { question: { type: 'string', required: true, max: 300 } });
  const q = question.toLowerCase();
  const days = /\b(week|7 days)\b/.test(q) ? 7 : /\b(year|12 months)\b/.test(q) ? 365 : /\bquarter|90 days\b/.test(q) ? 90 : 30;
  const o = overview(req.user!.id, days);
  const t = o.totals as Record<string, { value: number; previous: number }>;
  const period = days === 7 ? 'this week' : days === 365 ? 'this year' : days === 90 ? 'this quarter' : 'in the last 30 days';
  let answer: string;
  let table: Row[] | undefined;
  if (/product|selling|perform|best|top/.test(q)) {
    table = (o.topProducts as Row[]).slice(0, 5).map((p) => ({ product: p.name, views: p.views, saves: p.saves, inquiries: p.inquiries, units_sold: p.units_sold }));
    answer = table.length ? `Your top products ${period}, ranked by views:` : 'You have no product activity yet.';
  } else if (/customer|client|buyer/.test(q)) {
    answer = `You dealt with ${o.customers.total} customers ${period}: ${o.customers.ordered} placed orders, ${o.customers.chatted} messaged you, and ${o.customers.repeat} bought more than once.`;
  } else if (/applica|candidate|hiring|recruit/.test(q)) {
    answer = `You received ${t.application.value} applications ${period} (${pct(t.application.value, t.application.previous)}).`;
    table = (o.applicationSources as Row[]).map((s) => ({ source: s.source, applications: s.n }));
  } else if (/search/.test(q)) {
    answer = `You appeared in search results ${t.search_appearance.value} times ${period}.`;
    table = (o.searchTerms as Row[]).map((s) => ({ search_term: s.term, appearances: s.n }));
  } else if (/sale|revenue|order|sold/.test(q)) {
    answer = `${o.sales.orders} orders worth ${o.sales.currency ?? 'TZS'} ${Number(o.sales.revenue).toLocaleString('en-US')} ${period}.`;
  } else if (/post|reach|engage/.test(q)) {
    answer = `Your posts reached ${t.post_impression.value} impressions ${period}, with ${o.engagement.likes} likes, ${o.engagement.comments} comments and ${o.engagement.reposts} reposts.`;
    table = (o.topPosts as Row[]).map((p) => ({ post: p.body, reach: p.reach, likes: p.like_count }));
  } else if (/view|visit|traffic/.test(q)) {
    answer = `Profile views ${period}: ${t.profile_view.value} (${pct(t.profile_view.value, t.profile_view.previous)}). Product views: ${t.product_view.value}.`;
  } else {
    answer = insights(o).join(' ');
  }
  res.json({ answer, table });
});
