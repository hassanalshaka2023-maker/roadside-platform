# نجدة الطريق 24 — Najdat Al-Tariq 24

Roadside assistance platform for Syria. Customers request help (towing,
battery, tyres, fuel, lockout, on-site mechanic, pre-purchase inspection),
providers apply and are vetted, and an admin team dispatches manually.

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

### Customer login (OTP)

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

Seeded demo numbers: `0930000001`, `0940000002` (customers),
`0950000003`, `0960000004` (providers).

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | development server |
| `npm run build` | production build |
| `npm start` | serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest, once |
| `npm run test:watch` | Vitest, watching |
| `npm run db:migrate` | create/apply a migration (development) |
| `npm run db:deploy` | apply migrations (production) |
| `npm run db:seed` | run the seed |
| `npm run db:studio` | Prisma Studio |
| `npm run db:reset` | drop, re-migrate and re-seed — **destroys data** |
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

The tests never touch a database: Prisma and the SMS gateway are replaced with
in-memory fakes, and time is driven by fake timers.

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

## Notes and current limitations

- **SMS delivery is unsolved.** International gateways do not deliver to
  Syria. `SmsProvider` has a `console` driver (development) and a `stub` that
  throws, ready for a local aggregator. Nothing else in the app changes when a
  real gateway is connected.
- **Rate limiting** defaults to the in-memory driver, which is lost on restart
  and not shared between instances. Production must use
  `RATE_LIMIT_DRIVER=postgres`.
- **Map tiles are not chosen yet.** The CSP already allows the OpenStreetMap
  tile domains, but the public OSM tile server prohibits this kind of use —
  a keyed provider or a self-hosted Syria extract has to be decided in phase 3.
- Sensitive-file storage, the request flow, provider applications and dispatch
  are phases 2–5. The `/request` and `/apply` routes exist as honest
  placeholders so the primary calls to action are not dead links.
