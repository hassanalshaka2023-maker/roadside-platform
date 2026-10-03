# Project status

Last updated: 2026-10-03. Keep this file current: it is how work resumes
without losing context.

## Decisions in force (2026-09-25)

- **Hybrid dispatch.** A request is visible to approved, available providers
  within range who offer the service; they send priced offers; the customer
  accepts one. Admins can invite a specific provider (who still has to offer)
  and can reassign or cancel.
- Work continues phase after phase without per-phase approval.
- All 7 services are offered. Passenger transport is deferred.
- Commission exists but is **disabled and zero**. Any change is announced to
  providers `commissionNoticeDays` (default 14) in advance and applies only to
  requests accepted after the effective date.
- Money is stored as **integer Syrian pounds**.
- **What candidate providers see (2026-10-03).** Governorate, the
  neighbourhood and nearest landmark the customer typed, approximate
  distance, towing destination, car and problem - enough to price the job.
  The exact map pin, photos, plate and the customer's name and phone stay
  hidden until the customer accepts that provider's offer. The request form
  tells the customer this under the location fields.

## Installable app (PWA) and lasting sign-in (added 2026-10-03)

Providers complained they had to sign in every time. Decision: a PWA inside
this project, not a native app for now (React Native / store listing stays an
option for later).

- **Sessions slide.** Customer/provider sessions renew (at most once a day)
  while used; `SESSION_TTL_CUSTOMER_DAYS` (30) is now an *idle* timeout.
  Their cookie lives 400 days because a page render cannot rewrite cookies;
  the database row decides expiry. Logic in `src/lib/auth/session-renewal.ts`.
  (This also fixed the admin renewal, which tried to set a cookie during
  page renders, where Next.js forbids it.)
- **Install.** `src/app/manifest.ts`, icons in `public/icons/` (regenerate
  with `node scripts/generate-pwa-icons.mjs`), `public/sw.js` (production
  only; never caches pages, cache-first for `/_next/static`, offline page
  `public/offline.html`). Bump `VERSION` in sw.js after changing it.
- **Install banner** (`InstallAppBanner`) on the provider area and the
  customer account page: Android gets the browser's install dialog, iPhone gets
  Share -> Add to Home Screen steps. Hidden once installed; "not now" hides it
  for 14 days.
- Links opened inside WhatsApp/Facebook keep their own cookies; installing the
  app (and signing in once inside it) is the fix to tell providers about.

## Provider password sign-in (added 2026-10-04)

- `/login` defaults to email-or-phone + password (`src/lib/auth/password-login.ts`);
  "sign in with a code" stays for first-time users and customers. Arriving
  with `next=/apply` starts on the code.
- Providers must have a password: the provider layout and `/apply` send
  anyone without one to `/account/password` first (existing providers set
  it on their next visit).
- `/forgot-password`: code to the account's email/phone (OTP purpose
  `PASSWORD_RESET`), new password, other sessions revoked, lockout cleared.
  Same answer whether or not the account exists.
- Phone + password uses the VERIFIED `phone` only, never `contactPhone`.
  Phone resets need the SMS gateway (see below); email works today.
- Same defences as staff login: generic error, dummy hash for unknown
  accounts, per-identifier/IP rate limits, lockout after 5 wrong tries.
- Logging out sends a provider to `/login`; the installed app opens
  `/launch`, which sends a signed-in provider straight to `/provider`.
  An app installed before this change may keep the old start page until
  Chrome refreshes the manifest (or it is reinstalled).

## Provider app focus, hotline prompt (added 2026-10-04)

- A signed-in provider never sees the customer side: home and `/request`
  redirect to `/provider`, the header's main button is "My dashboard", and
  "Join us" / "My requests" are hidden for them.
- After `noOfferHelpMinutes` (default 5) of searching with no offer, the
  owner's tracking page shows "Call us" with `hotlinePhone` (default
  0981488760) and WhatsApp. Both are in admin Settings > Contact.
- The floating WhatsApp button uses the real WhatsApp glyph.

## Push notifications (added 2026-10-03)

Web Push through the service worker; works in Chrome/Android in the browser
or installed, and on iPhone only from the installed app (iOS 16.4+).

- Off unless `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` are
  set (generate with `node scripts/generate-secrets.mjs`; never rotate).
- `PushSubscription` rows are tied to the session that created them: only
  signed-in devices of ACTIVE users are notified, so logout or suspension
  silences a device. Dead subscriptions (404/410) are deleted on send.
- `NotificationToggle` (permission asked only on tap): provider area,
  customer account page, and the owner's tracking page while it is open.
- Who gets what (`src/features/notifications/events.ts`, texts in
  `messages/*.json` under `push`):
  - providers: new nearby request (same eligibility as the feed, nearest 100,
    also on restart / reassign / provider drop-out), admin invite, offer
    accepted, booking cancelled, extra charge answered, completion
    confirmed or disputed;
  - customers: new offer, provider on the way / arrived / asking for
    confirmation, extra charge proposed, provider withdrew, search ended.
- Sent with `after()` once the response is out; never inside a transaction,
  never able to fail an action. Lock-screen safe: service, governorate and
  request code only - no names, phones, plates or pins.

## Email sign-in (added 2026-09-26)

