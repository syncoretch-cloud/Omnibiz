# OmniBiz

One platform connecting people, companies, wholesalers, retailers and customers: a social feed, jobs and recruitment, a marketplace with orders, a business directory with maps, business announcements, smart notifications, messaging, analytics and an admin portal.

## Quick start

Requires **Node.js 23.6+** (developed on Node 26). No database server needed: it uses SQLite through Node's built-in `node:sqlite`.

```bash
npm install
npm run seed          # demo data (npm run seed -- --reset to wipe and reseed)
npm run dev           # API on :4000 + web app on :5173 with hot reload
```

To run it production-style on one port:

```bash
npm run build && npm start   # http://localhost:4000
```

On Windows you can also double-click `scripts/start-server.cmd` (output goes to `server/data/server.log`) and `scripts/stop-server.cmd`. The server serves the built app from `web/dist`, so run `npm run build` first.

Logins last until the browser closes unless "Keep me logged in" is ticked. Email/phone code verification at sign-up is off; set `CONTACT_VERIFICATION=on` to enable it.

### Look and feel

Instagram-inspired layout (stories, feed, Reels, Explore, profile grid) in the OmniBiz palette: midnight indigo, aubergine, royal plum, burnt terracotta, soft apricot, vanilla, ivory, dusty rose, mauve and beige. Surfaces are glass with neumorphic depth and clay controls over a photographic backdrop (`web/public/brand/`), in light and dark themes, with a start-up splash showing the logo.

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
| §11–15 Employment | Vacancies with skills, education, experience, salary, deadline and required documents. Matching notifies only suitable candidates. Jobs tab has Recommended, Latest, Nearby, Saved and Applied. The application wizard checks required documents. Recruitment dashboard has a drag-and-drop pipeline (Applied → Reviewing → Shortlisted → Interview → Final review → Accepted/Rejected); candidates are notified at each stage. |
| §20–21 Business alerts & smart notifications | Price changes, launches, openings, interruptions and offers. Audience = followers + people who saved or carted the product + people interested in that category nearby. Never a blast to everyone. |
| §22, §32 Search & AI search | Global full-text search with filters per result type. Natural-language parsing: "Find software companies around Arusha hiring junior developers" becomes companies + jobs · Arusha · entry level · "software developer". Typeahead suggestions. |
| §23 Map | Leaflet/OpenStreetMap: "Businesses near me" with company, wholesaler, retailer and job layers. Businesses set their location with a draggable pin. A precise location is only stored with the user's opt-in. |
| §24 Social | Follow, like, comment, share, save, repost, hashtags, mentions, direct messages with product/job/order context. |
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

- **Real payment collection.** Payment choices and transaction records exist; a mobile-money or card provider still needs connecting through its webhook (`server/src/modules/orders.ts`).
- **Real email and SMS delivery.** Messages go to the outbox; a provider worker is needed.
- **Language-model AI.** Job matching, CV analysis, natural-language search and the business assistant are rule-based and explainable. Each sits behind a single function that a model-backed version could replace.
- **Native mobile apps.** The web app is mobile-first and installable as a PWA, and the API supports bearer tokens (`x-client: mobile`) for a future React Native or Flutter app.
