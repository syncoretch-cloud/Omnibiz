# OmniBiz

One platform connecting people, companies, wholesalers, retailers and customers: a social feed, jobs and recruitment, a marketplace with orders, a business directory with maps, business announcements, smart notifications, messaging, analytics and an admin portal.

## Quick start

Requires **Node.js 23.6+** (developed on Node 26). No database server needed: it uses SQLite through Node's built-in `node:sqlite`.

```bash
npm install
npm run seed          # demo data (npm run seed -- --reset to wipe and reseed)
npm run dev           # API on :4000, web app on :5173, OmniBiz Manager on :5180, all with hot reload
```

To run it production-style on one port:

```bash
npm run build && npm start   # http://localhost:4000
```

On Windows you can also double-click `scripts/start-server.cmd` (output goes to `server/data/server.log`) and `scripts/stop-server.cmd`. The server serves the built app from `web/dist`, so run `npm run build` first.

**OmniBiz Manager.** `admin/` is a separate staff app that uses the same API and accounts as the main app. In development it runs on http://localhost:5180. Whenever the server is running and the Manager has been built (`npm run build:admin`), the server also serves it on **http://localhost:4001** (`MANAGER_PORT=0` turns that off). `npm run host` builds both apps and starts the server; `scripts/omnibiz.service.example` shows how to keep it running in the background and start it at login. Sign in with an account whose `role` is not `user`; roles and what each can do are in `server/src/lib/permissions.ts`. It covers users (suspend, restore, remove, roles), content moderation, reports, verification, blocked words, plans and billing, categories, broadcasts and the audit log. For a real deployment, host `admin/dist` on its own domain proxying `/api` to the server; set `VITE_APP_URL` (public app) and `VITE_ADMIN_URL` (in `web`) at build time so the two link to each other.

**Automatic moderation.** New posts, comments, products, jobs and bios are checked against two word lists kept in the database (starting lists in `server/src/db/moderation-terms.json`, edited in the Manager): *blocked* terms are rejected with an error, *review* terms are saved but hidden until a moderator releases them. Matching is on whole words, ignores case, and catches look-alikes such as `p0rn` and stretched letters. The English lists were built from the open-source LDNOOBW list and then sorted by hand; the Swahili terms are a short starter that a native speaker should extend. Images are not checked.

**Paid verification.** Any account that can post (people and businesses) can pay a fee and send ID or registration documents. Staff approve or reject in the Manager. A verified account gets the badge and ranks higher in feeds. The fee is set in the Manager (Plans & billing). Like subscriptions, payment runs in test mode until a provider is connected.

**Subscriptions.** Plans live in the `plans` table, one set per account type, and are edited from OmniBiz Manager (price, features, product and job limits, on/off). Limits are enforced when products or jobs are created. Personal and customer paid plans start switched off until pricing is decided.

Logins last until the browser closes unless "Keep me logged in" is ticked. Email/phone code verification at sign-up is off; set `CONTACT_VERIFICATION=on` to enable it.

### Look and feel

A **deep-blue dark theme**, Inter type, flat surfaces with hairline borders, and a soft blue glow along the top of each screen.
- **Computers and tablets:** a constant icon-only rail on the left, and the page takes everything beside it.
  - **Rail:** the logo mark, Create, the destinations (labels appear as tooltips, and each icon plays a small animation as the pointer passes), then your profile picture and a More (☰) menu with settings, saved, orders and log out.
  - **Content:** a header with the page title, a back arrow on inner pages, and search (also `/`, ⌘K or Ctrl K). Your profile opens in the middle like any other tab; the rail never moves.
  - **Keyboard:** `?` lists the shortcuts (`j` / `k` move between posts, `l` likes, `g` then a letter goes to a page).
- **Phones:** a sticky top bar that hides as you scroll down, the page, and a floating dock: Home, Discover, Create, Market, Jobs. Pull down on Home to refresh; tap the current tab again to return to the top.
- **Tabs** are separate pills; the chosen one is blue.
- **Home:** a "Today" greeting, the stories strip, then the feed.
- **Market:** an **Ads** row of promotions, offers, new products and services from businesses sits above the products (businesses can use *Post an ad*). It hides while you search or filter.
- **Profiles:** no banner. The picture sits top-left, then name, @username and role, then the bio (emails and links are clickable), website and portfolio links, and counts. Your own CV is edited in the **CV** tab of your profile, where you can upload a PDF or Word file, add a link to a CV kept online (LinkedIn, Google Drive…), or both; each has its own visibility.
- **Settings** (every role): *Account* (profile picture or logo, saved as soon as you pick one, with a square crop; and an optional **Contact & links** card with a public email, phone and up to 8 links, all shown on your profile), *Professional* (personal accounts), *Business profile* (company, wholesaler and retailer), *Delivery* (a saved address that checkout starts from), *Interests* and *Security*.
- **Discover** is a bento grid of posts, products and jobs.
- **Brand:** the OmniBiz logo artwork (`web/public/brand/omnibiz-logo.png`, cut out of its background) appears wherever the name is shown: navigation, top bar, sign-in, onboarding, the splash and the browser tab (the "O" ring, `omnibiz-mark.png`).
- **Type:** Bricolage Grotesque for headings, titles, post text and stories; Plus Jakarta Sans for everything else.
- **Palette:** black surfaces with the brand colours (midnight indigo, aubergine, royal plum, burnt terracotta, soft apricot, vanilla, ivory) for accents and gradients.
- **Performance:** surfaces are solid rather than blurred glass, and the background is static, so scrolling stays at a steady frame rate. Blur is kept only for the top bar, the dock, and controls that float over photos and video.

