# نجدة الطريق 24 — Najdat Al-Tariq 24

Roadside assistance platform for Syria. Customers request help (towing,
battery, tyres, fuel, lockout, on-site mechanic, pre-purchase inspection).
Approved providers nearby send priced offers, the customer accepts one, and
the job is tracked to a cash payment confirmed by both sides. Admins vet
providers, can invite a provider to a request, and resolve disputes.

What is done, what is blocked and what is next: **[docs/STATUS.md](docs/STATUS.md)**.

Arabic (RTL) is the primary language; English is secondary.

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22 LTS or newer | developed on 24.16 |
| npm | 10+ | pnpm is fine too, but the lockfile here is npm's |
| PostgreSQL | 16+ | developed against 18 |
| Docker | optional | only needed for the containerised setup |

---

## Setup

```bash
git clone <repo> roadside-platform
cd roadside-platform
npm install
```

### 1. Environment

```bash
cp .env.example .env
```

Then edit `.env`. Every variable is documented in `.env.example`, and
`src/lib/env.ts` validates them at boot — a missing or malformed value stops
the app immediately with a message naming the variable.

The two secrets must be real random values, not the placeholders:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Generate one for `SESSION_SECRET` and a **different** one for
`OTP_HMAC_SECRET`.

### 2. Database

**Option A — Docker (Postgres only, app runs locally with hot reload):**

```bash
docker compose -f docker-compose.dev.yml up -d
# DATABASE_URL=postgresql://roadside:roadside@localhost:5432/roadside?schema=public
```

**Option B — a local PostgreSQL install:**

```bash
createdb roadside
# DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/roadside?schema=public
```

On Windows, `createdb` and `psql` live in `C:\Program Files\PostgreSQL\18\bin\`
and are usually not on `PATH`. If your password contains `@ : / ? # [ ] %`,
URL-encode it (`p@ss` → `p%40ss`).

### 3. Migrate and seed

```bash
npm run db:migrate    # applies migrations
npm run db:seed       # idempotent - safe to run repeatedly
```

The seed creates:

- a **SUPER_ADMIN** and a **DISPATCHER** from `SEED_*` in `.env`
- the seven service types, with Arabic and English names
- default settings (customer ID mode, currency, business phone numbers,
  provider roles)
- and, when `NODE_ENV !== "production"`, demo customers, providers and
  requests in Damascus and Aleppo

### 4. Run

```bash
npm run dev          # http://localhost:3000 -> redirects to /ar
```

---

## Development accounts

Admin sign-in is at **`/ar/admin/login`**.

| Role | Email | Password |
|---|---|---|
| SUPER_ADMIN | value of `SEED_ADMIN_EMAIL` | value of `SEED_ADMIN_PASSWORD` |
| DISPATCHER | value of `SEED_DISPATCHER_EMAIL` | value of `SEED_DISPATCHER_PASSWORD` |

Both live in your `.env` and are deliberately **not** written down here — this
file is committed, `.env` is not. Change them before any real deployment; the
seed is idempotent, so re-running it applies the new password.

### Customer login (OTP by phone or email)

Until an SMS gateway is connected, people can also sign in with a code sent by
email. With `EMAIL_PROVIDER=console` the code prints in the dev terminal like
the SMS code; set `EMAIL_PROVIDER=smtp` and the `SMTP_*` variables (see
`.env.example` for Gmail and Brevo) to send real emails. In production
without SMS, set `SMS_PROVIDER=stub` and the phone option disappears.

Go to **`/ar/login`** and enter any valid Syrian mobile number
(`09XXXXXXXX`). With `SMS_PROVIDER=console` the code is printed to the
**server console** — the terminal running `npm run dev`, boxed like this:

```
  ┌─────────────────────────────────────────────
  │  SMS (development only)
  │  to:   +963 9** *** 705
  │  body: رمز الدخول إلى نجدة الطريق 24 هو: 123456 …
  └─────────────────────────────────────────────
```

The console driver **refuses to start in production**, so an OTP code can
never reach a production log.

Seeded demo numbers (development only, never seeded in production; every
demo name starts with `[تجريبي]`): `0930000001`, `0940000002` (customers),
`0950000003` (tow truck, Damascus), `0960000004` (mechanic, Damascus).
Both demo providers are approved and available, so a request placed near
Damascus shows up in their feed.

