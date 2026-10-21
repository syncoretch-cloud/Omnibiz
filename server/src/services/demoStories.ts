// Demo stories: keeps the stories bar alive on a demo database. Stories expire after 24 hours, so each demo
// account's story is shared again (as if just posted) whenever its previous one has gone. Only the seeded demo
// accounts (".test" email addresses) are used, and never in production.
import { all, get, run, sqlTime, DAY, HOUR } from '../db/index.ts';
import { config } from '../config.ts';

const MINUTE = 60_000;
const music = (track: string, title: string) => ({ track, title, artist: 'OmniBiz Sounds', start: 0 });

/** username, text, background seed, minutes since it was "posted", optional music */
const DEMO: [string, string, string, number, ReturnType<typeof music>?][] = [
  ['kilimatech', 'We’re hiring junior developers in Arusha 🚀 Apply on our Jobs tab before 30 November.', 'midnight', 14, music('kilimanjaro-rise', 'Kilimanjaro Rise')],
  ['kilimatech', 'Code Kilima bootcamp graduation today. 120 new developers! 🎓', 'plum', 95],
  ['serengetisolar', '☀️ 10% off every solar home kit this week. Free site survey in Arusha and Moshi.', 'sunset', 32, music('serengeti-gold', 'Serengeti Gold')],
  ['arushamobilehub', 'New phones just landed 📱 Come try them in store, Sokoine Road.', 'ember', 48, music('dar-night-drive', 'Dar Night Drive')],
  ['zanzibarkanga', 'Fresh kanga prints for the festive season 🌺 Delivery across Tanzania.', 'rose', 70, music('zanzibar-breeze', 'Zanzibar Breeze')],
  ['kariakooelectronics', 'Wholesale prices on TVs and fridges all week. Minimum order 5 units.', 'vanilla', 130],
  ['safarihealth', 'Free health checks this Saturday, 9am to 2pm. Bring the whole family 💙', 'midnight', 180],
  ['baharibuild', 'Site visit: the new Mbezi apartments are 80% done 🏗️', 'ember', 240, music('uhuru-groove', 'Uhuru Groove')],
  ['moshiagro', 'Coffee seedlings and fertiliser back in stock ☕ Order by phone or here.', 'sunset', 300, music('arusha-coffee', 'Arusha Coffee')],
  ['david', 'First week at the new job. Grateful! 🙏', 'plum', 55, music('bongo-bounce', 'Bongo Bounce')],
  ['grace', 'Moshi mornings ☕🏔️', 'vanilla', 150, music('kilimanjaro-rise', 'Kilimanjaro Rise')],
  ['fatma', 'Sunset at Forodhani tonight 🌅', 'rose', 210, music('msasani-sunset', 'Msasani Sunset')],
  ['juma', 'Looking for logistics work in Dar. DM me! 🚚', 'midnight', 420],
];

export function refreshDemoStories(): number {
  if (config.isProd || process.env.DEMO_STORIES === 'off') return 0;
  const names = [...new Set(DEMO.map(([u]) => u))];
  const users = new Map(
    all(`SELECT id, username FROM users WHERE status = 'active' AND email LIKE '%.test' AND username IN (${names.map(() => '?').join(',')})`, ...names)
      .map((r) => [r.username as string, r.id as number]),
  );
  if (!users.size) return 0;
  let added = 0;
  for (const [username, body, bg, minutesAgo, track] of DEMO) {
    const author = users.get(username);
    if (!author) continue;
    if (get('SELECT 1 AS x FROM stories WHERE author_id = ? AND body = ? AND expires_at > ?', author, body, sqlTime())) continue;
    const age = minutesAgo * MINUTE;
    run(
      'INSERT INTO stories (author_id, media, body, style, created_at, expires_at) VALUES (?,?,?,?,?,?)',
      author, null, body, { bg, ...(track ? { music: track } : {}) }, sqlTime(-age), sqlTime(DAY - age),
    );
    added++;
  }
  return added;
}

/** Fills the stories bar at start-up and tops it up every half hour. */
export function startDemoStories() {
  const tick = () => {
    try {
      const n = refreshDemoStories();
      if (n) console.log(`[${new Date().toISOString()}] demo stories: shared ${n}`);
    } catch (e) {
      console.error('demo stories failed', e);
    }
  };
  tick();
  setInterval(tick, HOUR / 2).unref();
}
