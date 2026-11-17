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
// Real mail and SMS credentials (server/.env) must never be used by tests; they use injected senders instead.
process.env.SMTP_HOST = '';
process.env.SMS_PROVIDER = '';

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
  put = (u: string, b: unknown) => this.req('PUT', u, b);
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

test('explore mixes posts, products and jobs', async () => {
  const { c: biz, me: bizMe } = await register('company', { business_name: 'Explore Co', category: 'software' });
  await biz.post('/api/posts', { body: 'Behind the scenes at #exploreco' });
  await biz.post('/api/posts', { body: 'Second update from Explore Co' });
  await biz.post('/api/products', { name: 'Explore Widget', category: 'electronics', price: 1000 });
  await biz.post('/api/jobs', { title: 'Explore Engineer', employment_type: 'full_time', description: 'Build discovery for East African businesses.', skills: ['React'] });
  const { c: user } = await register('personal');
  await user.post(`/api/users/${bizMe.id}/follow`);

  const explore = await user.get('/api/explore');
  assert.equal(explore.status, 200);
  const types = new Set(explore.body.items.map((i: Json) => i.type));
  assert.ok(types.has('post') && types.has('product') && types.has('job'), [...types].join(','));
});

test('market ads: posts can be listed by several kinds at once', async () => {
  const { c: biz } = await register('company', { business_name: 'Ad Co', category: 'software' });
  const promo = await biz.post('/api/posts', { kind: 'promotion', body: 'Ten percent off all licences this week' });
  const offer = await biz.post('/api/posts', { kind: 'offer', body: 'Free setup for new customers' });
  await biz.post('/api/posts', { kind: 'news', body: 'We moved offices' });
  const { c: user } = await register('personal');
  const ads = await user.get('/api/posts?kind=promotion,offer');
  assert.equal(ads.status, 200);
  const ids = ads.body.items.map((p: Json) => p.id);
  assert.ok(ids.includes(promo.body.post.id) && ids.includes(offer.body.post.id));
  assert.ok(ads.body.items.every((p: Json) => ['promotion', 'offer'].includes(p.kind)));
});

test('settings: profile picture, removing it, and a saved delivery address', async () => {
  const { c: shopper } = await register('customer');
  const form = new FormData();
  form.append('files', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], { type: 'image/png' }), 'me.png');
  const up = await shopper.req('POST', '/api/media', undefined, { form });
  assert.equal(up.status, 201);
  const url = up.body.files[0].url;
  const set = await shopper.patch('/api/users/me', { avatar_url: url, delivery_address: 'Plot 12, Sinza, Dar es Salaam' });
  assert.equal(set.status, 200);
  assert.equal(set.body.user.avatar_url, url);
  assert.equal(set.body.user.delivery_address, 'Plot 12, Sinza, Dar es Salaam');
  const cleared = await shopper.patch('/api/users/me', { avatar_url: '' });
  assert.equal(cleared.status, 200);
  assert.ok(!cleared.body.user.avatar_url);
  assert.equal(cleared.body.user.delivery_address, 'Plot 12, Sinza, Dar es Salaam');
  const bad = await shopper.patch('/api/users/me', { avatar_url: 'http://evil.example/x.png' });
  assert.equal(bad.status, 400);
});

test('contact details and links are optional, public, and cleaned', async () => {
  const { c: person, me } = await register('personal');
  const { c: other } = await register('customer');
  const set = await person.patch('/api/users/me', { public_email: 'hello@me.dev', public_phone: '+255 712 345 678', links: ['linkedin.com/in/me', 'https://github.com/me', 'github.com/me', ''] });
  assert.equal(set.status, 200);
  assert.deepEqual(set.body.user.links, ['https://linkedin.com/in/me', 'https://github.com/me']);
  assert.equal(set.body.user.public_phone, '+255712345678');
  const seen = await other.get(`/api/users/${me.username}`);
  assert.equal(seen.body.user.public_email, 'hello@me.dev');
  assert.equal(seen.body.user.links.length, 2);
  assert.ok(!('email' in seen.body.user), 'the sign-in email stays private');
  assert.equal((await person.patch('/api/users/me', { links: ['not a link'] })).status, 400);
  assert.equal((await person.patch('/api/users/me', { links: ['javascript:alert(1)'] })).status, 400);
  const cleared = await person.patch('/api/users/me', { public_email: '', public_phone: '', links: [] });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.user.public_email, null);
  assert.deepEqual(cleared.body.user.links, []);
});