### Trying the whole flow locally

1. Customer: `/ar/request` on a phone-sized window, pin a spot in Damascus, verify a new number.
2. Provider: in another browser, sign in at `/ar/login` with `0960000004`, open the request, send an offer.
3. Customer: accept the offer on the tracking page (it refreshes on its own).
4. Provider: on the way → arrived → started → (optional extra cost) → finish with cash received.
5. Customer: confirm completion and payment, rate.
6. Admin: `/ar/admin` for figures, the request history, applications and settings.

### Admin accounts

Created by the seed from `SEED_ADMIN_*` / `SEED_DISPATCHER_*` in `.env`.
Use long random passwords, never commit `.env`, and re-run `npm run db:seed`
after changing them. There is no sign-up for admins.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | development server |
| `npm run build` | production build |
| `npm start` | serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | unit tests (no database) |
| `npm run test:integration` | integration tests on a separate `*_test` database, created and migrated automatically |
| `npm run jobs:sweep` | close expired searches (run from cron every minute in production) |
| `npm run test:watch` | Vitest, watching |
| `npm run db:migrate` | create/apply a migration (development) |
| `npm run db:deploy` | apply migrations (production) |
| `npm run db:seed` | run the seed |
| `npm run db:studio` | Prisma Studio |
| `npm run db:reset` | drop, re-migrate and re-seed — **destroys data** |
| `npm run files:cleanup` | delete unattached uploads (add `--dry-run`, `--hours=N`) |
| `npm run format` | Prettier |

---

## Tests

```bash
npm test
```

Covers phone normalization and masking (including Arabic-Indic digits), the
full OTP lifecycle (expiry, attempt limits, resend cooldown, single-use
consumption), both rate-limiter behaviours, the RBAC permission map, and admin
lockout.

The unit tests never touch a database. Since the marketplace work they also
cover the request state machine, money arithmetic, and every translation key.

```bash
npm run test:integration
```

Runs the business rules against real PostgreSQL: approval before work,
simultaneous acceptance (exactly one booking), extras without approval,
completion and cash, commission snapshots, the towing fallback and access
between users. It uses `TEST_DATABASE_URL`, or `DATABASE_URL` with `_test`
appended, and refuses any database whose name does not end in `_test`.

---

## Project structure

```
prisma/          schema, migrations, seed
messages/        ar.json (source of truth), en.json
docs/adr/        architecture decision records
src/
  app/[locale]/  routes: (public), admin, provider
  features/      auth, settings — actions, schemas, components
  lib/           env, db, auth, rate-limit, sms, phone, logger, audit
  components/    ui/ primitives and layout/ shells
  i18n/          next-intl routing and config
tests/           vitest
```

### The one rule that matters

**Middleware is not a security boundary.** `src/proxy.ts` does locale
routing and sets the CSP — nothing else. Every protected page, server action
and route handler calls its own guard from `src/lib/auth/current-user.ts`, and
those guards check the user's status on every request, so suspending someone
takes effect immediately rather than when their cookie expires.

Authorization asks for a **permission**, never a role:

```ts
await requirePermission(locale, "manageSettings", "admin");
```

The full map is in `src/lib/auth/permissions.ts`.

---

## Docker

```bash
cp .env.example .env     # fill in POSTGRES_PASSWORD, APP_URL, secrets
docker compose run --rm migrate    # migrate + seed, explicitly
docker compose up -d app
```

Migrations are a separate one-shot service on purpose: starting the app should
never silently change the schema.

> **Not yet verified.** Docker was not installed on the machine this was built
> on, so `Dockerfile`, `docker-compose.yml` and `docker-compose.dev.yml` are
> written but untested. Check them before the first real deployment.

---

## Private file storage

Uploaded images — above all national ID scans and selfies — never touch the
web root and are never served from a URL anyone can guess.

**The pipeline.** `POST /api/files?kind=ID_FRONT` takes the raw image bytes.
The size limit is enforced while the body streams in, not after buffering it.
The real file type is then determined from magic bytes (the client's
`Content-Type` and filename are ignored entirely), the image is fully decoded
and **re-encoded with sharp** — which is what actually strips EXIF, GPS
coordinates and any appended payload — resized to at most 2000px, encrypted
with AES-256-GCM, and written under a random UUID.

