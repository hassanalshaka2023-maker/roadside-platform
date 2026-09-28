# Project status

Last updated: 2026-09-28. Keep this file current: it is how work resumes
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
4. **Hosting**: Vercel steps in docs/DEPLOY-VERCEL.md (S3 driver verified against Supabase Storage on 2026-09-28 with `npm run storage:check`). Docker files untested on a real server.

## Not done yet (in priority order)

- Notifications (SMS or WhatsApp) to providers on new requests and to customers
  on new offers. Today both sides rely on auto-refreshing pages.
- Scheduled jobs: `npm run jobs:sweep` (every minute) and
  `npm run files:cleanup` need cron on the server. Searches also close lazily
  when pages load.
- ID-document retention job (automatic deletion).
- Committed e2e suite (Playwright) and CI.
- Admin UI to create more admin accounts (today: seed / `.env`). Each admin
  already changes their own email and password at `/admin/account`.
- PWA, performance pass.
