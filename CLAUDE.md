# Project: Roadside Assistance Platform (Syria)

## What we are building
A web platform in Syria, inspired by ADAC (German roadside assistance club). It connects two sides:
1. CUSTOMERS who request a service (towing, battery jump-start/replacement, tire change, fuel delivery, lockout, on-site mechanic, pre-purchase inspection).
2. PROVIDERS (tow truck drivers, mechanics, technicians) who apply to join, get vetted, and fulfill requests.
An ADMIN team reviews provider applications and dispatches requests MANUALLY at first (automatic matching comes later).

## Roles
- CUSTOMER: creates requests, tracks them, rates providers.
- PROVIDER: applies, and after approval receives and handles jobs.
- ADMIN: two levels. SUPER_ADMIN (everything, including viewing ID documents and settings) and DISPATCHER (requests and dispatch only, cannot view ID documents or change settings).

## Core flow (hybrid dispatch, decided 2026-09-25)
Customer submits request (service, map pin or landmark, car info, phone OTP, optional photos/ID per settings) -> approved, available providers in range see it (area + approximate distance only) and send priced offers -> customer accepts one (fee terms shown) -> on the way -> arrived -> in progress (extra costs need customer approval) -> provider marks done + cash received -> customer confirms (or disputes -> admin) -> completed -> rating. Admins can invite a specific provider, reassign, cancel and resolve disputes. No offer before the search window closes -> NO_PROVIDER_AVAILABLE, with an optional towing fallback. Payment is CASH. Commission exists but is disabled/zero; changes need advance notice and are snapshotted per request.
Request statuses: SEARCHING, CONFIRMED, ON_THE_WAY, ARRIVED, IN_PROGRESS, AWAITING_CONFIRMATION, COMPLETED, DISPUTED, CANCELLED_BY_CUSTOMER, CANCELLED_BY_PROVIDER, CANCELLED_BY_ADMIN, NO_PROVIDER_AVAILABLE, EXPIRED. Transitions are enforced by src/features/requests/state-machine.ts and every transition is logged.

## Tech stack
- Next.js (App Router) + TypeScript (strict) + Tailwind CSS with RTL support
- PostgreSQL + Prisma
- Auth: phone + OTP for customers/providers; email + password (argon2id) for admins; database-backed sessions in httpOnly cookies
- Maps: OpenStreetMap + Leaflet. Do NOT use Google Maps (billing may be unavailable in Syria)
- Files: storage abstraction (local disk in dev, S3-compatible in prod), always PRIVATE
- Validation: zod on every input
- i18n: next-intl. Arabic (RTL) is the default language, English is secondary
- Deploy: Docker + docker-compose on a VPS
- PWA (later phase)

## Conventions
- Feature-based folder structure, small reusable components, typed API layer
- All user-facing text goes through i18n. Arabic messages must be natural and simple
- Use Tailwind logical properties (ms-, me-, ps-, pe-, text-start) so RTL works properly
- Mobile-first and lightweight: users are on weak connections and old phones
- Every list has loading, empty, and error states
- Do not add a dependency without stating why

## Security rules (non-negotiable)
- ID documents and selfies are highly sensitive: private storage only, never in /public, served only through authenticated routes (SUPER_ADMIN), encrypted at rest, EXIF stripped, random filenames, every view written to AuditLog, and automatic deletion by retention policy
- RBAC enforced on the server for every route and action, never only in the UI. Middleware alone is not enough
- Rate limit OTP, login, and request creation. No user enumeration in error messages
- Never log OTP codes, full phone numbers, or document contents in production
- Security headers (CSP, HSTS, X-Frame-Options, Referrer-Policy), CSRF protection, secure cookies
- Secrets only in environment variables, and .env must never be committed

## Non-goals for the MVP
No online payments, no native mobile apps, no insurance features, no live GPS tracking or chat.

## Phases
1. Setup, Docker, Prisma schema, migrations, seed, auth, RBAC, i18n/RTL shell
2. Private file upload system (encryption, EXIF stripping, signed access, audit log)
3. Customer request flow + tracking page
4. Provider application flow + admin application pipeline
5. Admin dispatch panel + provider dashboard + status lifecycle
6. Notifications, ratings, settings, data-retention job, fraud signals
7. PWA, performance pass, security review, tests, deployment docs

## How to work with me
- Continue phase after phase without waiting for approval (decided 2026-09-25); give a short update and commit after each. Stop only for substantive decisions
- If something is ambiguous, ask me. Ask only what really matters, and make small assumptions explicit
- Before saying a phase is done: run typecheck, lint, and tests, and make sure the app actually runs
- At the end of each phase: summarize what was built, how to run and test it, decisions you made, and what you deliberately left for later. Then stop and wait
- Make small, meaningful git commits (but never commit secrets)
- Communicate with me in Arabic (simple and clear). Keep code, file names, commands, code comments, and commit messages in English