**Reading.** `GET /api/files/[id]` is the only way back in:

| Kind | Who can read it |
|---|---|
| `ID_FRONT`, `ID_BACK`, `SELFIE` | holders of `viewIdDocuments` (SUPER_ADMIN) — **not even the owner** |
| `REQUEST_PHOTO`, `EQUIPMENT_PHOTO` | the owner, SUPER_ADMIN and DISPATCHER |

Every view of an identity document writes an `AuditLog` row **before** any
bytes are sent, and if that write fails the request is refused — an
unrecorded view is worse than a denied one. Anonymous callers get 401;
everyone else gets the same 403 whether the file exists or not, so the
endpoint cannot be used to discover which IDs are real.

### File encryption keys — read this before deploying

`FILE_ENCRYPTION_KEYS` is a versioned list, `1:<base64url 32-byte key>`.
Each file records the version that encrypted it, so keys can be rotated by
adding a new version and moving `FILE_ENCRYPTION_ACTIVE_VERSION` to it.

> **Losing these keys means losing every uploaded file, permanently.**
> There is no recovery path: the ciphertext is useless without them.

Backing them up:

1. Store them **separately from the database backup**. A single archive
   containing both the encrypted files and the key is no better than storing
   the IDs in plain sight.
2. Keep an offline copy — a password manager entry, or printed and locked
   away. Not in the repository, not in the same cloud account as the server.
3. **Never delete an old key version** while any file still references it.
   Find them with `SELECT DISTINCT "keyVersion" FROM "UploadedFile" WHERE
   "deletedAt" IS NULL;`

### Unattached files

An upload arrives before the form that owns it is submitted, so it starts
`UNATTACHED`. Someone who photographs their ID and then abandons the form
leaves that scan attached to nothing, so it is deleted after
`ORPHAN_FILE_TTL_HOURS` (24 by default):

```bash
npm run files:cleanup -- --dry-run     # show what would go
npm run files:cleanup                  # delete them
```

Phase 6 will schedule this. **Until then, running it is the retention
policy** — put it on a timer on any deployment that has real uploads.

### Testing it by hand

With the dev server running, open **`/ar/dev/uploads`** (a page that 404s in
production). Log in first, then upload through each kind and follow the
"open via the API" links to see the access rules refuse or allow you.

To confirm the encryption is real, look at the stored file: it begins with
the bytes `RSF1` and no image viewer will open it.

---

## Notes and current limitations

- **SMS delivery is unsolved (blocks launch).** Several international
  gateways advertise Syriatel/MTN delivery (EasySendSMS, BudgetSMS, D7,
  SMS.to), none tested yet. `SmsProvider` has a `console` driver (development) and a `stub` that
  throws, ready for a local aggregator. Nothing else in the app changes when a
  real gateway is connected.
- **Rate limiting** defaults to the in-memory driver, which is lost on restart
  and not shared between instances. Production must use
  `RATE_LIMIT_DRIVER=postgres`.
- **Map tiles are not chosen yet.** `MAP_TILE_URL` defaults to the public OSM
  server, which forbids production traffic. The CSP follows whatever
  `MAP_TILE_URL` points to.
- **The S3 driver is untested.** No S3-compatible bucket was available while
  it was written, so `src/lib/storage/s3.ts` has never run against a real
  endpoint. Verify it before switching `STORAGE_DRIVER=s3` in production.
- **iPhone HEIC cannot be decoded server-side.** This build of sharp has no
  HEVC decoder. The upload widget converts HEIC to JPEG in the browser, where
  Safari decodes it natively, so this only bites if JavaScript is bypassed —
  and then the user gets a clear message telling them to switch the camera to
  "Most Compatible".
- **Malware scanning is a no-op.** `FileScanner` has the interface and
  records `scannedAt`, but nothing is actually scanned until ClamAV is wired
  in. Re-encoding every image already destroys appended payloads.
- **No push notifications yet.** Providers and customers see new requests and
  offers through pages that refresh every 20–30 seconds.