Posting follows Instagram's flow: **select → crop → edit → share**.
- **Select:** up to 10 photos or videos.
- **Crop:** Original, 1:1, 4:5 or 16:9, with zoom, drag-to-reposition, a thirds grid, and reordering.
- **Edit:** 12 filters named after places in Tanzania, plus brightness, contrast, saturation, warmth, fade and vignette. Each photo is edited separately (`web/src/lib/imageEdit.ts`). One pipeline renders both the preview and the uploaded file.
- **Share:** caption with emoji, location, tagged people (they are notified), music, alt text, "hide like count" and "turn off commenting" (both enforced by the API).

Music comes from **OmniBiz Sounds** (`web/src/lib/music.ts`), 12 original loops in Afrobeats, Amapiano, Bongo Flava, lo-fi and chill styles. They are generated in the browser with the Web Audio API, so there is nothing to license. Authors can also upload their own audio and choose where it starts. Posts play their soundtrack on tap; Reels play it while on screen once sound is on.

Layouts follow the content rather than fixed device sizes: each page is a CSS container, so grids, side panels, filters, the post view and the messenger rearrange for the width they actually have (from 320px phones to wide monitors). Only the navigation shell switches by screen size.

On a demo database (the seeded `.test` accounts) the server keeps a set of demo stories live, sharing them again as they expire, so the stories strip is never empty (`server/src/services/demoStories.ts`). It never runs in production and can be turned off with `DEMO_STORIES=off`.

To run the end-to-end API tests (they use a throwaway database):

```bash
npm test
```

### Demo accounts

All demo accounts use the password `OmniBiz2026`.

| Account type | Usernames |
|---|---|
| Personal (job seekers) | `asha`, `david`, `juma`, `neema`, `baraka`, `grace`, `peter`, `fatma` |
| Company | `kilimatech`, `baharibuild`, `serengetisolar`, `safarihealth`, `mwanzaagripro`, `dodomafinance` |
| Wholesaler | `kariakooelectronics`, `tangabuild`, `lakezonegrain` |
| Retailer | `arushamobilehub`, `zanzibarkanga`, `moshiagro`, `dodomahomemart` |
| Customer | `zuberi`, `mary`, `salim` |
| Staff | `admin` (super admin, password `OmniBizAdmin2026`), `moderator`, `verifier` |

In development, emails and SMS are not actually sent. Verification and password-reset codes are printed in the API console and listed at `/api/dev/outbox`.

## What's built (mapped to the spec)

