// Demo data: `npm run seed` (fresh database) or `npm run seed -- --reset` (wipe and reseed).
// Every demo account uses the password  OmniBiz2026  (the super admin uses OmniBizAdmin2026).
import { all, db, get, run, tx, sqlTime, DAY, HOUR } from './index.ts';
import { hashPassword } from '../lib/crypto.ts';
import { cityCoords } from '../lib/geo.ts';
import { ensureCategories } from '../app.ts';
import { registerEventHandlers } from '../services/events.ts';
import { settle, emit } from '../lib/queue.ts';
import { rebuildIndex } from '../services/search-index.ts';
import { createPost } from '../modules/posts.ts';
import { scoreMatch, loadCandidates } from '../services/matching.ts';

const reset = process.argv.includes('--reset');
if (get('SELECT COUNT(*) AS n FROM users')!.n > 0) {
  if (!reset) {
    console.log('Database already has data. Run `npm run seed -- --reset` to wipe and reseed.');
    process.exit(0);
  }
  db.exec('PRAGMA foreign_keys = OFF');
  for (const t of all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'search_index_%'")) {
    db.exec(`DELETE FROM "${t.name}"`);
  }
  db.exec('PRAGMA foreign_keys = ON');
}

ensureCategories();
registerEventHandlers();

const PASSWORD = hashPassword('OmniBiz2026');
let rnd = 42;
const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
const ago = (maxDays: number) => sqlTime(-Math.floor(rand() * maxDays * DAY));

interface NewUser {
  type: string; username: string; email: string; phone: string; name: string; city: string; bio?: string;
  role?: string; password?: string; created?: number;
}

function user(u: NewUser): number {
  const c = cityCoords(u.city)!;
  // Spread businesses around the city centre so map pins don't overlap.
  const jitter = () => (rand() - 0.5) * 0.04;
  const { id } = run(
    `INSERT INTO users (account_type, username, email, phone, password_hash, display_name, bio, country, region, city, lat, lng,
       email_verified, phone_verified, role, onboarded, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,1,?,1,?)`,
    u.type, u.username, u.email, u.phone, u.password ? hashPassword(u.password) : PASSWORD, u.name, u.bio ?? null,
    c ? 'Tanzania' : null, u.city, u.city, c.lat + jitter(), c.lng + jitter(), u.role ?? 'user', sqlTime(-(u.created ?? 120) * DAY),
  );
  if (['Nairobi', 'Mombasa'].includes(u.city)) run("UPDATE users SET country = 'Kenya' WHERE id = ?", id);
  return id;
}

function business(id: number, b: { kind: string; name: string; category: string; description: string; services?: string[]; lines?: string[]; website?: string; address: string; verified?: boolean; employees?: string; founded?: number; hours?: string }) {
  run(
    `INSERT INTO businesses (user_id, kind, name, category, description, services, product_lines, wholesale_categories, website, address,
       contact_email, contact_phone, verified, verification_status, employee_count, founded_year, opening_hours)
     SELECT ?,?,?,?,?,?,?,?,?,?, email, phone, ?, ?, ?, ?, ? FROM users WHERE id = ?`,
    id, b.kind, b.name, b.category, b.description, b.services ?? [], b.lines ?? [], b.kind === 'wholesaler' ? b.lines ?? [] : [],
    b.website ?? null, b.address, b.verified ? 1 : 0, b.verified ? 'verified' : 'none', b.employees ?? null, b.founded ?? null, b.hours ?? null, id,
  );
}

function profile(id: number, p: { headline: string; summary: string; industries: string[]; locations: string[]; jobTypes?: string[] }) {
  run(
    'INSERT INTO profiles (user_id, full_name, headline, summary, open_to_work, preferred_industries, preferred_locations, job_types, field_visibility) SELECT ?, display_name, ?, ?, 1, ?, ?, ?, ? FROM users WHERE id = ?',
    id, p.headline, p.summary, p.industries, p.locations, p.jobTypes ?? [], { email: 'recruiters', phone: 'recruiters', dob: 'private' }, id,
  );
}

function cv(id: number, section: string, data: Record<string, unknown>, visibility = 'public') {
  run('INSERT INTO cv_items (user_id, section, data, visibility) VALUES (?,?,?,?)', id, section, data, visibility);
}

function interests(id: number, slugs: string[]) {
  for (const s of slugs) run('INSERT OR IGNORE INTO user_interests (user_id, slug) VALUES (?,?)', id, s);
}

console.log('Seeding OmniBiz demo data…');