## Brand identity
- Brand name (Arabic, primary): نجدة الطريق 24  (full form: نجدة الطريق 24 ساعة)
- Latin/transliterated name for code, URLs and metadata: Najdat Al-Tariq 24 (spelling to be confirmed by me)
- Tagline: معك على الطريق دائماً
- Secondary slogans (use sparingly): خدمة موثوقة .. أينما كنت | معاً لطرق أكثر أماناً في سوريا | ثقتكم دافعنا للاستمرار
- Logo: gear + wrench above a road with speed lines, with a bold "24" and a red circular clock arrow. The real logo files go in public/brand/. NEVER redraw or approximate the logo. Until the files exist, use a text placeholder in a reusable <Logo /> component

### Colors (approximate, taken from the flyer; design/flyer.jpg is the visual reference)
- brand-yellow: #FFD400 (primary; hover #E6BC00; soft tint #FFF6C2)
- ink (near black): #0B0B0F (main dark background and text)
- navy: #0F1626 (secondary dark surfaces)
- brand-red: #E11D24 (accent for urgency: "24", call-now, alerts; dark #B3131A)
- white: #FFFFFF, plus a neutral gray scale
- Rules: text on yellow is ALWAYS black/ink, never white. Yellow is the primary CTA color. Red is used sparingly. Keep form pages and the admin panel light and readable; use the dark ink/navy look for the hero, header and footer

### Look and feel
- Bold, high-contrast, trustworthy, "road and rescue" feeling. Heavy Arabic headings (Cairo weight 800-900)
- Motifs: diagonal yellow/black hazard stripe as a divider, subtle road-line pattern, brush-stroke red accent behind key words. Keep them light so pages stay fast
- Icons: one consistent line-icon set (lucide), yellow on dark
- Tone of copy: warm, reassuring, simple Arabic

### Business info to show on the public site (configurable in Settings, not hardcoded)
- WhatsApp/phone numbers: 0938503705, 0992605513, 0981488760
- Floating WhatsApp/call button on public pages (mobile-first)
- Working hours: 24/7, all regions of Syria (as advertised)

### Provider roles advertised on the flyer (use these as the provider application options)
- ميكانيكي سيارات (auto mechanic)
- كهربائي سيارات (auto electrician)
- كومجي / بنشرجي (tire & puncture repair)
- سائق سطحة (tow truck driver)
- سائق تكسي / نقل أشخاص: DEFERRED (not offered in the application form)

## Current status

The full marketplace works locally (customer flow, offers, jobs, cash
completion, ratings, complaints, provider applications, provider panel, admin
panel). **docs/STATUS.md is the source of truth** for what is done, blocked and
next; update it at the end of every work session.

### Commands
```bash
npm run dev                              # http://localhost:3000 -> /ar
npm run db:migrate && npm run db:seed    # seed is idempotent; settings are never overwritten
npm test                                 # unit tests, no DB
npm run test:integration                 # real Postgres, *_test database only
npm run jobs:sweep                       # close expired searches (cron)
npm run files:cleanup -- --dry-run       # unattached uploads
npm run typecheck && npm run lint && npm run build
```
Admin: `/ar/admin/login` (credentials from `SEED_*` in `.env`). OTP codes print
to the dev server console. Demo provider `0960000004` (mechanic, Damascus).

### Key decisions
- **Next 16.3.5**: locale routing and nonce CSP live in `src/proxy.ts`;
  `experimental.useOffline` retries actions after a dropped connection (all
  mutations are idempotent for that reason).
- **Pinned deps**: Prisma 7.10.0 (CLI reads `prisma.config.ts`, runtime uses
  `@prisma/adapter-pg`) · Tailwind 3.4.19 (old phones) · `@node-rs/argon2`.
- **Local PostgreSQL 18, not Docker** (`C:\Program Files\PostgreSQL\18\bin\`).
- Money is integer SYP with DB CHECKs; accepted offers are frozen by a trigger;
  one ACCEPTED offer per request (partial unique index).
- Every mutation goes through `runAction` (src/lib/action-result.ts):
  CSRF + permission + rate limit; `DomainError` codes map to `domainErrors.*`
  messages, anything else is a generic technical error.
- Authorization asks for a **permission**, never a role; ownership is re-checked
  in services. Candidate providers never see the exact location or contact.
- Files: ID, selfie and tow-truck ownership docs are `viewIdDocuments` only,
  every view audited; request photos are visible to the booked provider during
  the job only.
- Python is not installed on this machine; use node for scripted edits.

### Known limitations
See docs/STATUS.md: no SMS gateway (blocks launch), map tiles not chosen,
no push notifications, cron not set up, Docker/S3 untested, legal texts are drafts.

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