| Spec | Implementation |
|---|---|
| §1 Account system | Five account types share one sign-in: username/email/phone login, email and phone verification codes, recovery codes, optional TOTP two-factor auth (QR setup), and account deletion. |
| §2–3 Personal profile & CV | Professional profile, plus CV sections for experience, education, skills, certifications, languages and portfolio. Each entry is **Public**, **Recruiters only** or **Private**. Contact fields have their own visibility. Private document storage with per-document visibility. |
| §4, §31 Personalised feed | Interests are chosen at onboarding. The feed is ranked by interest weights (from selected interests, follows, searches, views, saves and applications), follows, locality, verified accounts, engagement and recency. Each post shows why it appears ("You follow…", "Near you…"). |
| §6–9 Company profile & posts | Profile combining website, social page, storefront and recruitment page; a map; post types (product, service, promotion, event, news, offer, hiring…); hashtags, mentions, reposts. |
| §10, §16–18 Products / wholesale / retail | Product listings with images and video, specifications, stock and availability, delivery and contact details. Wholesale adds minimum order quantity and packaging. Search, save, compare (2–4 products), contact seller. |
| §11–15 Employment | Vacancies with skills, education, experience, salary, deadline and required documents. Matching notifies only suitable candidates. Jobs tab has Recommended, Latest, Nearby, Saved and My applications. Apply sits after the requirements on a job page. The wizard lists what the employer asks for; anything missing can be skipped and the application saved as **unfinished**, then completed later. It is only sent to the company once every requirement is in (the server checks again). Your profile has an **Applications** tab with unfinished forms, applications waiting for a decision, and decided ones. Drafts are private: employers only ever see sent applications. Recruitment dashboard has a drag-and-drop pipeline (Applied → Reviewing → Shortlisted → Interview → Final review → Accepted/Rejected); candidates are notified at each stage. |
| §20–21 Business alerts & smart notifications | Price changes, launches, openings, interruptions and offers. Audience = followers + people who saved or carted the product + people interested in that category nearby. Never a blast to everyone. |
| §22, §32 Search & AI search | Global full-text search with filters per result type. Natural-language parsing: "Find software companies around Arusha hiring junior developers" becomes companies + jobs · Arusha · entry level · "software developer". Typeahead suggestions. |
| §23 Map | Leaflet/OpenStreetMap: "Businesses near me" with company, wholesaler, retailer and job layers. Businesses set their location with a draggable pin. A precise location is only stored with the user's opt-in. |
| §24 Social | Follow, like, comment, share, save, repost, hashtags, mentions, direct messages with product/job/order context. **Stories**: a photo, video or text card (with an optional caption and music) that disappears after 24 hours. Add one from Create or the story strip. The strip shows your story, then people you follow (unseen first), then suggested local accounts. Seen state is stored on the server. You can see who viewed your story and delete it; other people can reply or react by direct message. |
| §25 Analytics | Profile views, product views, post reach, engagement, followers, search appearances (with the terms used), inquiries, application sources, sales. Includes a trend chart, insights and a "business assistant" that answers questions like "Show me my best-performing products this month". |
| §26–27 Admin & verification | Role hierarchy: Super Admin → Admin → Moderator → Support → Verification. Users (suspend/restore, roles), content moderation, report queue, business verification with document review and Verified badge, categories, targeted broadcasts, audit log. |
| §28 Security | scrypt password hashing; HttpOnly SameSite cookies or bearer tokens for mobile clients; CSRF header guard; rate limits; lockout after 5 failed sign-ins; new-device sign-in alerts; session list and revocation; AES-256-GCM for 2FA secrets and registration numbers; access-checked private documents; spam limits; content auto-hidden after 3 reports. |
| §30 Permissions | Server-side permission check per account type (`server/src/lib/permissions.ts`), e.g. customers can't post and personal accounts can't post jobs. |
| §33 Commerce | Cart (split by seller) → checkout → payment method (cash on delivery, mobile money, bank transfer) → seller confirmation → shipped → delivered → reviews; stock is reserved at checkout and restored on cancellation. |

## Architecture

```
server/   Node + Express 5, TypeScript run natively by Node (no build step)
  src/db/          schema.sql (every §29 entity), data-access helpers, seed
  src/lib/         auth/sessions, validation, crypto, TOTP, rate limiting, event queue, storage, geo
  src/services/    feed ranking, job matching, personalisation, notification engine, search index, analytics
  src/modules/     one router per domain: auth, users, businesses, posts, products, jobs/recruitment,
                   announcements, notifications, messages, orders, search, analytics, admin, files, meta
  test/            end-to-end API tests
admin/    OmniBiz Manager (staff app): React + Vite, same API, reuses the web app's components (alias @web)
web/      React 19 + Vite + React Router, mobile-first and installable as a PWA, light/dark themes
```

The design follows §36–37: one modular codebase with clear boundaries, so pieces can be split out as usage grows.

| Concern | Today | Scale-out path (seam already in place) |
|---|---|---|
| Database | SQLite (WAL) via `db/index.ts` | PostgreSQL + read replicas; the SQL is plain and portable |
| Background work | In-process queue (`lib/queue.ts`: `emit`/`on`) | Redis Streams, SQS or Kafka with separate worker processes |
| Search | SQLite FTS5 (`services/search-index.ts`) | OpenSearch, Meilisearch or Typesense; same indexing calls |
| Files | Local disk; private docs outside the public path (`lib/storage.ts`) | S3/R2 + CDN with signed URLs |
| Rate limits / cache | In-memory | Redis |
| Email / SMS | Outbox table + console | Provider worker (SES/Postmark, Africa's Talking/Twilio/Beem) |
| Feed | Ranked per request | Precomputed candidate sets per user in a feed worker |
| Messaging | Polling | WebSocket/SSE gateway |

## Not yet included

- **Subscription billing.** Choosing a paid plan switches it on in test mode (`server/src/modules/subscriptions.ts`); no money is taken and nothing renews automatically until a payment provider is connected.
- **Real payment collection.** Payment choices and transaction records exist; a mobile-money or card provider still needs connecting through its webhook (`server/src/modules/orders.ts`).
- **Real email and SMS delivery.** Messages go to the outbox; a provider worker is needed.
- **Language-model AI.** Job matching, CV analysis, natural-language search and the business assistant are rule-based and explainable. Each sits behind a single function that a model-backed version could replace.
- **Native mobile apps.** The web app is mobile-first and installable as a PWA, and the API supports bearer tokens (`x-client: mobile`) for a future React Native or Flutter app.