const ids = tx(() => {
  // ───── staff ─────
  const admin = user({ type: 'personal', username: 'admin', email: 'admin@omnibiz.test', phone: '+255700000001', name: 'OmniBiz Admin', city: 'Dar es Salaam', role: 'super_admin', password: 'OmniBizAdmin2026', created: 200 });
  profile(admin, { headline: 'Platform administrator', summary: '', industries: [], locations: [] });
  run('UPDATE profiles SET open_to_work = 0 WHERE user_id = ?', admin);
  const moderator = user({ type: 'personal', username: 'moderator', email: 'mod@omnibiz.test', phone: '+255700000002', name: 'Rehema Moderator', city: 'Dodoma', role: 'moderator', created: 190 });
  profile(moderator, { headline: 'Trust & Safety', summary: '', industries: [], locations: [] });
  run('UPDATE profiles SET open_to_work = 0 WHERE user_id = ?', moderator);
  const verifier = user({ type: 'personal', username: 'verifier', email: 'verify@omnibiz.test', phone: '+255700000003', name: 'Hamisi Verification', city: 'Dar es Salaam', role: 'verification', created: 190 });
  profile(verifier, { headline: 'Business verification team', summary: '', industries: [], locations: [] });
  run('UPDATE profiles SET open_to_work = 0 WHERE user_id = ?', verifier);

  // ───── personal accounts ─────
  const asha = user({ type: 'personal', username: 'asha', email: 'asha@omnibiz.test', phone: '+255711000001', name: 'Asha Mwakyusa', city: 'Arusha', bio: 'Full-stack developer who loves building tools for East African businesses.' });
  profile(asha, { headline: 'Software Developer · React & Node.js', summary: 'Three years building web apps with React, Node.js and PostgreSQL. Interested in fintech and AI products.', industries: ['software', 'ai', 'technology'], locations: ['Arusha', 'Dar es Salaam'], jobTypes: ['full_time', 'contract'] });
  for (const s of ['JavaScript', 'React', 'Node.js', 'PostgreSQL', 'TypeScript', 'Git']) cv(asha, 'skill', { name: s, level: 'advanced' });
  cv(asha, 'education', { school: 'Nelson Mandela African Institution of Science and Technology', program: 'Computer Science', level: 'bachelor', start_year: 2017, end_year: 2021 });
  cv(asha, 'experience', { company: 'Twiga Digital', position: 'Software Developer', responsibilities: 'Built React dashboards and REST APIs in Node.js; maintained PostgreSQL databases.', start_date: '2021-08', current: true });
  cv(asha, 'certification', { name: 'AWS Cloud Practitioner', issuer: 'Amazon Web Services', issued_on: '2023-05' });
  cv(asha, 'language', { name: 'Swahili', proficiency: 'native' });
  cv(asha, 'language', { name: 'English', proficiency: 'fluent' });
  cv(asha, 'portfolio', { title: 'Duka POS', description: 'Point-of-sale web app for small shops, used by 40 retailers in Arusha.', url: 'https://example.com/duka-pos' });
  interests(asha, ['software', 'ai', 'technology', 'jobs', 'entrepreneurship']);

  const david = user({ type: 'personal', username: 'david', email: 'david@omnibiz.test', phone: '+255711000002', name: 'David Mushi', city: 'Dar es Salaam', bio: 'Recent graduate, junior frontend developer.' });
  profile(david, { headline: 'Junior Frontend Developer', summary: 'Recent IT graduate looking for my first developer role. Built several React projects.', industries: ['software', 'technology'], locations: ['Dar es Salaam', 'Arusha'], jobTypes: ['full_time', 'internship'] });
  for (const s of ['HTML', 'CSS', 'JavaScript', 'React']) cv(david, 'skill', { name: s, level: 'intermediate' });
  cv(david, 'education', { school: 'University of Dar es Salaam', program: 'Computer Science', level: 'bachelor', start_year: 2021, end_year: 2025 });
  cv(david, 'portfolio', { title: 'Soko Finder', description: 'React app for comparing market prices.', url: 'https://example.com/soko' });
  interests(david, ['software', 'technology', 'jobs']);

  const juma = user({ type: 'personal', username: 'juma', email: 'juma@omnibiz.test', phone: '+255711000003', name: 'Juma Said', city: 'Dar es Salaam', bio: 'Civil engineer — roads, drainage and building works.' });
  profile(juma, { headline: 'Civil / Site Engineer', summary: 'Six years supervising building and road construction projects.', industries: ['construction', 'engineering'], locations: ['Dar es Salaam', 'Dodoma'], jobTypes: ['full_time', 'contract'] });
  for (const s of ['AutoCAD', 'Site Supervision', 'Quantity Surveying', 'Project Management']) cv(juma, 'skill', { name: s, level: 'expert' });
  cv(juma, 'education', { school: 'Ardhi University', program: 'Civil Engineering', level: 'bachelor', start_year: 2012, end_year: 2016 });
  cv(juma, 'experience', { company: 'Ujenzi Bora Ltd', position: 'Site Engineer', responsibilities: 'Supervised 4-storey commercial buildings and drainage works.', start_date: '2018-01', current: true });
  interests(juma, ['construction', 'engineering', 'jobs', 'real-estate']);

  const neema = user({ type: 'personal', username: 'neema', email: 'neema@omnibiz.test', phone: '+255711000004', name: 'Neema Kileo', city: 'Dodoma', bio: 'Accountant (CPA candidate).' });
  profile(neema, { headline: 'Accountant · CPA(T) candidate', summary: 'Experience in bookkeeping, tax returns and payroll for SMEs.', industries: ['finance', 'consulting'], locations: ['Dodoma'], jobTypes: ['full_time'] });
  for (const s of ['Accounting', 'Excel', 'QuickBooks', 'Tax', 'Payroll']) cv(neema, 'skill', { name: s, level: 'advanced' });
  cv(neema, 'education', { school: 'Institute of Finance Management', program: 'Accounting', level: 'bachelor', start_year: 2016, end_year: 2019 });
  cv(neema, 'experience', { company: 'Kileo & Associates', position: 'Accounts Assistant', responsibilities: 'Bookkeeping, VAT returns and payroll for 30 SME clients.', start_date: '2020-02', current: true });
  interests(neema, ['finance', 'business', 'jobs']);

  const baraka = user({ type: 'personal', username: 'baraka', email: 'baraka@omnibiz.test', phone: '+255711000005', name: 'Baraka Mollel', city: 'Mwanza', bio: 'Agronomist working with smallholder farmers around Lake Victoria.' });
  profile(baraka, { headline: 'Agronomist', summary: 'Soil testing, crop advisory and extension services.', industries: ['agriculture'], locations: ['Mwanza', 'Shinyanga'], jobTypes: ['full_time', 'contract'] });
  for (const s of ['Agronomy', 'Soil Testing', 'Irrigation', 'Farmer Training']) cv(baraka, 'skill', { name: s });
  cv(baraka, 'education', { school: 'Sokoine University of Agriculture', program: 'Agronomy', level: 'bachelor', start_year: 2014, end_year: 2018 });
  cv(baraka, 'experience', { company: 'Lake Farmers Cooperative', position: 'Extension Officer', start_date: '2019-01', end_date: '2024-06' });
  interests(baraka, ['agriculture', 'jobs', 'entrepreneurship']);

  const grace = user({ type: 'personal', username: 'grace', email: 'grace@omnibiz.test', phone: '+255711000006', name: 'Grace Lyimo', city: 'Moshi', bio: 'Registered nurse.' });
  profile(grace, { headline: 'Registered Nurse', summary: 'Five years in maternal and outpatient care.', industries: ['healthcare'], locations: ['Moshi', 'Arusha'], jobTypes: ['full_time'] });
  for (const s of ['Patient Care', 'Midwifery', 'First Aid']) cv(grace, 'skill', { name: s });
  cv(grace, 'education', { school: 'KCMC School of Nursing', program: 'Nursing', level: 'diploma', start_year: 2015, end_year: 2018 });
  cv(grace, 'experience', { company: 'Mawenzi Hospital', position: 'Nurse', start_date: '2019-03', current: true });
  interests(grace, ['healthcare', 'jobs']);

  const peter = user({ type: 'personal', username: 'peter', email: 'peter@omnibiz.test', phone: '+255711000007', name: 'Peter Laizer', city: 'Arusha', bio: 'Electrician and solar installer.' });
  profile(peter, { headline: 'Electrician · Solar PV Installer', summary: 'Certified electrician installing solar home systems.', industries: ['energy', 'engineering'], locations: ['Arusha', 'Moshi'], jobTypes: ['full_time', 'contract'] });
  for (const s of ['Electrical Installation', 'Solar PV', 'Wiring', 'Maintenance']) cv(peter, 'skill', { name: s });
  cv(peter, 'education', { school: 'Arusha Technical College', program: 'Electrical Engineering', level: 'diploma', start_year: 2016, end_year: 2019 });
  cv(peter, 'experience', { company: 'Self-employed', position: 'Electrician', start_date: '2019-06', current: true });
  interests(peter, ['energy', 'engineering', 'jobs', 'construction']);

  const fatma = user({ type: 'personal', username: 'fatma', email: 'fatma@omnibiz.test', phone: '+255711000008', name: 'Fatma Ali', city: 'Zanzibar', bio: 'Fashion designer — kanga and kitenge collections.' });
  profile(fatma, { headline: 'Fashion Designer', summary: 'Designing contemporary clothing with East African fabrics.', industries: ['fashion', 'retail'], locations: ['Zanzibar', 'Dar es Salaam'] });
  for (const s of ['Fashion Design', 'Tailoring', 'Pattern Making', 'Instagram Marketing']) cv(fatma, 'skill', { name: s });
  interests(fatma, ['fashion', 'retail', 'wholesale', 'entrepreneurship']);

  // ───── companies ─────
  const kilima = user({ type: 'company', username: 'kilimatech', email: 'hello@kilimatech.test', phone: '+255754100001', name: 'Kilima Tech Solutions', city: 'Arusha', created: 300 });
  business(kilima, { kind: 'company', name: 'Kilima Tech Solutions', category: 'software', description: 'We build software, mobile apps and cloud systems for businesses, NGOs and government across East Africa.', services: ['Custom software development', 'Mobile app development', 'Cloud hosting', 'IT consulting', 'ERP implementation'], website: 'https://kilimatech.example.com', address: 'Njiro Road, Arusha', verified: true, employees: '51-200', founded: 2014, hours: 'Mon–Fri 08:00–17:00' });
  const bahari = user({ type: 'company', username: 'baharibuild', email: 'info@baharibuild.test', phone: '+255754100002', name: 'Bahari Construction Ltd', city: 'Dar es Salaam', created: 280 });
  business(bahari, { kind: 'company', name: 'Bahari Construction Ltd', category: 'construction', description: 'Commercial and residential construction, roads and civil works.', services: ['Building construction', 'Road works', 'Renovation', 'Project management'], address: 'Mikocheni, Dar es Salaam', verified: true, employees: '201-500', founded: 2008 });
  const agripro = user({ type: 'company', username: 'mwanzaagripro', email: 'info@agripro.test', phone: '+255754100003', name: 'Mwanza AgriPro', city: 'Mwanza', created: 250 });
  business(agripro, { kind: 'company', name: 'Mwanza AgriPro', category: 'agriculture', description: 'Agricultural advisory, seeds, irrigation and produce aggregation around Lake Victoria.', services: ['Soil testing', 'Irrigation installation', 'Farmer training', 'Produce aggregation'], address: 'Kenyatta Road, Mwanza', verified: false, employees: '11-50', founded: 2017 });
  const safari = user({ type: 'company', username: 'safarihealth', email: 'care@safarihealth.test', phone: '+255754100004', name: 'Safari Health Clinic', city: 'Moshi', created: 260 });
  business(safari, { kind: 'company', name: 'Safari Health Clinic', category: 'healthcare', description: 'Outpatient, maternal and laboratory services in Moshi.', services: ['Outpatient care', 'Laboratory tests', 'Maternal health', 'Pharmacy'], address: 'Rindi Lane, Moshi', verified: true, employees: '11-50', founded: 2012, hours: 'Open 24 hours' });
  const dfp = user({ type: 'company', username: 'dodomafinance', email: 'info@dfp.test', phone: '+255754100005', name: 'Dodoma Finance Partners', city: 'Dodoma', created: 240 });
  business(dfp, { kind: 'company', name: 'Dodoma Finance Partners', category: 'finance', description: 'Accounting, audit, tax and business advisory for SMEs.', services: ['Bookkeeping', 'Tax advisory', 'Audit', 'Payroll services'], address: 'Area D, Dodoma', employees: '11-50', founded: 2015 });
  const serengeti = user({ type: 'company', username: 'serengetisolar', email: 'sales@serengetisolar.test', phone: '+255754100006', name: 'Serengeti Solar Energy', city: 'Arusha', created: 270 });
  business(serengeti, { kind: 'company', name: 'Serengeti Solar Energy', category: 'energy', description: 'Solar home systems, solar water pumps and installation across northern Tanzania.', services: ['Solar installation', 'Solar water pumping', 'Maintenance contracts'], address: 'Sakina, Arusha', verified: true, employees: '51-200', founded: 2013 });

  // ───── wholesalers ─────
  const kariakoo = user({ type: 'wholesaler', username: 'kariakooelectronics', email: 'sales@kariakoo-electronics.test', phone: '+255754200001', name: 'Kariakoo Wholesale Electronics', city: 'Dar es Salaam', created: 220 });
  business(kariakoo, { kind: 'wholesaler', name: 'Kariakoo Wholesale Electronics', category: 'wholesale', description: 'Bulk phones, accessories, solar panels and electronics for retailers across Tanzania.', lines: ['Phones & accessories', 'Solar panels', 'Batteries', 'Small appliances'], address: 'Msimbazi Street, Kariakoo, Dar es Salaam', verified: true, hours: 'Mon–Sat 07:30–18:00' });
  const tanga = user({ type: 'wholesaler', username: 'tangabuild', email: 'orders@tangabuild.test', phone: '+255754200002', name: 'Tanga Building Supplies', city: 'Tanga', created: 210 });
  business(tanga, { kind: 'wholesaler', name: 'Tanga Building Supplies', category: 'construction', description: 'Cement, iron sheets, steel bars and building materials in bulk.', lines: ['Cement', 'Iron sheets', 'Steel bars', 'Paint'], address: 'Port Road, Tanga' });
  const lakezone = user({ type: 'wholesaler', username: 'lakezonegrain', email: 'trade@lakezone.test', phone: '+255754200003', name: 'Lake Zone Grain Traders', city: 'Mwanza', created: 200 });
  business(lakezone, { kind: 'wholesaler', name: 'Lake Zone Grain Traders', category: 'agriculture', description: 'Maize, rice, beans and sunflower oil wholesale.', lines: ['Maize', 'Rice', 'Beans', 'Cooking oil'], address: 'Mkuyuni Market, Mwanza' });

  // ───── retailers ─────
  const mobilehub = user({ type: 'retailer', username: 'arushamobilehub', email: 'shop@mobilehub.test', phone: '+255754300001', name: 'Arusha Mobile Hub', city: 'Arusha', created: 180 });
  business(mobilehub, { kind: 'retailer', name: 'Arusha Mobile Hub', category: 'retail', description: 'Smartphones, laptops, accessories and repairs in central Arusha.', services: ['Phone repair', 'Screen replacement'], address: 'Sokoine Road, Arusha', verified: true, hours: 'Mon–Sun 08:00–20:00' });
  const kanga = user({ type: 'retailer', username: 'zanzibarkanga', email: 'hello@kangahouse.test', phone: '+255754300002', name: 'Zanzibar Kanga House', city: 'Zanzibar', created: 170 });
  business(kanga, { kind: 'retailer', name: 'Zanzibar Kanga House', category: 'fashion', description: 'Kanga, kitenge, tailored dresses and gifts from Stone Town.', services: ['Tailoring'], address: 'Gizenga Street, Stone Town' });
  const agroshop = user({ type: 'retailer', username: 'moshiagro', email: 'info@moshiagro.test', phone: '+255754300003', name: 'Moshi Agro Shop', city: 'Moshi', created: 160 });
  business(agroshop, { kind: 'retailer', name: 'Moshi Agro Shop', category: 'agriculture', description: 'Seeds, fertiliser, sprayers and farm tools.', address: 'Market Street, Moshi' });
  const homemart = user({ type: 'retailer', username: 'dodomahomemart', email: 'shop@homemart.test', phone: '+255754300004', name: 'Dodoma Home Mart', city: 'Dodoma', created: 150 });
  business(homemart, { kind: 'retailer', name: 'Dodoma Home Mart', category: 'retail', description: 'Furniture, kitchenware and home appliances.', address: 'Jamhuri Street, Dodoma' });

  // ───── customers ─────
  const zuberi = user({ type: 'customer', username: 'zuberi', email: 'zuberi@omnibiz.test', phone: '+255711900001', name: 'Zuberi Hassan', city: 'Arusha' });
  interests(zuberi, ['technology', 'retail', 'energy']);
  const mary = user({ type: 'customer', username: 'mary', email: 'mary@omnibiz.test', phone: '+255711900002', name: 'Mary Joseph', city: 'Dar es Salaam' });
  interests(mary, ['fashion', 'retail', 'food-beverage']);
  const salim = user({ type: 'customer', username: 'salim', email: 'salim@omnibiz.test', phone: '+255711900003', name: 'Salim Omary', city: 'Dodoma' });
  interests(salim, ['agriculture', 'construction', 'retail']);

  for (const [b, list] of [[kilima, ['software', 'ai']], [mobilehub, ['technology']], [kariakoo, ['technology', 'energy']], [kanga, ['fashion']]] as [number, string[]][]) interests(b, list);

  return { admin, moderator, verifier, asha, david, juma, neema, baraka, grace, peter, fatma, kilima, bahari, agripro, safari, dfp, serengeti, kariakoo, tanga, lakezone, mobilehub, kanga, agroshop, homemart, zuberi, mary, salim };
});

