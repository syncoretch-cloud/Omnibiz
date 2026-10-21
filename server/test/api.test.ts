// End-to-end API tests against a throwaway database. Run with `npm test`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnibiz-test-'));
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = dir;
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.OMNIBIZ_DISABLE_RATE_LIMIT = '1';

const { createApp } = await import('../src/app.ts');
const { settle } = await import('../src/lib/queue.ts');
const { all, db } = await import('../src/db/index.ts');
const { totp } = await import('../src/lib/totp.ts');

let server: Server;
let base = '';

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});
after(() => {
  server.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

class Client {
  cookie = '';
  async req(method: string, url: string, body?: unknown, opts: { csrf?: boolean; form?: FormData } = {}): Promise<{ status: number; body: Json }> {
    const headers: Record<string, string> = {};
    if (opts.csrf !== false) headers['x-omnibiz'] = '1';
    if (this.cookie) headers.cookie = this.cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(base + url, { method, headers, body: opts.form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const text = await res.text();
    let parsed: Json = text;
    try { parsed = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body: parsed };
  }
  get = (u: string) => this.req('GET', u);
  post = (u: string, b?: unknown) => this.req('POST', u, b ?? {});
  patch = (u: string, b: unknown) => this.req('PATCH', u, b);
  del = (u: string, b?: unknown) => this.req('DELETE', u, b);
}

let n = 0;
async function register(type: string, extra: Record<string, unknown> = {}) {
  const c = new Client();
  n++;
  const isBiz = ['company', 'wholesaler', 'retailer'].includes(type);
  const r = await c.post('/api/auth/register', {
    account_type: type,
    username: `${type}${n}`,
    email: `${type}${n}@example.com`,
    phone: `+2557110000${String(n).padStart(2, '0')}`,
    password: 'Secret123',
    city: 'Arusha',
    ...(isBiz ? { business_name: `${type} biz ${n}`, category: 'software' } : { full_name: `${type} person ${n}` }),
    ...extra,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { c, me: r.body.user };
}

function latestCode(recipient: string): string {
  const row = all('SELECT body FROM outbox WHERE recipient = ? ORDER BY id DESC LIMIT 1', recipient)[0];
  return /(\d{6})/.exec(row.body)![1];
}

test('registration, verification, login, lockout and recovery', async () => {
  const { c, me } = await register('personal');
  assert.equal(me.email_verified, false);
  // Sign-up no longer sends codes (verification is switched off), but users can still verify on request.
  await c.post('/api/auth/verify/send', { channel: 'email' });
  const v = await c.post('/api/auth/verify/confirm', { channel: 'email', code: latestCode(me.email) });
  assert.equal(v.status, 200);
  assert.equal(v.body.user.email_verified, true);

  const dup = await new Client().post('/api/auth/register', { account_type: 'personal', username: me.username, email: 'x@example.com', phone: '+255799999999', password: 'Secret123', full_name: 'X' });
  assert.equal(dup.status, 409);

  const weak = await new Client().post('/api/auth/register', { account_type: 'customer', username: 'weakpw', email: 'w@example.com', phone: '+255799999998', password: 'short', full_name: 'W' });
  assert.equal(weak.status, 400);

  const anon = new Client();
  for (let i = 0; i < 5; i++) assert.equal((await anon.post('/api/auth/login', { identifier: me.username, password: 'wrong-password1' })).status, 401);
  const locked = await anon.post('/api/auth/login', { identifier: me.username, password: 'Secret123' });
  assert.equal(locked.status, 429, 'account locks after 5 failures');

  await anon.post('/api/auth/recover/request', { identifier: me.email });
  const reset = await anon.post('/api/auth/recover/reset', { identifier: me.email, code: latestCode(me.email), password: 'NewSecret456' });
  assert.equal(reset.status, 200);
  const ok = await anon.post('/api/auth/login', { identifier: me.email, password: 'NewSecret456' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.username, me.username);
  // Old session was revoked by the password reset.
  assert.equal((await c.get('/api/auth/sessions')).status, 401);
});

test('CSRF header is required for state-changing requests', async () => {
  const c = new Client();
  const r = await c.req('POST', '/api/auth/login', { identifier: 'x', password: 'y' }, { csrf: false });
  assert.equal(r.status, 403);
});

test('two-factor authentication', async () => {
  const { c, me } = await register('customer');
  const setup = await c.post('/api/auth/2fa/setup');
  assert.equal(setup.status, 200);
  const enable = await c.post('/api/auth/2fa/enable', { code: totp(setup.body.secret) });
  assert.equal(enable.status, 200);
  const anon = new Client();
  const step1 = await anon.post('/api/auth/login', { identifier: me.username, password: 'Secret123' });
  assert.equal(step1.body.twofa_required, true);
  assert.equal((await anon.post('/api/auth/login/2fa', { challenge: step1.body.challenge, code: '000000' })).status, 401);
  const step2 = await anon.post('/api/auth/login/2fa', { challenge: step1.body.challenge, code: totp(setup.body.secret) });
  assert.equal(step2.status, 200);
  assert.equal(step2.body.user.id, me.id);
});

test('permissions follow account type', async () => {
  const { c: customer } = await register('customer');
  const { c: personal } = await register('personal');
  assert.equal((await customer.post('/api/posts', { body: 'hello' })).status, 403);
  assert.equal((await personal.post('/api/jobs', { title: 'Dev', employment_type: 'full_time', description: 'x'.repeat(30) })).status, 403);
  assert.equal((await personal.post('/api/products', { name: 'Thing', category: 'electronics', price: 10 })).status, 403);
  assert.equal((await customer.get('/api/admin/stats')).status, 403);
});

test('jobs: matching notifications, application flow and recruitment pipeline', async () => {
  const { c: seeker, me: seekerMe } = await register('personal');
  await seeker.patch('/api/users/me/profile', { preferred_industries: ['software'], preferred_locations: ['Arusha'] });
  for (const s of ['React', 'Node.js', 'PostgreSQL']) await seeker.post('/api/users/me/cv', { section: 'skill', data: { name: s } });
  await seeker.post('/api/users/me/cv', { section: 'education', data: { school: 'UDSM', program: 'Computer Science', level: 'bachelor' } });
  const { c: unrelated, me: unrelatedMe } = await register('personal');
  await unrelated.post('/api/users/me/cv', { section: 'skill', data: { name: 'Cooking' } });
  await unrelated.patch('/api/users/me', { city: 'Mwanza' });

  const { c: company } = await register('company');
  const job = await company.post('/api/jobs', {
    title: 'React Developer', employment_type: 'full_time', city: 'Arusha', industry: 'software',
    description: 'Build great React applications for our clients across East Africa.',
    skills: ['React', 'Node.js', 'PostgreSQL'], education_req: 'diploma', required_docs: ['cv'], deadline: '2099-01-01',
  });
  assert.equal(job.status, 201, JSON.stringify(job.body));
  await settle();

  const notes = (await seeker.get('/api/notifications')).body.items;
  assert.ok(notes.some((x: Json) => x.type === 'job_match' && x.link === `/jobs/${job.body.job.id}`), 'matching seeker is notified');
  const otherNotes = (await unrelated.get('/api/notifications')).body.items;
  assert.ok(!otherNotes.some((x: Json) => x.type === 'job_match'), 'non-matching user is not notified');
  void unrelatedMe;

  const detail = await seeker.get(`/api/jobs/${job.body.job.id}`);
  assert.ok(detail.body.match.score >= 80, `match score ${detail.body.match.score}`);
  const rec = await seeker.get('/api/jobs/recommended');
  assert.equal(rec.body.items[0].id, job.body.job.id);

  const missing = await seeker.post(`/api/jobs/${job.body.job.id}/apply`, {});
  assert.equal(missing.status, 400);
  assert.deepEqual(missing.body.details.missing, ['cv']);

  const form = new FormData();
  form.append('kind', 'cv');
  form.append('file', new Blob(['%PDF-1.4 test cv'], { type: 'application/pdf' }), 'cv.pdf');
  const up = await seeker.req('POST', '/api/documents', undefined, { form });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const docId = up.body.document.id;

  // A stranger cannot read the private CV.
  const { c: stranger } = await register('company');
  assert.equal((await stranger.get(`/api/documents/${docId}/file`)).status, 403);

  const applied = await seeker.post(`/api/jobs/${job.body.job.id}/apply`, { document_ids: [docId], source: 'recommended' });
  assert.equal(applied.status, 201, JSON.stringify(applied.body));
  assert.equal((await seeker.post(`/api/jobs/${job.body.job.id}/apply`, { document_ids: [docId] })).status, 409);
  await settle();

  const list = await company.get(`/api/recruitment/jobs/${job.body.job.id}/applications`);
  assert.equal(list.body.applications.length, 1);
  const appId = list.body.applications[0].id;
  const appDetail = await company.get(`/api/recruitment/applications/${appId}`);
  assert.equal(appDetail.body.applicant.id, seekerMe.id);
  assert.equal(appDetail.body.application.stage, 'reviewing', 'opening an application moves it to reviewing');
  // The company can now read the attached CV.
  assert.equal((await company.get(`/api/documents/${docId}/file`)).status, 200);

  assert.equal((await company.patch(`/api/recruitment/applications/${appId}`, { stage: 'shortlisted' })).status, 200);
  const applicantNotes = (await seeker.get('/api/notifications')).body.items;
  assert.ok(applicantNotes.some((x: Json) => x.type === 'application_update' && /shortlisted/.test(x.title)));
  const mine = await seeker.get('/api/jobs/applied');
  assert.equal(mine.body.items[0].application.stage, 'shortlisted');
});

test('marketplace: wholesale MOQ, checkout, fulfilment and review', async () => {
  const { c: seller, me: sellerMe } = await register('wholesaler', { category: 'wholesale' });
  const p = await seller.post('/api/products', { name: 'Solar Panel 300W', category: 'solar-energy', price: 250000, min_order_qty: 20, quantity: 100, sale_type: 'wholesale' });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  const pid = p.body.product.id;

  const { c: buyer } = await register('retailer', { category: 'retail' });
  const cart = await buyer.post('/api/cart', { product_id: pid, qty: 5 });
  assert.equal(cart.body.groups[0].items[0].qty, 20, 'quantity is raised to the minimum order');
  const co = await buyer.post('/api/orders/checkout', { payment_method: 'mobile_money', delivery_address: 'Sokoine Road, Arusha', delivery_phone: '+255711111111' });
  assert.equal(co.status, 201, JSON.stringify(co.body));
  const orderId = co.body.order_ids[0];
  assert.equal((await seller.get(`/api/products/${pid}`)).body.product.quantity, 80, 'stock decremented');

  assert.equal((await buyer.post(`/api/orders/${orderId}/status`, { status: 'shipped' })).status, 400, 'buyer cannot ship');
  for (const s of ['confirmed', 'shipped']) assert.equal((await seller.post(`/api/orders/${orderId}/status`, { status: s })).status, 200);
  assert.equal((await buyer.post(`/api/orders/${orderId}/status`, { status: 'delivered' })).status, 200);
  assert.equal((await buyer.post(`/api/orders/${orderId}/reviews`, { product_id: pid, rating: 5, body: 'Great' })).status, 201);
  const prof = await buyer.get(`/api/users/${sellerMe.username}`);
  assert.equal(prof.body.rating.avg, 5);
});

test('business announcements reach followers and savers', async () => {
  const { c: biz, me: bizMe } = await register('retailer', { category: 'retail' });
  const p = await biz.post('/api/products', { name: 'Cooking Oil 20L', category: 'food', price: 82000 });
  const { c: follower } = await register('customer');
  await follower.post(`/api/users/${bizMe.id}/follow`);
  const { c: saver } = await register('customer');
  await saver.post('/api/saves', { target_type: 'product', target_id: p.body.product.id });
  const { c: bystander } = await register('customer');
  const a = await biz.post('/api/announcements', { kind: 'price_increase', title: 'Oil price update', product_id: p.body.product.id, new_price: 88000, effective_date: '2026-11-15' });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  await settle();
  for (const c of [follower, saver]) {
    const items = (await c.get('/api/notifications')).body.items;
    assert.ok(items.some((x: Json) => x.type === 'announcement' && /PRICE UPDATE/.test(x.title)));
  }
  assert.ok(!(await bystander.get('/api/notifications')).body.items.some((x: Json) => x.type === 'announcement'));
  const post = await follower.get(`/api/posts/${a.body.post_id}`);
  assert.match(post.body.post.body, /82,000 → TZS 88,000/);
});

test('feed ranks followed and relevant content, search understands natural language', async () => {
  const { c: company, me: companyMe } = await register('company', { business_name: 'Arusha Code Works', category: 'software' });
  await company.post('/api/jobs', { title: 'Junior Software Developer', employment_type: 'full_time', city: 'Arusha', description: 'Entry level software developer role, training provided.', skills: ['JavaScript'], experience_years: 0 });
  await company.post('/api/posts', { body: 'We build #software for East Africa' });
  const { c: user } = await register('personal');
  await user.post(`/api/users/${companyMe.id}/follow`);
  const feed = await user.get('/api/posts/feed');
  assert.ok(feed.body.items.length > 0);
  const top = feed.body.items[0];
  assert.equal(top.author.id, companyMe.id);
  assert.match(top.reason ?? '', /follow/i);

  const s = await user.get('/api/search?q=' + encodeURIComponent('Find software companies around Arusha hiring junior developers'));
  assert.equal(s.body.interpreted.city, 'Arusha');
  assert.ok(s.body.interpreted.types.includes('jobs') && s.body.interpreted.types.includes('companies'));
  assert.ok(s.body.results.jobs.some((j: Json) => j.title === 'Junior Software Developer'));
  assert.ok(s.body.results.businesses.some((b: Json) => b.id === companyMe.id));
});

test('reports auto-flag content and moderators resolve them', async () => {
  const { c: author } = await register('retailer', { category: 'retail' });
  const post = await author.post('/api/posts', { body: 'Totally legit offer, send money first!' });
  const pid = post.body.post.id;
  for (let i = 0; i < 3; i++) {
    const { c } = await register('customer');
    assert.equal((await c.post('/api/reports', { target_type: 'post', target_id: pid, reason: 'scam_or_fraud' })).status, 201);
  }
  await settle();
  const { c: viewer } = await register('customer');
  assert.equal((await viewer.get(`/api/posts/${pid}`)).status, 404, 'flagged post is hidden');

  const { c: mod, me: modMe } = await register('personal');
  db.prepare("UPDATE users SET role = 'moderator' WHERE id = ?").run(modMe.id);
  const queue = await mod.get('/api/admin/reports');
  assert.ok(queue.body.items.some((r: Json) => r.target_id === pid && r.count === 3));
  assert.equal((await mod.post('/api/admin/reports/resolve', { target_type: 'post', target_id: pid, decision: 'remove_content' })).status, 200);
  assert.equal((await mod.post('/api/admin/categories', { scope: 'industry', name: 'Space' })).status, 403, 'moderators cannot manage categories');
});

test('messaging and business inquiry analytics', async () => {
  const { c: biz, me: bizMe } = await register('company');
  const { c: cust } = await register('customer');
  const start = await cust.post('/api/messages/start', { user_id: bizMe.id, body: 'Hello, do you deliver?' });
  assert.equal(start.status, 201);
  const convs = await biz.get('/api/messages/conversations');
  assert.equal(convs.body.conversations[0].unread, 1);
  const reply = await biz.post(`/api/messages/conversations/${start.body.conversation_id}/messages`, { body: 'Yes!' });
  assert.equal(reply.status, 201);
  const overview = await biz.get('/api/analytics/overview');
  assert.equal(overview.body.totals.inquiry.value, 1);
  const ask = await biz.post('/api/analytics/ask', { question: 'Show me my best-performing products this month' });
  assert.equal(ask.status, 200);
  assert.ok(ask.body.answer);
});

test('reels mix posts, products and jobs', async () => {
  const { c: biz, me: bizMe } = await register('company', { business_name: 'Reel Co', category: 'software' });
  await biz.post('/api/posts', { body: 'Behind the scenes at #reelco' });
  await biz.post('/api/posts', { body: 'Second update from Reel Co' });
  const prod = await biz.post('/api/products', { name: 'Reel Widget', category: 'electronics', price: 1000 });
  await biz.post('/api/jobs', { title: 'Reel Engineer', employment_type: 'full_time', description: 'Build reels for East African businesses.', skills: ['React'] });
  const { c: user } = await register('personal');
  await user.post(`/api/users/${bizMe.id}/follow`);

  const reels = await user.get('/api/reels');
  assert.equal(reels.status, 200);
  const types = new Set(reels.body.items.map((i: Json) => i.type));
  assert.ok(types.has('post') && types.has('product') && types.has('job'), [...types].join(','));

  const started = await user.get(`/api/reels?start=product:${prod.body.product.id}`);
  assert.equal(started.body.items[0].key, `product:${prod.body.product.id}`);

});

test('post details: music, tagged people, location, alt text, hidden likes and comments off', async () => {
  const { c: author } = await register('company', { business_name: 'Studio Co', category: 'software' });
  const { c: friend, me: friendMe } = await register('personal');
  const upload = async (bytes: number[], type: string, name: string) => {
    const form = new FormData();
    form.append('files', new Blob([new Uint8Array(bytes)], { type }), name);
    const r = await author.req('POST', '/api/media', undefined, { form });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.files[0].url as string;
  };
  const image = await upload([0x89, 0x50, 0x4e, 0x47], 'image/png', 'photo.png');
  const song = await upload([0x49, 0x44, 0x33, 0x03], 'audio/mpeg', 'jingle.mp3');
  assert.match(song, /^\/uploads\/media\/[a-f0-9]{32}\.mp3$/);

  const created = await author.post('/api/posts', {
    body: 'New studio, new sound',
    media: [image],
    data: {
      aspect: '4:5', alt: ['A sunlit recording room'], location: 'Arusha', injected: 'nope',
      music: { url: song, title: 'Studio jingle', artist: 'Studio Co', start: 12 },
      tagged: [friendMe.id, 999999], hide_likes: true, comments_off: true,
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const p = created.body.post;
  assert.deepEqual([p.data.aspect, p.data.alt[0], p.data.location], ['4:5', 'A sunlit recording room', 'Arusha']);
  assert.deepEqual([p.data.music.url, p.data.music.start], [song, 12]);
  assert.equal(p.data.injected, undefined);
  assert.deepEqual(p.data.tagged, [friendMe.id], 'unknown users are dropped');
  assert.equal(p.tagged[0].username, friendMe.username);

  const library = await author.post('/api/posts', { body: 'Morning mood', data: { music: { track: 'kariakoo-morning', title: 'Kariakoo Morning', artist: 'OmniBiz Sounds' } } });
  assert.equal(library.body.post.data.music.track, 'kariakoo-morning');
  const forged = await author.post('/api/posts', { body: 'Sneaky sound', data: { music: { url: 'https://evil.example/x.mp3', title: 'x' } } });
  assert.equal(forged.body.post.data.music, undefined, 'only uploaded audio or library tracks are kept');

  await settle();
  const notes = (await friend.get('/api/notifications')).body.items;
  assert.ok(notes.some((n: Json) => /tagged you/.test(n.title)), 'tagged people are notified');

  const liked = await friend.post(`/api/posts/${p.id}/like`);
  assert.equal(liked.body.like_count, null, 'hidden like counts stay hidden from others');
  assert.equal((await friend.get(`/api/posts/${p.id}`)).body.post.like_count, null);
  assert.equal((await author.get(`/api/posts/${p.id}`)).body.post.like_count, 1, 'the author still sees the count');

  assert.equal((await friend.post(`/api/posts/${p.id}/comments`, { body: 'Nice!' })).status, 403);
  assert.equal((await author.post(`/api/posts/${p.id}/comments`, { body: 'Thanks all' })).status, 201);
});

test('stories: share, followed accounts first, seen state, viewers, gone after 24 hours', async () => {
  const { c: biz, me: bizMe } = await register('company', { business_name: 'Story Co', category: 'software' });
  const { c: viewer, me: viewerMe } = await register('personal');
  const { c: customer } = await register('customer');
  assert.equal((await biz.post('/api/stories', {})).status, 400, 'an empty story is rejected');
  assert.equal((await biz.post('/api/stories', { media: 'https://evil.example/x.jpg' })).status, 400, 'media must be uploaded first');
  assert.equal((await customer.post('/api/stories', { body: 'hi' })).status, 403, 'customer accounts cannot post');
  assert.equal((await biz.post('/api/stories', { body: 'Open today until 8pm', bg: 'sunset' })).status, 201);
  const second = await biz.post('/api/stories', { body: 'New arrivals', music: { track: 'kariakoo-morning', title: 'Kariakoo Morning', artist: 'OmniBiz Sounds' } });
  assert.equal(second.body.story.music.track, 'kariakoo-morning');

  await viewer.post(`/api/users/${bizMe.id}/follow`);
  let group = (await viewer.get('/api/stories')).body.stories.find((g: Json) => g.user.id === bizMe.id);
  assert.ok(group && !group.suggested && group.items.length === 2 && !group.all_seen);
  assert.ok(group.items[0].id < group.items[1].id, 'items play oldest → newest');
  for (const it of group.items) await viewer.post(`/api/stories/${it.id}/view`);
  group = (await viewer.get('/api/stories')).body.stories.find((g: Json) => g.user.id === bizMe.id);
  assert.ok(group.all_seen, 'seen state is remembered on the server');

  const own = (await biz.get(`/api/stories/user/${bizMe.id}`)).body.story;
  assert.equal(own.items[0].view_count, 1);
  assert.equal((await biz.get(`/api/stories/${own.items[0].id}/viewers`)).body.viewers[0].id, viewerMe.id);
  assert.equal((await viewer.get(`/api/stories/${own.items[0].id}/viewers`)).status, 403, 'only the author sees who viewed');

  db.prepare("UPDATE stories SET expires_at = datetime('now', '-1 minute') WHERE author_id = ?").run(bizMe.id);
  assert.equal((await viewer.get(`/api/stories/user/${bizMe.id}`)).body.story, null, 'stories disappear after 24 hours');
});

test('unfinished applications: skip a requirement, save, finish later, then send to the company', async () => {
  const { c: company } = await register('company', { business_name: 'Draft Co', category: 'software' });
  const job = (await company.post('/api/jobs', {
    title: 'Data Analyst', employment_type: 'full_time', description: 'Analyse sales data for retailers across East Africa.',
    skills: ['SQL'], required_docs: ['cv', 'cover_letter'],
  })).body.job;
  const { c: seeker } = await register('personal');

  // No CV yet: the form is saved with what is done, and it says what is still missing.
  const cover = 'I have three years of experience analysing retail sales data with SQL and spreadsheets.';
  const saved = await seeker.req('PUT', `/api/jobs/${job.id}/draft`, { cover_letter: cover, step: 3 });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(saved.body.draft.missing, ['cv']);
  assert.equal((await seeker.get(`/api/jobs/${job.id}`)).body.draft.step, 3, 'it reopens where they stopped');
  assert.equal((await seeker.get('/api/jobs/drafts')).body.items[0].job.id, job.id);
  assert.equal(all('SELECT id FROM applications WHERE job_id = ?', job.id).length, 0, 'the company sees nothing yet');
  assert.equal((await seeker.post(`/api/jobs/${job.id}/apply`, { cover_letter: cover })).status, 400, 'an incomplete application cannot be sent');

  // Later: upload the CV, finish and send.
  const form = new FormData();
  form.append('kind', 'cv');
  form.append('file', new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' }), 'cv.pdf');
  const doc = (await seeker.req('POST', '/api/documents', undefined, { form })).body.document;
  const done = await seeker.req('PUT', `/api/jobs/${job.id}/draft`, { cover_letter: cover, document_ids: [doc.id], step: 4 });
  assert.deepEqual(done.body.draft.missing, []);
  const sent = await seeker.post(`/api/jobs/${job.id}/apply`, { cover_letter: cover, document_ids: [doc.id] });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal((await seeker.get('/api/jobs/drafts')).body.items.length, 0, 'sending clears the draft');
  assert.equal(all('SELECT stage FROM applications WHERE job_id = ?', job.id)[0].stage, 'applied', 'the company receives it');
  assert.equal((await seeker.req('PUT', `/api/jobs/${job.id}/draft`, { step: 1 })).status, 409, 'no new draft after applying');
});

test('sessions are browser-only unless "keep me logged in" is chosen', async () => {
  const { me } = await register('customer');
  const raw = async (remember: boolean) => {
    const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'x-omnibiz': '1', 'content-type': 'application/json' }, body: JSON.stringify({ identifier: me.username, password: 'Secret123', remember }) });
    return res.headers.get('set-cookie') ?? '';
  };
  assert.doesNotMatch(await raw(false), /Max-Age/i);
  assert.match(await raw(true), /Max-Age=2592000/i);
});