While no SMS gateway exists, customers and providers can sign in with a code
sent by **email** (login page, request form, provider application). Same code
rules and rate limits as SMS. The account is keyed by the email; the phone
number they give is stored as `contactPhone`, shown to the booked provider
and admins **marked unverified**, and never used to find an account.
Staff emails get no code (and the screen does not reveal it).
Config: `EMAIL_PROVIDER=console|smtp|disabled` + `SMTP_*`. Phone sign-in is
hidden when `SMS_PROVIDER=stub`. Real SMTP delivery has not been tested yet
(needs your SMTP account). Accounts are not linked: signing in by email and
later by phone creates two accounts.

## Done and verified locally

| Area | What works |
|---|---|
| Request flow | Service → location (map, GPS, or "can't use the map" + landmark) → car/problem ("I don't know" option, towing destination) → phone OTP → photos/ID → send. Draft kept in localStorage; submit is idempotent (`clientRequestId`). |
| Offers | Eligibility (approved, active, available, service, distance, tow capacity, not busy), approximate distance only, offer limit, validity, withdraw. |
| Booking | Atomic accept: per-provider advisory lock + compare-and-swap + partial unique index. Accepted offer money frozen by a DB trigger. |
| Job | On the way (ETA) → arrived → in progress; extra charges need customer approval and block finishing while pending; "callout only" outcome; provider withdrawal (back to search before arrival). |
| Completion | Provider declares done + cash; customer confirms (or disputes); admin resolves disputes, amount changes audited. |
| No provider | Timeout sweep → `NO_PROVIDER_AVAILABLE`/`EXPIRED`; towing fallback only on explicit click, keeps location and car; never offered for a tow; "search again". |
| Ratings, complaints | Rating once, after completion, true average. Complaints by either party. |
| Provider applications | Draft / submit / needs-info / approve / reject / suspend with reasons and history; ID, selfie, tow-truck ownership document are admin-only, every view audited. |
| Provider panel | Availability, feed, offer form, job screen, history with earnings and commission ledger, profile (radius, hours, base). |
| Admin panel | Dashboard (service value kept apart from platform revenue), requests + detail (invite, reassign, cancel, resolve), applications, providers (services, ledger, settlement), users (suspend), complaints, settings (matching, contact, ID policy, cancellation text, commission schedule, services), audit log. |
| Other | Terms and privacy drafts, `/api/health`, offline banner + retry (`experimental.useOffline`), full Arabic/English messages checked by a unit test. |

## Tests

- `npm test` - 229 unit tests (state machine, money, permissions, files, messages...).
- `npm run test:integration` - 26 tests on a real `*_test` Postgres database:
  approval gate, concurrent double booking, provider double booking,
  idempotent create, frozen price, extras, completion, commission snapshot and
  notice, disputes, ratings, towing fallback, access between users.
- Browser walk-through (Chrome, 390px and 1366px): 43 steps passed (incl. email sign-in), including
  denied geolocation, draft after reload, full job lifecycle, towing fallback,
  offline banner, application → approval, dispatcher 404s and ID 403.
  The script lives outside the repo (it used a scratch `playwright-core`);
  turning it into a committed e2e suite is on the list below.

## Blockers for a real launch

1. **SMS gateway.** Only the `console` driver works; production has a stub
   that throws. Email sign-in now covers the gap once SMTP is configured. Candidates found (not tested, need an account and a
   compliance check with SYTRA): EasySendSMS, BudgetSMS, D7 Networks,
   SMS.to, Messaggio. Implement `SmsProvider` in `src/lib/sms/` once one is
   chosen and tested with real Syriatel and MTN numbers.
2. **Map tiles.** Default is the public OSM server, whose policy forbids
   production traffic. Choose a keyed provider or self-host a Syria extract
   and set `MAP_TILE_URL`.
3. **Legal review** of `/terms` and `/privacy` (drafts that describe actual behaviour).
4. **Hosting plan limits (measured 2026-09-29).** Live on Vercel Hobby + Prisma
   Postgres Free. Functions now run in fra1 next to the database (query
   latency 92 ms -> 3 ms). Two blockers for a real launch:
   - Vercel Hobby is for non-commercial use only; a marketplace needs Pro
     (or a VPS with the Docker files).
   - Prisma Postgres Free includes 200k operations/month. An available
     provider's dashboard refreshes every 30 s (~10 queries each), so a single
     provider online 8 h/day uses roughly 300k/month. Before launch: a paid
     database or a VPS, and a lighter "anything new?" check instead of full
     page refreshes (or push notifications).
   The code itself scales well past 1000 providers: the provider feed is one
   indexed bounding-box query capped at 50 rows.
5. **Hosting**: Vercel steps in docs/DEPLOY-VERCEL.md (S3 driver verified against Supabase Storage on 2026-09-28 with `npm run storage:check`). Docker files untested on a real server.

## Not done yet (in priority order)

- SMS or WhatsApp alerts as a fallback for people who have not turned on push
  notifications. With push on, pages could refresh far less often (or stop
  auto-refreshing), which also eases the database-hours limit above.
- Scheduled jobs: `npm run jobs:sweep` (every minute) and
  `npm run files:cleanup` need cron on the server. Searches also close lazily
  when pages load.
- ID-document retention job (automatic deletion).
- Committed e2e suite (Playwright) and CI.
- Admin UI to create more admin accounts (today: seed / `.env`). Each admin
  already changes their own email and password at `/admin/account`.
- Performance pass. Push is in place; SMS/WhatsApp alerts for people who
  never turn notifications on are still open.