// ───── products ─────
const productIds: Record<string, number> = {};
tx(() => {
  const P = (key: string, seller: number, p: Record<string, unknown>) => {
    const s = get('SELECT city, lat, lng FROM users WHERE id = ?', seller)!;
    const { id } = run(
      `INSERT INTO products (seller_id, name, description, category, sale_type, price, currency, min_order_qty, quantity, availability, packaging, specs,
         city, lat, lng, delivery_info, delivery_options, contact_method, view_count, created_at)
       VALUES (?,?,?,?,?,?,'TZS',?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      seller, p.name, p.description, p.category, p.sale_type ?? 'retail', p.price, p.moq ?? 1, p.qty ?? null, p.availability ?? 'in_stock',
      p.packaging ?? null, p.specs ?? {}, s.city, s.lat, s.lng, p.delivery ?? null, p.options ?? ['pickup'], 'Message or call',
      Math.floor(rand() * 300), ago(60),
    );
    productIds[key] = id;
  };
  const { kariakoo, tanga, lakezone, mobilehub, kanga, agroshop, homemart, serengeti, kilima, safari } = ids;
  P('panel', kariakoo, { name: 'Solar Panel 300W Monocrystalline', description: 'High-efficiency 300W mono panel, 25-year output warranty.', category: 'solar-energy', sale_type: 'wholesale', price: 250000, moq: 20, qty: 500, packaging: 'Carton of 2 panels', specs: { Power: '300 W', Type: 'Monocrystalline', Warranty: '25 years', Size: '1640 × 992 mm' }, delivery: 'Delivery across Tanzania via bus cargo; Dar es Salaam same day.', options: ['pickup', 'delivery'] });
  P('phones', kariakoo, { name: 'Tecno Spark 20 (box of 10)', description: 'Retail-ready boxed smartphones, 128GB.', category: 'phones-computers', sale_type: 'wholesale', price: 2650000, moq: 2, qty: 120, packaging: 'Box of 10 units', specs: { Storage: '128 GB', RAM: '8 GB', Warranty: '12 months' }, options: ['pickup', 'delivery'] });
  P('battery', kariakoo, { name: 'Deep Cycle Battery 200Ah', description: 'Gel battery for solar systems.', category: 'solar-energy', sale_type: 'wholesale', price: 520000, moq: 10, qty: 200, packaging: 'Single unit', specs: { Capacity: '200 Ah', Voltage: '12 V', Type: 'Gel' } });
  P('earbuds', kariakoo, { name: 'Wireless Earbuds (carton of 50)', description: 'Bluetooth 5.3 earbuds with charging case.', category: 'electronics', sale_type: 'wholesale', price: 1100000, moq: 1, qty: 80, packaging: 'Carton of 50' });
  P('cement', tanga, { name: 'Portland Cement 50kg', description: 'Grade 42.5N cement for structural work.', category: 'building-materials', sale_type: 'wholesale', price: 17500, moq: 100, qty: 20000, packaging: '50 kg bag', specs: { Grade: '42.5N', Weight: '50 kg' }, delivery: 'Truck delivery to Tanga, Dar es Salaam, Arusha and Moshi.', options: ['delivery'] });
  P('sheets', tanga, { name: 'Iron Roofing Sheets Gauge 28', description: 'Pre-painted corrugated roofing sheets, 3 m.', category: 'building-materials', sale_type: 'wholesale', price: 23000, moq: 50, qty: 8000, packaging: 'Bundle of 10', specs: { Gauge: '28', Length: '3 m', Colour: 'Red / Blue / Green' } });
  P('steel', tanga, { name: 'Steel Bar Y12', description: 'High-tensile reinforcement bar, 12 m.', category: 'building-materials', sale_type: 'wholesale', price: 26000, moq: 100, qty: 5000 });
  P('maize', lakezone, { name: 'Maize Grain (100kg bag)', description: 'Clean, dried white maize.', category: 'food', sale_type: 'wholesale', price: 78000, moq: 20, qty: 3000, packaging: '100 kg bag' });
  P('rice', lakezone, { name: 'Kyela Rice Grade 1 (50kg)', description: 'Aromatic Kyela rice.', category: 'food', sale_type: 'wholesale', price: 135000, moq: 10, qty: 1500, packaging: '50 kg bag' });
  P('oil', lakezone, { name: 'Sunflower Cooking Oil 20L', description: 'Refined sunflower oil from Singida.', category: 'food', sale_type: 'wholesale', price: 82000, moq: 10, qty: 900, packaging: '20 L jerrycan' });
  P('iphone', mobilehub, { name: 'iPhone 13 128GB (Refurbished)', description: 'Grade A refurbished, 6 months warranty.', category: 'phones-computers', price: 1350000, qty: 6, availability: 'low_stock', specs: { Storage: '128 GB', Condition: 'Refurbished A', Warranty: '6 months' }, options: ['pickup', 'delivery'] });
  P('spark', mobilehub, { name: 'Tecno Spark 20', description: 'New, boxed, 128GB + 8GB RAM.', category: 'phones-computers', price: 325000, qty: 40, specs: { Storage: '128 GB', RAM: '8 GB', Warranty: '12 months' }, options: ['pickup', 'delivery'] });
  P('laptop', mobilehub, { name: 'HP ProBook 450 G9', description: 'Core i5, 16GB RAM, 512GB SSD.', category: 'phones-computers', price: 1890000, qty: 8, specs: { CPU: 'Intel Core i5-1235U', RAM: '16 GB', Storage: '512 GB SSD' } });
  P('screen', mobilehub, { name: 'Screen Replacement Service', description: 'Same-day screen replacement for most phones.', category: 'services', sale_type: 'service', price: 60000, availability: 'on_request' });
  P('kanga', kanga, { name: 'Kanga Pair — Traditional Print', description: 'Cotton kanga pair with Swahili sayings.', category: 'clothing', price: 18000, qty: 200, options: ['pickup', 'delivery'] });
  P('dress', kanga, { name: 'Kitenge Maxi Dress', description: 'Tailored kitenge maxi dress, sizes S–XL.', category: 'clothing', price: 65000, qty: 35 });
  P('shirt', kanga, { name: 'Men’s Kitenge Shirt', description: 'Short-sleeve kitenge shirt.', category: 'clothing', price: 45000, qty: 50 });
  P('seeds', agroshop, { name: 'Hybrid Maize Seed 2kg', description: 'Drought-tolerant hybrid seed.', category: 'agri-inputs', price: 16000, qty: 400 });
  P('fert', agroshop, { name: 'NPK Fertiliser 50kg', description: 'NPK 17:17:17 for planting.', category: 'agri-inputs', price: 95000, qty: 120 });
  P('sprayer', agroshop, { name: 'Knapsack Sprayer 16L', description: 'Manual pressure sprayer.', category: 'machinery', price: 48000, qty: 30 });
  P('sofa', homemart, { name: '3-Seater Fabric Sofa', description: 'Locally made, mninga hardwood frame.', category: 'home-furniture', price: 850000, qty: 5, options: ['delivery'] });
  P('cooker', homemart, { name: 'Gas Cooker 4 Burner', description: 'With oven, 60 cm.', category: 'home-furniture', price: 690000, qty: 10 });
  P('shs', serengeti, { name: 'Solar Home System 500W Kit', description: 'Panels, battery, inverter and installation for a 3-bedroom home.', category: 'solar-energy', price: 3200000, qty: 25, specs: { Output: '500 W', Battery: '200 Ah', Inverter: '1 kVA', Installation: 'Included' }, options: ['delivery'] });
  P('pump', serengeti, { name: 'Solar Water Pump 1HP', description: 'Submersible solar pump for boreholes and irrigation.', category: 'solar-energy', price: 2100000, qty: 12 });
  P('erp', kilima, { name: 'KilimaERP — SME Edition (annual)', description: 'Inventory, sales, accounting and payroll in one system.', category: 'services', sale_type: 'service', price: 1800000, availability: 'on_request' });
  P('lab', safari, { name: 'Full Medical Check-up', description: 'Blood tests, BP, sugar, and doctor consultation.', category: 'health', sale_type: 'service', price: 120000, availability: 'on_request' });
});

// ───── jobs ─────
const jobIds: Record<string, number> = {};
tx(() => {
  const J = (key: string, company: number, j: Record<string, unknown>) => {
    const c = get('SELECT city, lat, lng FROM users WHERE id = ?', company)!;
    const ind = get('SELECT category FROM businesses WHERE user_id = ?', company)!.category;
    const { id } = run(
      `INSERT INTO jobs (company_id, title, department, industry, city, lat, lng, remote, employment_type, description, responsibilities, skills,
         education_req, education_field, experience_years, salary_min, salary_max, currency, deadline, positions, required_docs, view_count, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'TZS',?,?,?,?,?)`,
      company, j.title, j.department ?? null, j.industry ?? ind, j.city ?? c.city, c.lat, c.lng, j.remote ? 1 : 0, j.type ?? 'full_time', j.description,
      j.responsibilities ?? null, j.skills ?? [], j.edu ?? 'none', j.field ?? null, j.exp ?? 0, j.min ?? null, j.max ?? null, j.deadline ?? '2026-11-30',
      j.positions ?? 1, j.docs ?? ['cv'], Math.floor(rand() * 400), sqlTime(-(Number(j.age ?? 5)) * DAY),
    );
    jobIds[key] = id;
  };
  const { kilima, bahari, agripro, safari, dfp, serengeti, mobilehub, kariakoo } = ids;
  J('dev', kilima, { title: 'Software Developer', department: 'Engineering', description: 'Join our product team building web platforms for banks, NGOs and SMEs across East Africa. You will design APIs, build React interfaces and ship features end to end.', responsibilities: 'Build and maintain React front-ends\nDesign REST APIs in Node.js\nWrite tests and review code\nWork with designers and product managers', skills: ['JavaScript', 'React', 'Node.js', 'PostgreSQL'], edu: 'diploma', field: 'Computer Science', exp: 2, min: 1800000, max: 3200000, positions: 2, docs: ['cv', 'certificate', 'portfolio'], age: 3 });
  J('jrdev', kilima, { title: 'Junior Frontend Developer', department: 'Engineering', description: 'Great first role for a recent graduate who loves building interfaces. You will be mentored by senior engineers and work on real client projects.', skills: ['HTML', 'CSS', 'JavaScript', 'React'], edu: 'diploma', field: 'Computer Science', exp: 0, min: 900000, max: 1400000, docs: ['cv', 'portfolio'], age: 1 });
  J('data', kilima, { title: 'Data Analyst Intern', type: 'internship', description: 'Six-month internship analysing product and customer data, building dashboards and reports.', skills: ['Excel', 'SQL', 'Python'], edu: 'bachelor', exp: 0, min: 400000, max: 600000, docs: ['cv', 'academic'], age: 8, remote: true });
  J('site', bahari, { title: 'Site Engineer', department: 'Projects', city: 'Dodoma', description: 'Supervise construction of a government office complex in Dodoma, ensuring quality, safety and schedule.', skills: ['AutoCAD', 'Site Supervision', 'Project Management'], edu: 'bachelor', field: 'Civil Engineering', exp: 4, min: 2500000, max: 4000000, docs: ['cv', 'certificate', 'id'], age: 6 });
  J('qs', bahari, { title: 'Quantity Surveyor', description: 'Prepare BOQs, cost estimates and valuations for residential projects in Dar es Salaam.', skills: ['Quantity Surveying', 'Excel', 'AutoCAD'], edu: 'bachelor', exp: 3, min: 2000000, max: 3000000, docs: ['cv', 'certificate'], age: 12 });
  J('agro', agripro, { title: 'Field Agronomist', description: 'Advise farmers on soil health, inputs and irrigation across Mwanza and Shinyanga.', skills: ['Agronomy', 'Soil Testing', 'Farmer Training'], edu: 'bachelor', field: 'Agronomy', exp: 2, min: 1200000, max: 1800000, positions: 3, docs: ['cv', 'certificate'], age: 2 });
  J('nurse', safari, { title: 'Registered Nurse', description: 'Provide outpatient and maternal care in our Moshi clinic. Shift work.', skills: ['Patient Care', 'Midwifery'], edu: 'diploma', field: 'Nursing', exp: 2, min: 1100000, max: 1500000, positions: 2, docs: ['cv', 'certificate', 'id'], age: 4 });
  J('acct', dfp, { title: 'Accountant', description: 'Manage books, payroll and tax filings for a portfolio of SME clients.', skills: ['Accounting', 'QuickBooks', 'Tax', 'Excel'], edu: 'bachelor', field: 'Accounting', exp: 2, min: 1300000, max: 2000000, docs: ['cv', 'certificate', 'cover_letter'], age: 7 });
  J('solar', serengeti, { title: 'Solar PV Technician', description: 'Install and maintain solar home systems and pumps in Arusha and Kilimanjaro regions.', skills: ['Solar PV', 'Electrical Installation', 'Wiring'], edu: 'certificate', exp: 1, min: 800000, max: 1300000, positions: 4, docs: ['cv', 'certificate'], age: 2 });
  J('sales', mobilehub, { title: 'Sales Associate', type: 'part_time', description: 'Help customers choose phones and laptops at our Sokoine Road shop.', skills: ['Customer Service', 'Sales'], edu: 'secondary', exp: 0, min: 350000, max: 500000, docs: ['cv'], age: 9 });
  J('driver', kariakoo, { title: 'Delivery Driver', description: 'Deliver wholesale orders around Dar es Salaam. Class C licence required.', skills: ['Driving', 'Logistics'], edu: 'secondary', exp: 2, min: 600000, max: 800000, docs: ['cv', 'id'], age: 15 });
});

// ───── follows, posts, engagement ─────
const { asha, david, juma, neema, baraka, grace, peter, fatma, kilima, bahari, agripro, safari, dfp, serengeti, kariakoo, tanga, lakezone, mobilehub, kanga, agroshop, homemart, zuberi, mary, salim, admin } = ids;
tx(() => {
  const F = (a: number, b: number) => run('INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?,?,?)', a, b, ago(40));
  for (const [a, list] of [
    [asha, [kilima, serengeti, mobilehub, david]], [david, [kilima, mobilehub, asha]], [juma, [bahari, tanga]], [neema, [dfp]],
    [baraka, [agripro, lakezone, agroshop]], [grace, [safari]], [peter, [serengeti, kariakoo, kilima]], [fatma, [kanga, kariakoo]],
    [zuberi, [mobilehub, serengeti, kariakoo]], [mary, [kanga, homemart]], [salim, [agroshop, tanga, homemart]],
    [mobilehub, [kariakoo]], [kanga, [kariakoo]], [agroshop, [lakezone]], [homemart, [kariakoo, tanga]], [kilima, [serengeti]],
  ] as [number, number[]][]) for (const b of list) F(a, b);
});

const actor = (id: number) => get('SELECT * FROM users WHERE id = ?', id)!;
const posts: [number, string, string, Record<string, unknown>?][] = [
  [kilima, 'update', 'We just shipped mobile money reconciliation in KilimaERP — M-Pesa, Tigo Pesa and Airtel Money payments now match invoices automatically. #fintech #software #erp'],
  [kilima, 'news', 'Proud to have trained 120 young developers in Arusha this year through our Code Kilima bootcamp. Applications for the next cohort open in December! #education #software #jobs'],
  [serengeti, 'promotion', 'October offer: 10% off all solar home system kits installed before 31 October. Free site survey in Arusha and Moshi. #solar #energy'],
  [serengeti, 'event', 'Join our free solar water-pumping demo for farmers at Nane Nane grounds, Arusha — Saturday 10am. #agriculture #solar', { event_date: '2026-10-17T10:00', event_location: 'Nane Nane Grounds, Arusha' }],
  [kariakoo, 'product', 'New stock: 300W mono solar panels now available in bulk. Minimum order 20 units, delivery anywhere in Tanzania. #wholesale #solar', { product_id: productIds.panel }],
  [kariakoo, 'offer', 'Retailers: order 5+ boxes of Tecno Spark 20 this week and get free delivery to Arusha, Mwanza and Dodoma. #wholesale #phones'],
  [mobilehub, 'product', 'iPhone 13 refurbished (Grade A) back in stock — only 6 units. 6 months warranty. #phones #arusha', { product_id: productIds.iphone }],
  [mobilehub, 'service', 'Cracked screen? We do same-day screen replacement for most models. Walk in on Sokoine Road. #repair #arusha'],
  [bahari, 'news', 'Topping-out ceremony at our Mikocheni residential project — 12 floors completed safely, zero lost-time incidents. #construction #safety'],
  [tanga, 'update', 'Cement deliveries to Arusha and Moshi now run every Tuesday and Friday. Place orders by Monday. #construction #wholesale'],
  [agripro, 'news', 'Soil testing season is here. Farmers in Mwanza and Shinyanga: book a soil test before planting to cut fertiliser costs. #agriculture #farming'],
  [lakezone, 'offer', 'Bulk maize at TZS 78,000 per 100kg bag this week. Minimum 20 bags. #agriculture #wholesale'],
  [kanga, 'product', 'New kitenge maxi dresses just arrived — tailored in Stone Town. Sizes S–XL. #fashion #zanzibar', { product_id: productIds.dress }],
  [safari, 'update', 'Our laboratory now offers same-day results for most routine tests. Open 24 hours. #healthcare #moshi'],
  [dfp, 'news', 'Reminder to SMEs: quarterly VAT returns are due soon. Our team can help you file on time. #finance #tax #business'],
  [agroshop, 'promotion', 'Hybrid maize seed now TZS 16,000 per 2kg — prepare early for the short rains! #agriculture'],
  [asha, 'text', 'Three years ago I built my first React app on a borrowed laptop. Today our team ships software used by banks across East Africa. Keep building! #software #career'],
  [david, 'text', 'Just finished my portfolio project Soko Finder — compare market prices across Dar es Salaam. Feedback welcome! #react #javascript #jobs'],
  [juma, 'text', 'Good drainage design is the most underrated part of any road project. #engineering #construction'],
  [fatma, 'text', 'Working on a new collection inspired by Stone Town doors. Looking for kanga fabric suppliers in bulk — recommendations welcome! #fashion @kariakooelectronics'],
  [peter, 'text', 'Installed my 50th solar home system this month in Monduli. Clean power changes lives. #solar #energy'],
];
for (const [author, kind, body, data] of posts) {
  const id = createPost(actor(author), { kind, body, data: data ?? {} });
  run('UPDATE posts SET created_at = ? WHERE id = ?', sqlTime(-Math.floor(rand() * 9 * DAY + rand() * 20 * HOUR)), id);
}

tx(() => {
  const postRows = all('SELECT id, author_id FROM posts');
  const people = [asha, david, juma, neema, baraka, grace, peter, fatma, zuberi, mary, salim, mobilehub, kanga];
  for (const p of postRows) {
    for (const u of people) {
      if (u !== p.author_id && rand() < 0.35) run('INSERT OR IGNORE INTO likes (user_id, post_id, created_at) VALUES (?,?,?)', u, p.id, ago(8));
    }
    run('UPDATE posts SET like_count = (SELECT COUNT(*) FROM likes WHERE post_id = ?), share_count = ? WHERE id = ?', p.id, Math.floor(rand() * 6), p.id);
  }
  const C = (post: number, author: number, body: string) => {
    run('INSERT INTO comments (post_id, author_id, body, created_at) VALUES (?,?,?,?)', post, author, body, ago(5));
    run('UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?', post);
  };
  const byBody = (s: string) => get('SELECT id FROM posts WHERE body LIKE ?', `%${s}%`)!.id;
  C(byBody('mobile money reconciliation'), asha, 'This saves our finance team hours every week 🙌');
  C(byBody('mobile money reconciliation'), neema, 'Does it support TRA EFD receipts too?');
  C(byBody('Soko Finder'), asha, 'Nice work David! Send me the link, happy to review.');
  C(byBody('Soko Finder'), kilima, 'Great project — check out our Junior Frontend Developer opening!');
  C(byBody('300W mono'), mobilehub, 'Can you deliver 20 units to Arusha by Friday?');
  C(byBody('300W mono'), kariakoo, '@arushamobilehub yes — send us a message with your order.');
  C(byBody('kanga fabric'), kanga, 'We stock wholesale kanga — message us!');
  C(byBody('Soil testing season'), baraka, 'Highly recommend — it made a big difference for our cooperative.');
});

// ───── announcement (price update) ─────
{
  const product = get('SELECT * FROM products WHERE id = ?', productIds.oil)!;
  const text = `Sunflower oil price update\n\nSunflower Cooking Oil 20L: TZS 82,000 → TZS 88,000 starting 2026-11-15.\n\nDue to higher seed prices this season. Order before the 15th at the current price.`;
  const postId = createPost(actor(lakezone), { kind: 'announcement', body: text, data: { announcement_kind: 'price_increase', product_id: product.id } });
  const { id } = run(
    "INSERT INTO announcements (business_id, kind, title, body, product_id, old_price, new_price, currency, effective_date, post_id) VALUES (?, 'price_increase', ?, ?, ?, 82000, 88000, 'TZS', '2026-11-15', ?)",
    lakezone, 'Sunflower oil price update', 'Due to higher seed prices this season. Order before the 15th at the current price.', product.id, postId,
  );
  run("UPDATE posts SET data = json_set(data, '$.announcement_id', ?) WHERE id = ?", id, postId);
  run("INSERT OR IGNORE INTO saves (user_id, target_type, target_id) VALUES (?, 'product', ?)", homemart, product.id);
  emit('announcement.published', { announcementId: id });
}

// ───── applications ─────
tx(() => {
  const A = (job: string, applicant: number, stage: string, daysAgo: number, source: string) => {
    const j = get('SELECT * FROM jobs WHERE id = ?', jobIds[job])!;
    const [c] = loadCandidates([applicant]);
    const score = c ? scoreMatch(j, c).score : null;
    const created = sqlTime(-daysAgo * DAY);
    const { id } = run(
      'INSERT INTO applications (job_id, applicant_id, cover_letter, stage, match_score, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
      j.id, applicant, 'I am excited to apply for this role and believe my experience is a strong fit.', stage, score, source, created, created,
    );
    run("INSERT INTO application_events (application_id, stage, created_at) VALUES (?, 'applied', ?)", id, created);
    if (stage !== 'applied') run('INSERT INTO application_events (application_id, stage, created_at) VALUES (?,?,?)', id, stage, sqlTime(-(daysAgo - 1) * DAY));
    run("INSERT INTO analytics_events (owner_id, actor_id, type, target_type, target_id, source, created_at) VALUES (?, ?, 'application', 'job', ?, ?, ?)", j.company_id, applicant, j.id, source, created);
  };
  A('dev', asha, 'shortlisted', 2, 'recommended');
  A('jrdev', david, 'applied', 1, 'notification');
  A('dev', david, 'reviewing', 2, 'search');
  A('site', juma, 'interview', 5, 'notification');
  A('acct', neema, 'applied', 3, 'jobs_tab');
  A('agro', baraka, 'reviewing', 1, 'recommended');
  A('nurse', grace, 'final_review', 3, 'notification');
  A('solar', peter, 'shortlisted', 1, 'feed');
});

// ───── orders & reviews ─────
tx(() => {
  const O = (buyer: number, seller: number, items: [string, number][], status: string, daysAgo: number, method = 'mobile_money') => {
    const rows = items.map(([k, q]) => ({ p: get('SELECT * FROM products WHERE id = ?', productIds[k])!, q }));
    const subtotal = rows.reduce((s, r) => s + r.p.price * r.q, 0);
    const created = sqlTime(-daysAgo * DAY);
    const { id } = run(
      `INSERT INTO orders (buyer_id, seller_id, status, subtotal, currency, payment_method, payment_status, delivery_address, delivery_phone, created_at, updated_at)
       VALUES (?,?,?,?, 'TZS', ?, ?, ?, ?, ?, ?)`,
      buyer, seller, status, subtotal, method, status === 'delivered' ? 'paid' : 'pending', 'Sokoine Road, Arusha', '+255711000000', created, created,
    );
    for (const r of rows) run('INSERT INTO order_items (order_id, product_id, name, unit_price, qty) VALUES (?,?,?,?,?)', id, r.p.id, r.p.name, r.p.price, r.q);
    for (const s of ['pending', 'confirmed', 'shipped', 'delivered'].slice(0, ['pending', 'confirmed', 'shipped', 'delivered'].indexOf(status) + 1)) {
      run('INSERT INTO order_events (order_id, status, note, created_at) VALUES (?,?,?,?)', id, s, s === 'pending' ? 'Order placed' : null, created);
    }
    run('INSERT INTO transactions (order_id, amount, currency, method, status, reference, created_at) VALUES (?,?,?,?,?,?,?)', id, subtotal, 'TZS', method, status === 'delivered' ? 'succeeded' : 'pending', `OB-${id}-SEED`, created);
    return id;
  };
  const o1 = O(mobilehub, kariakoo, [['panel', 20]], 'delivered', 12, 'bank_transfer');
  O(mobilehub, kariakoo, [['phones', 3]], 'shipped', 2);
  const o3 = O(zuberi, mobilehub, [['spark', 1]], 'delivered', 9);
  O(mary, kanga, [['dress', 2], ['kanga', 3]], 'confirmed', 1);
  O(salim, agroshop, [['seeds', 5], ['fert', 2]], 'pending', 0, 'cash_on_delivery');
  run('INSERT INTO reviews (product_id, seller_id, order_id, user_id, rating, body) VALUES (?,?,?,?,5,?)', productIds.panel, kariakoo, o1, mobilehub, 'Panels arrived well packed and on time. Will reorder.');
  run('INSERT INTO reviews (product_id, seller_id, order_id, user_id, rating, body) VALUES (?,?,?,?,4,?)', productIds.spark, mobilehub, o3, zuberi, 'Good phone, fast service.');
});

// ───── conversations ─────
tx(() => {
  const conv = (a: number, b: number, context: Record<string, unknown>, msgs: [number, string][]) => {
    const { id } = run('INSERT INTO conversations (context, last_message, updated_at) VALUES (?,?,?)', context, msgs[msgs.length - 1][1], sqlTime(-HOUR));
    run('INSERT INTO conversation_members (conversation_id, user_id, last_read_at) VALUES (?,?,?)', id, a, sqlTime());
    run("INSERT INTO conversation_members (conversation_id, user_id, last_read_at) VALUES (?,?, '1970-01-01 00:00:00')", id, b);
    msgs.forEach(([s, body], i) => run('INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES (?,?,?,?)', id, s, body, sqlTime(-(msgs.length - i) * 20 * 60_000)));
  };
  conv(mobilehub, kariakoo, { type: 'product', id: productIds.panel, title: 'Solar Panel 300W Monocrystalline' }, [
    [mobilehub, 'Hello, can you deliver 20 panels to Arusha by Friday?'],
    [kariakoo, 'Yes, we can dispatch tomorrow by bus cargo. Delivery is TZS 60,000.'],
    [mobilehub, 'Great, I will place the order now.'],
  ]);
  conv(fatma, kanga, {}, [[fatma, 'Hi! Do you sell kanga fabric in bulk rolls?'], [kanga, 'Karibu! Yes — minimum 50 pieces. Which prints are you interested in?']]);
  conv(david, kilima, { type: 'job', id: jobIds.jrdev, title: 'Junior Frontend Developer' }, [[david, 'Hello, I applied for the Junior Frontend Developer role. Is a remote interview possible?']]);
});

// ───── analytics history (so dashboards have 30 days of data) ─────
tx(() => {
  const businesses = all('SELECT user_id FROM businesses').map((r) => r.user_id as number);
  const viewers = [asha, david, juma, neema, baraka, grace, peter, fatma, zuberi, mary, salim, null];
  const sources = ['feed', 'search', 'direct', 'map', 'notification'];
  const terms = ['solar', 'phones', 'software', 'cement', 'jobs arusha', 'kitenge', 'maize', 'laptop'];
  for (const b of businesses) {
    const weight = [kilima, kariakoo, mobilehub, serengeti].includes(b) ? 3 : 1;
    const prods = all('SELECT id FROM products WHERE seller_id = ?', b).map((r) => r.id);
    const bposts = all('SELECT id FROM posts WHERE author_id = ?', b).map((r) => r.id);
    for (let day = 0; day < 30; day++) {
      const ts = () => sqlTime(-day * DAY - Math.floor(rand() * DAY));
      const n = Math.floor(rand() * 6 * weight * (1 + (30 - day) / 30));
      for (let i = 0; i < n; i++) run("INSERT INTO analytics_events (owner_id, actor_id, type, source, created_at) VALUES (?,?, 'profile_view', ?, ?)", b, pick(viewers), pick(sources), ts());
      for (let i = 0; i < n * 2 && prods.length; i++) run("INSERT INTO analytics_events (owner_id, actor_id, type, target_type, target_id, source, created_at) VALUES (?,?, 'product_view', 'product', ?, ?, ?)", b, pick(viewers), pick(prods), pick(sources), ts());
      for (let i = 0; i < n * 4 && bposts.length; i++) run("INSERT INTO analytics_events (owner_id, actor_id, type, target_type, target_id, created_at) VALUES (?,?, 'post_impression', 'post', ?, ?)", b, pick(viewers), pick(bposts), ts());
      for (let i = 0; i < n * 2; i++) run("INSERT INTO analytics_events (owner_id, actor_id, type, source, created_at) VALUES (?,?, 'search_appearance', ?, ?)", b, pick(viewers), pick(terms), ts());
      if (rand() < 0.25 * weight) run("INSERT INTO analytics_events (owner_id, actor_id, type, target_type, target_id, created_at) VALUES (?,?, 'inquiry', 'product', ?, ?)", b, pick(viewers), prods.length ? pick(prods) : null, ts());
    }
  }
});

// ───── a pending verification request & an open report, so the admin queues have items ─────
tx(() => {
  const { id: docId } = run(
    "INSERT INTO documents (owner_id, kind, name, storage_key, mime, size, visibility) VALUES (?, 'business_registration', 'BRELA certificate (demo).pdf', 'missing-demo-file.pdf', 'application/pdf', 0, 'private')",
    agripro,
  );
  run('INSERT INTO verification_requests (user_id, document_ids, notes) VALUES (?,?,?)', agripro, [docId], 'BRELA registration attached. TIN available on request.');
  run("UPDATE businesses SET verification_status = 'pending' WHERE user_id = ?", agripro);
  const offer = get("SELECT id FROM posts WHERE body LIKE '%Bulk maize%'")!.id;
  run("INSERT INTO reports (reporter_id, target_type, target_id, reason, details) VALUES (?, 'post', ?, 'misleading', 'Price seems different when you call them.')", salim, offer);
});

run("INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, 'system', 'Welcome to OmniBiz', 'This is a demo workspace. Explore jobs, businesses and the marketplace.', '/')", admin);

// Fire the smart-notification engine for every seeded job, then rebuild search.
for (const id of Object.values(jobIds)) emit('job.published', { jobId: id });
await settle();
rebuildIndex();

const counts = get(`SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM products) AS products, (SELECT COUNT(*) FROM jobs) AS jobs,
  (SELECT COUNT(*) FROM posts) AS posts, (SELECT COUNT(*) FROM notifications) AS notifications`)!;
console.log(`Done: ${counts.users} users, ${counts.products} products, ${counts.jobs} jobs, ${counts.posts} posts, ${counts.notifications} notifications.`);
console.log('\nSign in with any of: asha, david, juma, neema, baraka, grace, peter, fatma (personal) · kilimatech, baharibuild, serengetisolar, safarihealth (company)');
console.log('kariakooelectronics, tangabuild, lakezonegrain (wholesaler) · arushamobilehub, zanzibarkanga, moshiagro (retailer) · zuberi, mary, salim (customer)');
console.log('Password for all demo accounts: OmniBiz2026   ·   Super admin: admin / OmniBizAdmin2026   ·   moderator, verifier / OmniBiz2026');
