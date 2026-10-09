// Background event handlers — the "smart notification engine" (spec §12, §20, §21).
// Audiences are computed from follows + interests + location + saved items + profile match,
// so announcements and vacancies reach the people they are relevant to instead of everyone.
import { all, get, run } from '../db/index.ts';
import { on } from '../lib/queue.ts';
import { config } from '../config.ts';
import { notify } from './notify.ts';
import { track } from './analytics.ts';
import { loadCandidates, scoreMatch } from './matching.ts';
import { staffCan } from '../lib/permissions.ts';

const LOCAL_KINDS = new Set(['store_opening', 'service_interruption', 'event', 'promotion']);

const ANNOUNCEMENT_LABEL: Record<string, string> = {
  price_increase: 'PRICE UPDATE', price_decrease: 'PRICE DROP', new_product: 'NEW PRODUCT',
  product_discontinued: 'DISCONTINUED', new_service: 'NEW SERVICE', store_opening: 'STORE OPENING',
  service_interruption: 'SERVICE NOTICE', hiring: 'HIRING', promotion: 'PROMOTION', event: 'EVENT',
};

export function registerEventHandlers() {
  on('job.published', ({ jobId }: { jobId: number }) => {
    const job = get("SELECT j.*, b.name AS company_name FROM jobs j JOIN businesses b ON b.user_id = j.company_id WHERE j.id = ? AND j.status = 'open'", jobId);
    if (!job) return;
    const matches = loadCandidates()
      .filter((c) => c.userId !== job.company_id)
      .map((c) => ({ id: c.userId, score: scoreMatch(job, c).score }))
      .filter((m) => m.score >= config.jobNotifyThreshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2000);
    notify(matches.map((m) => m.id), {
      type: 'job_match',
      title: 'A new opportunity matching your professional profile is available',
      body: `${job.title} at ${job.company_name}${job.city ? ` · ${job.city}` : ''}`,
      link: `/jobs/${job.id}`,
      actorId: job.company_id,
    });
    // Followers who were not already matched hear that the company is hiring.
    const matched = new Set(matches.map((m) => m.id));
    const followers = all("SELECT f.follower_id FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.followee_id = ? AND u.account_type = 'personal'", job.company_id)
      .map((r) => r.follower_id as number)
      .filter((id) => !matched.has(id));
    notify(followers, { type: 'hiring', title: `${job.company_name} is hiring`, body: job.title, link: `/jobs/${job.id}`, actorId: job.company_id });
  });

  on('announcement.published', ({ announcementId }: { announcementId: number }) => {
    const a = get(
      `SELECT a.*, b.name AS business_name, b.category, u.city, u.country FROM announcements a
       JOIN businesses b ON b.user_id = a.business_id JOIN users u ON u.id = a.business_id WHERE a.id = ?`,
      announcementId,
    );
    if (!a) return;
    const audience = new Set<number>();
    for (const r of all('SELECT follower_id FROM follows WHERE followee_id = ?', a.business_id)) audience.add(r.follower_id);
    if (a.product_id) {
      for (const r of all("SELECT user_id FROM saves WHERE target_type = 'product' AND target_id = ?", a.product_id)) audience.add(r.user_id);
      for (const r of all('SELECT user_id FROM cart_items WHERE product_id = ?', a.product_id)) audience.add(r.user_id);
    }
    // Interested users nearby: local kinds stay in-city; other kinds reach the same country.
    const interested = LOCAL_KINDS.has(a.kind)
      ? all("SELECT i.user_id FROM user_interests i JOIN users u ON u.id = i.user_id WHERE i.slug = ? AND u.city = ? AND u.status = 'active' LIMIT 5000", a.category, a.city)
      : all("SELECT i.user_id FROM user_interests i JOIN users u ON u.id = i.user_id WHERE i.slug = ? AND (u.country = ? OR ? IS NULL) AND u.status = 'active' LIMIT 5000", a.category, a.country, a.country);
    for (const r of interested) audience.add(r.user_id);

    notify([...audience], {
      type: 'announcement',
      title: `${ANNOUNCEMENT_LABEL[a.kind] ?? 'UPDATE'} · ${a.business_name}`,
      body: a.title,
      link: a.post_id ? `/posts/${a.post_id}` : `/u/${a.business_id}`,
      actorId: a.business_id,
    });
  });

  on('product.created', ({ productId }: { productId: number }) => {
    const p = get('SELECT p.*, b.name AS seller_name FROM products p JOIN businesses b ON b.user_id = p.seller_id WHERE p.id = ?', productId);
    if (!p) return;
    const followers = all('SELECT follower_id FROM follows WHERE followee_id = ?', p.seller_id).map((r) => r.follower_id as number);
    notify(followers, { type: 'new_product', title: `New from ${p.seller_name}`, body: p.name, link: `/marketplace/${p.id}`, actorId: p.seller_id });
  });

  on('post.created', ({ postId, mentions }: { postId: number; mentions: number[] }) => {
    const p = get('SELECT p.*, u.display_name FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?', postId);
    if (!p || !mentions?.length) return;
    notify(mentions, { type: 'mention', title: `${p.display_name} mentioned you`, body: p.body.slice(0, 140), link: `/posts/${p.id}`, actorId: p.author_id });
  });

  on('feed.impressions', ({ viewerId, posts }: { viewerId: number | null; posts: { id: number; author: number }[] }) => {
    track(posts.map((p) => ({ ownerId: p.author, actorId: viewerId, type: 'post_impression', targetType: 'post', targetId: p.id })));
  });

  on('search.appearances', ({ viewerId, owners, query }: { viewerId: number | null; owners: number[]; query: string }) => {
    track([...new Set(owners)].map((o) => ({ ownerId: o, actorId: viewerId, type: 'search_appearance', source: query })));
  });

  on('report.created', ({ targetType, targetId }: { targetType: string; targetId: number }) => {
    const open = get("SELECT COUNT(DISTINCT reporter_id) AS n FROM reports WHERE target_type = ? AND target_id = ? AND status = 'open'", targetType, targetId);
    if ((open?.n ?? 0) < 3) return;
    // Auto-hide content that several distinct people reported, pending moderator review.
    const table: Record<string, string> = { post: 'posts', comment: 'comments', product: 'products', job: 'jobs' };
    const t = table[targetType];
    if (t) run(`UPDATE ${t} SET status = 'flagged' WHERE id = ? AND status = ?`, targetId, t === 'jobs' ? 'open' : 'active');
    const mods = all("SELECT id, role FROM users WHERE role != 'user' AND status = 'active'")
      .filter((u) => staffCan(u.role, 'reports'))
      .map((u) => u.id as number);
    notify(mods, { type: 'moderation', title: `Content auto-flagged after ${open!.n} reports`, body: `${targetType} #${targetId}`, link: '/admin/reports' });
  });

  on('application.submitted', ({ applicationId }: { applicationId: number }) => {
    const a = get(
      `SELECT a.*, j.title, j.company_id, u.display_name FROM applications a JOIN jobs j ON j.id = a.job_id
       JOIN users u ON u.id = a.applicant_id WHERE a.id = ?`,
      applicationId,
    );
    if (!a) return;
    notify([a.company_id], {
      type: 'application',
      title: `New application for ${a.title}`,
      body: `${a.display_name} applied${a.match_score != null ? ` · ${a.match_score}% match` : ''}`,
      link: `/dashboard/recruitment/applications/${a.id}`,
      actorId: a.applicant_id,
    });
  });

  on('order.updated', ({ orderId, status, actorId }: { orderId: number; status: string; actorId: number }) => {
    const o = get('SELECT * FROM orders WHERE id = ?', orderId);
    if (!o) return;
    const toSeller = actorId === o.buyer_id;
    const items = all('SELECT name FROM order_items WHERE order_id = ?', orderId).map((r) => r.name);
    notify([toSeller ? o.seller_id : o.buyer_id], {
      type: 'order',
      title: status === 'pending' ? `New order #${o.id}` : `Order #${o.id} is ${status}`,
      body: items.slice(0, 3).join(', ') + (items.length > 3 ? '…' : ''),
      link: `/orders/${o.id}`,
      actorId,
    });
  });
}