test('online CV link and CV file: public ones are visible, private ones are not', async () => {
  const { c: person, me } = await register('personal');
  const { c: viewer } = await register('customer');
  await person.post('/api/users/me/cv', { section: 'portfolio', data: { title: 'My LinkedIn CV', url: 'https://linkedin.com/in/me', kind: 'cv' }, visibility: 'public' });
  await person.post('/api/users/me/cv', { section: 'portfolio', data: { title: 'Private CV', url: 'https://drive.google.com/x', kind: 'cv' }, visibility: 'private' });
  const form = new FormData();
  form.append('file', new Blob([new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF')], { type: 'application/pdf' }), 'cv.pdf');
  form.append('kind', 'cv');
  form.append('visibility', 'public');
  const up = await person.req('POST', '/api/documents', undefined, { form });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const seen = await viewer.get(`/api/users/${me.username}`);
  const links = seen.body.cv.portfolio.filter((i: Json) => i.kind === 'cv');
  assert.equal(links.length, 1);
  assert.equal(links[0].title, 'My LinkedIn CV');
  assert.ok(seen.body.documents.some((d: Json) => d.kind === 'cv' && d.name === 'cv.pdf'));
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

test('subscriptions: plans per account type, plan limits and admin edits', async () => {
  const { c: shop } = await register('retailer');
  const view = await shop.get('/api/subscriptions');
  assert.equal(view.status, 200);
  assert.equal(view.body.plan.code, 'retailer_free');
  assert.ok(view.body.plans.every((p: Json) => p.audience === 'retailer' && p.active));

  // Personal accounts get Free and Plus; every paid plan comes with monthly, 3-month and yearly payment plans.
  const { c: person } = await register('personal');
  const pv = await person.get('/api/subscriptions');
  assert.deepEqual(pv.body.plans.map((p: Json) => p.code), ['personal_free', 'personal_plus']);
  const plus = pv.body.plans.find((p: Json) => p.code === 'personal_plus');
  assert.deepEqual(plus.payment_plans.map((x: Json) => x.period), ['monthly', 'quarterly', 'yearly']);
  assert.ok(plus.payment_plans[2].total < plus.price * 12);
  assert.equal((await person.post('/api/subscriptions/subscribe', { plan_id: plus.id, period: 'yearly' })).status, 200);
  assert.equal((await person.get('/api/subscriptions')).body.subscription.period, 'yearly');

  // Free retailers are capped at 10 active products.
  const product = (i: number) => shop.post('/api/products', { name: `Item ${i}`, category: 'electronics', price: 1000, currency: 'TZS', description: 'A fine item', images: [] });
  const first = await product(0);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  for (let i = 1; i < 10; i++) assert.equal((await product(i)).status, 201);
  const capped = await product(11);
  assert.equal(capped.status, 402);

  // Moving to Pro lifts it; you can't pick another audience's plan.
  const pro = view.body.plans.find((p: Json) => p.code === 'retailer_pro');
  const wrong = (await register('company')).c;
  assert.equal((await wrong.post('/api/subscriptions/subscribe', { plan_id: pro.id })).status, 404);
  assert.equal((await shop.post('/api/subscriptions/subscribe', { plan_id: pro.id })).status, 200);
  assert.equal((await product(12)).status, 201);
  assert.equal((await shop.get('/api/subscriptions')).body.plan.code, 'retailer_pro');
  assert.equal((await shop.post('/api/subscriptions/cancel')).status, 200);
  assert.equal((await shop.get('/api/subscriptions')).body.plan.code, 'retailer_free');

  // Only staff with billing permission can edit plans.
  assert.equal((await shop.patch(`/api/admin/billing/plans/${pro.id}`, { price: 1 })).status, 403);
  const { me: staffMe, c: staff } = await register('personal');
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(staffMe.id);
  const edited = await staff.patch(`/api/admin/billing/plans/${pro.id}`, { price: 25000, limits: { products: 300 } });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.plan.price, 25000);
  assert.equal(edited.body.plan.limits.products, 300);
  assert.equal((await staff.patch(`/api/admin/billing/plans/${pro.id}`, { limits: { bogus: 1 } })).status, 400);
});

test('moderation: posts with blocked words are held for review, and a moderator can release them', async () => {
  const { c, me } = await register('personal');
  const bad = await c.post('/api/posts', { kind: 'update', body: 'Check out this total bullshit' });
  assert.equal(bad.status, 201, JSON.stringify(bad.body));
  const row = db.prepare('SELECT status FROM posts WHERE id = ?').get(bad.body.post?.id ?? bad.body.id) as { status: string };
  assert.equal(row.status, 'flagged');
  const ok = await c.post('/api/posts', { kind: 'update', body: 'A perfectly normal update about our new shop' });
  const okRow = db.prepare('SELECT status FROM posts WHERE id = ?').get(ok.body.post?.id ?? ok.body.id) as { status: string };
  assert.equal(okRow.status, 'active');

  const { me: modMe, c: mod } = await register('personal');
  db.prepare("UPDATE users SET role = 'moderator' WHERE id = ?").run(modMe.id);
  const added = await mod.post('/api/admin/moderation/terms', { term: 'Badword' });
  assert.equal(added.status, 201);
  const second = await c.post('/api/posts', { kind: 'update', body: 'this has a badword in it' });
  assert.equal((db.prepare('SELECT status FROM posts WHERE id = ?').get(second.body.post?.id ?? second.body.id) as { status: string }).status, 'flagged');
  assert.equal((await c.post('/api/admin/moderation/terms', { term: 'x' })).status, 403);
  void me;
});

test('moderation tiers: blocked words are rejected, review words are held, look-alikes and plain numbers behave', async () => {
  const { c } = await register('personal');
  const post = (body: string) => c.post('/api/posts', { kind: 'update', body });
  assert.equal((await post('Watch this porn now')).status, 400);
  assert.equal((await post('free p0rn here')).status, 400);
  assert.equal((await post('PORRRRN')).status, 400);
  const held = await post('well this is bullshit honestly');
  assert.equal(held.status, 201);
  assert.equal((db.prepare('SELECT status FROM posts WHERE id = ?').get(held.body.post?.id ?? held.body.id) as { status: string }).status, 'flagged');
  // Ordinary text and prices with digits are not caught by look-alike matching.
  assert.equal((await post('Prices from TZS 455,000 and a classic nude lipstick range at the Arusha shop')).status, 201);
  const fine = await post('Our new class starts at 5 pm. Come and learn');
  assert.equal(fine.status, 201);
  assert.equal((db.prepare('SELECT status FROM posts WHERE id = ?').get(fine.body.post?.id ?? fine.body.id) as { status: string }).status, 'active');
  // Products and bios are screened too.
  const { c: shop } = await register('retailer');
  assert.equal((await shop.post('/api/products', { name: 'hentai poster', category: 'electronics', price: 10 })).status, 400);
  assert.equal((await c.patch('/api/users/me', { bio: 'I love xxx content' })).status, 400);
});

test('verification: paid request, staff approval, badge and feed boost; staff can remove users', async () => {
  const { c: shop, me: shopMe } = await register('company');
  const st = await shop.get('/api/verification');
  assert.equal(st.status, 200);
  assert.equal(st.body.base, 25000);
  assert.deepEqual(st.body.options.map((o: Json) => [o.period, o.total]), [['monthly', 25000], ['semiannual', 135000], ['yearly', 240000]]);
  assert.equal(st.body.status, 'none');
  // Admin changes the fee.
  const { me: adminMe, c: admin } = await register('personal');
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(adminMe.id);
  assert.equal((await admin.put('/api/admin/billing/settings', { verification_fee: 40000 })).body.verification_fee, 40000);
  assert.equal((await shop.get('/api/verification')).body.options[0].total, 40000);
  // Request with an uploaded document.
  const form = new FormData();
  form.append('kind', 'business_registration'); form.append('visibility', 'private');
  form.append('file', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), 'cert.pdf');
  const doc = await shop.req('POST', '/api/documents', undefined, { form });
  assert.equal(doc.status, 201, JSON.stringify(doc.body));
  const sent = await shop.post('/api/verification', { document_ids: [doc.body.document.id] });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal(db.prepare('SELECT paid_amount FROM verification_requests WHERE id = ?').get(sent.body.id)!.paid_amount, 40000);
  assert.equal((await shop.post('/api/verification', { document_ids: [doc.body.document.id] })).status, 409);
  const approve = await admin.post(`/api/admin/verifications/${sent.body.id}`, { decision: 'approve' });
  assert.equal(approve.status, 200, JSON.stringify(approve.body));
  assert.equal((await shop.get('/api/verification')).body.verified, true);
  const prof = await shop.get(`/api/users/${shopMe.username}`);
  assert.equal(prof.body.user.verified, true);

  // A timed ban locks the account for that many days and lifts itself when they pass.
  const { me: banned, c: b } = await register('personal');
  assert.equal((await admin.post(`/api/admin/users/${banned.id}/suspend`, { reason: 'Spam', days: 3 })).status, 200);
  const until = db.prepare('SELECT suspended_until AS u FROM users WHERE id = ?').get(banned.id)!.u as string;
  assert.ok(until > new Date().toISOString().slice(0, 10));
  assert.equal((await b.get('/api/subscriptions')).status, 403, 'a banned account is refused straight away');
  assert.equal((await b.get('/api/auth/me')).body.user.status, 'suspended', 'but can still load the ban notice');
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE user_id = ? AND title LIKE 'You have been banned%'").get(banned.id), 'and is notified');
  db.prepare("UPDATE users SET suspended_until = datetime('now', '-1 minute') WHERE id = ?").run(banned.id);
  const back = await b.post('/api/auth/login', { identifier: banned.username, password: 'Secret123' });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.equal((await b.get('/api/subscriptions')).status, 200, 'the ban lifted by itself');

  // An admin can remove a user; they can no longer sign in.
  const { me: victim, c: v } = await register('personal');
  assert.equal((await shop.post(`/api/admin/users/${victim.id}/delete`, { reason: 'spam' })).status, 403);
  assert.equal((await admin.post(`/api/admin/users/${victim.id}/delete`, { reason: 'Posting explicit content repeatedly' })).status, 200);
  assert.ok(!(await v.get('/api/auth/me')).body?.user, 'their session ends');
  assert.equal((await new Client().post('/api/auth/login', { identifier: victim.username, password: 'Secret123' })).status, 401);
  assert.equal((await admin.post(`/api/admin/users/${adminMe.id}/delete`, { reason: 'self' })).status, 400);
});

test('location: countries and regions are offered, and missing ones are filled from a known city', async () => {
  const meta = await new Client().get('/api/meta');
  const tz = meta.body.countries.find((c: Json) => c.name === 'Tanzania');
  assert.equal(tz.regions.length, 31);
  assert.ok(meta.body.countries.find((c: Json) => c.name === 'Kenya').regions.includes('Nairobi'));
  assert.equal(meta.body.countries.find((c: Json) => c.name === 'Zambia').regions, null);
  // Register with only a city: country and region come from it.
  const { me } = await register('personal', { city: 'Moshi' });
  assert.equal(me.country, 'Tanzania');
  assert.equal(me.region, 'Kilimanjaro');
  // Choosing a country and region by hand is kept.
  const { me: other } = await register('personal', { country: 'Kenya', region: 'Nakuru', city: 'Naivasha' });
  assert.equal(other.country, 'Kenya');
  assert.equal(other.region, 'Nakuru');
  assert.equal(other.city, 'Naivasha');
  // Changing city in settings fills in a missing region.
  const { c } = await register('personal', { city: 'Arusha' });
  const upd = await c.patch('/api/users/me', { city: 'Mbeya', country: 'Tanzania', region: '' });
  assert.equal(upd.status, 200, JSON.stringify(upd.body));
  assert.equal(upd.body.user.region, 'Mbeya');
});

test('password recovery: the code goes by email, only to the account\'s own address', async () => {
  const { setSenders } = await import('../src/lib/outbox.ts');
  const emails: { to: string; body: string }[] = [];
  const texts: { to: string; body: string }[] = [];
  setSenders({ email: async (to, _s, body) => { emails.push({ to, body }); }, sms: async (to, body) => { texts.push({ to, body }); } });
  try {
    const { me } = await register('personal');
    const code = (s: string) => /(\d{6})/.exec(s)![1];
    const wait = () => new Promise((r) => setTimeout(r, 50));

    // By email (the default for an email address or username).
    const byEmail = await new Client().post('/api/auth/recover/request', { identifier: me.email });
    assert.equal(byEmail.status, 200);
    assert.equal(byEmail.body.channel, 'email');
    await wait();
    assert.equal(emails.at(-1)!.to, me.email);
    assert.equal(texts.length, 0);

    // A username or a phone number finds the account too, but the code always goes to its email, never by text.
    const byName = await new Client().post('/api/auth/recover/request', { identifier: me.username, channel: 'sms' });
    assert.equal(byName.body.channel, 'email');
    await wait();
    assert.equal(emails.at(-1)!.to, me.email);
    const phoneOnly = await new Client().post('/api/auth/recover/request', { identifier: me.phone });
    assert.equal(phoneOnly.body.channel, 'email');
    await wait();
    assert.equal(emails.at(-1)!.to, me.email);
    assert.equal(texts.length, 0);

    // The emailed code resets the password, and the old password stops working.
    const newest = code(emails.at(-1)!.body);
    const reset = await new Client().post('/api/auth/recover/reset', { identifier: me.username, code: newest, password: 'Fresh2026pw' });
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    assert.equal((await new Client().post('/api/auth/login', { identifier: me.username, password: 'Secret123' })).status, 401);
    assert.equal((await new Client().post('/api/auth/login', { identifier: me.username, password: 'Fresh2026pw' })).status, 200);

    // Unknown accounts get the same answer and nothing is sent.
    const before = emails.length + texts.length;
    const ghost = await new Client().post('/api/auth/recover/request', { identifier: 'nobody@example.com' });
    assert.equal(ghost.status, 200);
    await wait();
    assert.equal(emails.length + texts.length, before);

    // A failing provider is recorded on the outbox row instead of breaking the request.
    setSenders({ email: async () => { throw new Error('SMTP down'); } });
    const { me: m2 } = await register('personal');
    assert.equal((await new Client().post('/api/auth/recover/request', { identifier: m2.email })).status, 200);
    await wait();
    const row = db.prepare("SELECT status, error FROM outbox WHERE recipient = ? ORDER BY id DESC LIMIT 1").get(m2.email) as { status: string; error: string };
    assert.equal(row.status, 'failed');
    assert.match(row.error, /SMTP down/);
  } finally {
    setSenders({ email: null, sms: null });
  }
});

test('business dashboard: orders received and the customers dealt with', async () => {
  const { c: seller, me: sellerMe } = await register('retailer', { category: 'retail' });
  const p = await seller.post('/api/products', { name: 'Desk Lamp', category: 'electronics', price: 20000, quantity: 100 });
  const pid = p.body.product.id;
  const order = async (c: Client, qty: number) => {
    assert.equal((await c.post('/api/cart', { product_id: pid, qty })).status, 200);
    const r = await c.post('/api/orders/checkout', { payment_method: 'cash_on_delivery', delivery_address: 'Arusha', delivery_phone: '+255711111111' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.order_ids[0] as number;
  };
  const { c: a } = await register('customer');
  const { c: b } = await register('customer');
  const { c: chatOnly, me: chatMe } = await register('customer');
  const first = await order(a, 1);
  await order(a, 2); // the same customer again
  await order(b, 1);
  assert.equal((await chatOnly.post('/api/messages/start', { user_id: sellerMe.id, body: 'Do you deliver to Moshi?' })).status, 201);
  assert.equal((await seller.post(`/api/orders/${first}/status`, { status: 'confirmed' })).status, 200);

  const o = (await seller.get('/api/analytics/overview?days=30')).body;
  assert.equal(o.orders.total, 3);
  assert.equal(o.orders.pending, 2);
  assert.equal(o.orders.confirmed, 1);
  assert.equal(o.orders.awaiting, 2);
  assert.equal(o.customers.ordered, 2, 'two different buyers');
  assert.equal(o.customers.chatted, 1);
  assert.equal(o.customers.total, 3, 'buyers plus the person who only messaged');
  assert.equal(o.customers.repeat, 1);
  assert.equal(o.recentOrders.length, 3);
  assert.ok(o.recentOrders[0].buyer.display_name);
  assert.equal(o.followers, undefined, 'follower counts are no longer part of the dashboard');
  void chatMe;
});

async function staffClient(role = 'admin') {
  const { me, c } = await register('personal');
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, me.id);
  return { me, c };
}

test('account safety: warnings escalate to a timed ban, and a suspended person can appeal once', async () => {
  const { c: staff } = await staffClient();
  const { me: u, c: user } = await register('personal');
  const w1 = await staff.post(`/api/admin/users/${u.id}/warn`, { reason: 'Spam in comments' });
  assert.equal(w1.body.action, 'warned');
  assert.equal((await staff.post(`/api/admin/users/${u.id}/warn`, { reason: 'More spam' })).body.action, 'warned');
  const w3 = await staff.post(`/api/admin/users/${u.id}/warn`, { reason: 'Spam again' });
  assert.equal(w3.body.action, 'banned');
  assert.equal(w3.body.days, 7);
  const row = db.prepare('SELECT status, suspended_until FROM users WHERE id = ?').get(u.id) as { status: string; suspended_until: string };
  assert.equal(row.status, 'suspended');
  assert.ok(row.suspended_until);

  // Back in, the person can see why and appeal; everything else stays closed.
  assert.equal((await user.post('/api/auth/login', { identifier: u.username, password: 'Secret123' })).status, 200);
  const me = await user.get('/api/auth/me');
  assert.equal(me.body.user.status, 'suspended');
  assert.ok(me.body.user.suspended_until);
  assert.equal((await user.get('/api/subscriptions')).status, 403);
  assert.equal((await user.post('/api/appeals', { message: 'short' })).status, 400);
  assert.equal((await user.post('/api/appeals', { message: 'I was replying to a friend and did not mean to spam anyone.' })).status, 201);
  assert.equal((await user.post('/api/appeals', { message: 'I was replying to a friend and did not mean to spam anyone.' })).status, 400, 'one appeal at a time');

  const queue = await staff.get('/api/admin/appeals');
  const appeal = queue.body.items.find((a: Json) => a.user.id === u.id);
  assert.ok(appeal);
  assert.equal((await user.post(`/api/admin/appeals/${appeal.id}`, { decision: 'approve', response: 'ok' })).status, 403, 'only staff decide');
  assert.equal((await staff.post(`/api/admin/appeals/${appeal.id}`, { decision: 'approve', response: 'Restored after review.' })).status, 200);
  assert.equal((await user.get('/api/subscriptions')).status, 200);
  assert.equal((await user.post('/api/appeals', { message: 'I am not suspended any more at all.' })).status, 400);
});

test('marketplace trust: held payouts, disputes and refunds, seller reviews and the storefront', async () => {
  const { c: seller, me: sellerMe } = await register('retailer', { category: 'retail' });
  const { c: buyer } = await register('customer');
  const { c: staff } = await staffClient('moderator');
  const p = await seller.post('/api/products', { name: 'Trust Kettle', category: 'electronics', price: 30000, quantity: 20 });
  const pid = p.body.product.id;
  const buy = async () => {
    assert.equal((await buyer.post('/api/cart', { product_id: pid, qty: 1 })).status, 200);
    const r = await buyer.post('/api/orders/checkout', { payment_method: 'cash_on_delivery', delivery_address: 'Arusha', delivery_phone: '+255711111111' });
    return r.body.order_ids[0] as number;
  };
  const payout = (id: number) => (db.prepare('SELECT payout_status AS s FROM orders WHERE id = ?').get(id) as { s: string }).s;

  // The buyer's own confirmation releases the payout at once.
  const a = await buy();
  for (const s of ['confirmed', 'shipped']) assert.equal((await seller.post(`/api/orders/${a}/status`, { status: s })).status, 200);
  assert.equal(payout(a), 'held');
  assert.equal((await buyer.post(`/api/orders/${a}/status`, { status: 'delivered' })).status, 200);
  assert.equal(payout(a), 'released');
  assert.equal((await buyer.post(`/api/orders/${a}/seller-review`, { rating: 4, body: 'Quick and honest' })).status, 201);
  assert.equal((await seller.post(`/api/orders/${a}/seller-review`, { rating: 5 })).status, 403);

  // When the seller marks it delivered the payout waits, and an open dispute keeps it from releasing.
  const b = await buy();
  for (const s of ['confirmed', 'shipped', 'delivered']) assert.equal((await seller.post(`/api/orders/${b}/status`, { status: s })).status, 200);
  assert.equal(payout(b), 'held');
  assert.equal((await seller.post(`/api/orders/${b}/dispute`, { reason: 'other', details: 'I am the seller, not the buyer.' })).status, 403);
  assert.equal((await buyer.post(`/api/orders/${b}/dispute`, { reason: 'not_received', details: 'Nothing arrived at my address.' })).status, 201);
  assert.equal((await buyer.post(`/api/orders/${b}/dispute`, { reason: 'not_received', details: 'Nothing arrived at my address.' })).status, 400);
  db.prepare("UPDATE orders SET payout_release_at = datetime('now', '-1 day') WHERE id = ?").run(b);
  await buyer.get('/api/orders');
  assert.equal(payout(b), 'held', 'a dispute blocks the automatic release');
  assert.equal((await seller.post(`/api/orders/${b}/dispute/reply`, { reply: 'It was handed to a neighbour.' })).status, 200);

  const queue = await staff.get('/api/admin/disputes');
  const dispute = queue.body.items.find((d: Json) => d.order_id === b);
  assert.ok(dispute);
  assert.equal(dispute.seller_reply, 'It was handed to a neighbour.');
  assert.equal((await buyer.post(`/api/admin/disputes/${dispute.id}/resolve`, { decision: 'refund', note: 'x y' })).status, 403);
  assert.equal((await staff.post(`/api/admin/disputes/${dispute.id}/resolve`, { decision: 'refund', note: 'Courier confirmed no delivery.' })).status, 200);
  assert.equal(payout(b), 'refunded');
  assert.equal((await staff.post(`/api/admin/disputes/${dispute.id}/resolve`, { decision: 'reject', note: 'again' })).status, 400);

  // A rejected dispute lets the payout go through.
  const c2 = await buy();
  for (const s of ['confirmed', 'shipped', 'delivered']) assert.equal((await seller.post(`/api/orders/${c2}/status`, { status: s })).status, 200);
  const d2 = await buyer.post(`/api/orders/${c2}/dispute`, { reason: 'damaged', details: 'The lid was cracked on arrival.' });
  assert.equal((await staff.post(`/api/admin/disputes/${d2.body.id}/resolve`, { decision: 'reject', note: 'Photos show no damage.' })).status, 200);
  assert.equal(payout(c2), 'released');

  const summary = await seller.get('/api/orders/payouts/summary');
  assert.ok(summary.body.items.some((r: Json) => r.status === 'released'));

  // The storefront shows the rating, the review and the products with "sold by" details.
  const shop = await new Client().get(`/api/shops/${sellerMe.username}`);
  assert.equal(shop.status, 200);
  assert.deepEqual(shop.body.seller.rating, { avg: 4, count: 1 });
  assert.equal(shop.body.reviews[0].body, 'Quick and honest');
  assert.equal(shop.body.products[0].name, 'Trust Kettle');
  assert.deepEqual(shop.body.products[0].seller.rating, { avg: 4, count: 1 });
});

test('saved searches alert on new matches; live events reach open streams', async () => {
  const { c: shopper, me: shopperMe } = await register('customer');
  const { c: seller } = await register('retailer', { category: 'retail' });
  assert.equal((await shopper.post('/api/saved-searches', { kind: 'product', params: {} })).status, 400);
  const saved = await shopper.post('/api/saved-searches', { kind: 'product', label: 'Cheap phones', params: { q: 'smartphone', city: 'Arusha', max_price: '50000', bogus: 'x' } });
  assert.equal(saved.status, 201);
  assert.equal((await shopper.post('/api/saved-searches', { kind: 'product', params: { q: 'smartphone', city: 'Arusha', max_price: '50000' } })).status, 400, 'no duplicates');

  const make = (name: string, price: number, city = 'Arusha') => seller.post('/api/products', { name, category: 'electronics', price, quantity: 5, city });
  await make('Budget Smartphone X', 45000);
  await make('Premium Smartphone Z', 900000);
  await make('Phone Case', 3000);
  await new Promise((r) => setTimeout(r, 100));
  await settle();
  const alerts = (await shopper.get('/api/notifications')).body.items.filter((x: Json) => x.type === 'saved_search');
  assert.equal(alerts.length, 1, 'only the product that fits the search');
  assert.equal(alerts[0].body, 'Budget Smartphone X');
  const list = await shopper.get('/api/saved-searches');
  assert.equal(list.body.items.length, 1);
  assert.equal((await shopper.del(`/api/saved-searches/${list.body.items[0].id}`)).status, 200);

  // An open stream is told about new notifications.
  const { addLiveClient } = await import('../src/lib/live.ts');
  const { notify } = await import('../src/services/notify.ts');
  const frames: string[] = [];
  const stop = addLiveClient(shopperMe.id, { write: (s: string) => frames.push(s) } as never);
  notify([shopperMe.id], { type: 'system', title: 'Hello live' });
  stop();
  notify([shopperMe.id], { type: 'system', title: 'After close' });
  assert.equal(frames.length, 1);
  assert.match(frames[0], /^event: notification\n.*Hello live/);

  // The stream endpoint itself requires a session and stays open.
  assert.equal((await new Client().get('/api/live')).status, 401);
  const res = await fetch(`${base}/api/live`, { headers: { cookie: shopper.cookie } });
  assert.match(res.headers.get('content-type') ?? '', /^text\/event-stream/);
  const reader = res.body!.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /event: ready/);
  await reader.cancel();

  // Push: a key is served and a device can subscribe and leave.
  const key = await new Client().get('/api/push/key');
  assert.ok(key.body.key.length > 20);
  const sub = { endpoint: 'https://push.example.test/abc', keys: { p256dh: 'p', auth: 'a' } };
  assert.equal((await shopper.post('/api/push/subscribe', sub)).status, 201);
  assert.equal((await shopper.get('/api/push/status')).body.devices, 1);
  assert.equal((await shopper.post('/api/push/unsubscribe', { endpoint: sub.endpoint })).status, 200);
  assert.equal((await shopper.get('/api/push/status')).body.devices, 0);
});

test('visibility: paid plans and verified accounts are listed first, and the plan chart carries the perks', async () => {
  const { c: buyer } = await register('customer');
  const { c: free, me: freeMe } = await register('retailer', { category: 'retail' });
  const { c: pro, me: proMe } = await register('retailer', { category: 'retail' });
  const { c: top, me: topMe } = await register('retailer', { category: 'retail' });
  const { c: checked, me: checkedMe } = await register('retailer', { category: 'retail' });
  const mk = (c: Client, price = 10000) => c.post('/api/products', { name: 'Rank Test Blender', category: 'electronics', price, quantity: 5 });
  // Free seller lists last, so on date alone they would come first.
  const tops = await mk(top); const pros = await mk(pro); const chk = await mk(checked); const frees = await mk(free, 5000);
  const ids = { free: frees.body.product.id, pro: pros.body.product.id, top: tops.body.product.id, checked: chk.body.product.id };
  db.prepare("UPDATE products SET created_at = datetime('now', '+1 minute') WHERE id = ?").run(ids.free);

  const plans = (await pro.get('/api/subscriptions')).body.plans;
  const byCode = (code: string) => plans.find((p: Json) => p.code === code);
  assert.equal(byCode('retailer_free').boost, 0);
  assert.equal(byCode('retailer_pro').boost, 1);
  assert.equal(byCode('retailer_scale').boost, 2);
  assert.equal(byCode('retailer_scale').perks.support, 'priority');
  assert.equal(byCode('retailer_pro').perks.verification_discount, 10);
  assert.ok(byCode('retailer_scale').features.some((f: string) => /Featured badge/.test(f)));

  assert.equal((await pro.post('/api/subscriptions/subscribe', { plan_id: byCode('retailer_pro').id })).status, 200);
  const scale = (await top.get('/api/subscriptions')).body.plans.find((p: Json) => p.code === 'retailer_scale');
  assert.equal((await top.post('/api/subscriptions/subscribe', { plan_id: scale.id, period: 'yearly' })).status, 200);
  db.prepare('UPDATE users SET verified = 1 WHERE id = ?').run(checkedMe.id);

  const order = async (qs = '') => (await buyer.get(`/api/products?q=Rank+Test+Blender${qs}`)).body.items.filter((p: Json) => Object.values(ids).includes(p.id)).map((p: Json) => p.id);
  assert.deepEqual(await order(), [ids.top, ids.pro, ids.checked, ids.free], 'top plan, then priority plan, then verified, then free');
  assert.deepEqual(await order('&sort=newest'), [ids.top, ids.pro, ids.checked, ids.free]);
  assert.equal((await order('&sort=price_asc'))[0], ids.free, 'an explicit price order is respected, so the cheapest leads');
  const card = (await buyer.get(`/api/products?q=Rank+Test+Blender`)).body.items.find((p: Json) => p.id === ids.top);
  assert.equal(card.seller.visibility, 2);
  assert.equal((await buyer.get('/api/products?q=Rank+Test+Blender')).body.items.find((p: Json) => p.id === ids.free).seller.visibility, 0);

  // Verification costs less on a paid plan.
  const v = await top.get('/api/verification');
  assert.equal(v.body.discount, 25);
  assert.equal(v.body.options[0].total, Math.round((v.body.base * 0.75) / 100) * 100);
  assert.equal(v.body.options[2].total, Math.round((v.body.base * 12 * 0.8 * 0.75) / 100) * 100, 'term and plan discounts stack');
  assert.equal((await free.get('/api/verification')).body.discount, 0);
  void freeMe; void proMe; void topMe;
});

test('verification terms: 6 months and yearly cost less per month, badges expire, renewal brings them back', async () => {
  const { c: shop, me } = await register('retailer', { category: 'retail' });
  const { me: adminMe, c: admin } = await register('personal');
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(adminMe.id);
  await admin.put('/api/admin/billing/settings', { verification_fee: 10000 });
  const doc = async () => {
    const form = new FormData();
    form.append('kind', 'business_registration'); form.append('visibility', 'private');
    form.append('file', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), 'cert.pdf');
    return (await shop.req('POST', '/api/documents', undefined, { form })).body.document.id as number;
  };
  const opts = (await shop.get('/api/verification')).body.options;
  assert.deepEqual(opts.map((o: Json) => [o.period, o.months, o.total]), [['monthly', 1, 10000], ['semiannual', 6, 54000], ['yearly', 12, 96000]]);
  assert.ok(opts[2].per_month < opts[1].per_month && opts[1].per_month < opts[0].per_month);

  assert.equal((await shop.post('/api/verification', { document_ids: [await doc()], period: 'weekly' })).status, 400);
  const sent = await shop.post('/api/verification', { document_ids: [await doc()], period: 'semiannual' });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  const req = db.prepare('SELECT paid_amount, period, months FROM verification_requests WHERE id = ?').get(sent.body.id) as Json;
  assert.deepEqual({ ...req }, { paid_amount: 54000, period: 'semiannual', months: 6 });
  assert.equal((await shop.post('/api/verification/renew', { period: 'monthly' })).status, 400, 'nothing to renew before approval');
  assert.equal((await admin.post(`/api/admin/verifications/${sent.body.id}`, { decision: 'approve' })).status, 200);

  const st = (await shop.get('/api/verification')).body;
  assert.equal(st.verified, true);
  const days = (Date.parse(st.verified_until.replace(' ', 'T') + 'Z') - Date.now()) / 86_400_000;
  assert.ok(days > 179 && days < 181, `six months, got ${days}`);

  // Renewing extends from the end of the current term.
  assert.equal((await shop.post('/api/verification/renew', { period: 'yearly' })).status, 200);
  const after = (await shop.get('/api/verification')).body;
  const more = (Date.parse(after.verified_until.replace(' ', 'T') + 'Z') - Date.parse(st.verified_until.replace(' ', 'T') + 'Z')) / 86_400_000;
  assert.ok(more > 359 && more < 361, `a year more, got ${more}`);

  // When the term ends the badge goes, and a renewal needs no new documents.
  const { expireVerifications } = await import('../src/services/verification.ts');
  db.prepare("UPDATE users SET verified_until = datetime('now', '-1 minute') WHERE id = ?").run(me.id);
  const card = async () => (await new Client().get(`/api/shops/${me.username}`)).body.seller.verified;
  assert.equal(await card(), false, 'an ended term is not shown as verified even before the sweep');
  assert.equal(expireVerifications() >= 1, true);
  const lapsed = (await shop.get('/api/verification')).body;
  assert.equal(lapsed.verified, false);
  assert.equal(lapsed.lapsed, true);
  assert.equal((await shop.post('/api/verification/renew', { period: 'monthly' })).status, 200);
  assert.equal((await shop.get('/api/verification')).body.verified, true);
  assert.equal(await card(), true);
  assert.ok((await shop.get('/api/notifications')).body.items.some((n: Json) => n.title === 'Your verified badge has expired'));
});
