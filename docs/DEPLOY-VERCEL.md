# Deploying to Vercel (free tier)

Good for a public demo and early testing. Read the limits first.

## Limits of the free setup

- **Vercel Hobby is for non-commercial use.** A paying business should move
  to Vercel Pro or a small VPS (the Docker files are in the repo).
- **Files cannot be stored on Vercel's disk.** Uploads (car photos, IDs) need
  an S3-compatible bucket. The S3 driver has not run against a real bucket
  yet: test uploads right after the first deploy.
- **Request bodies are capped at 4.5 MB** on Vercel: set `UPLOAD_MAX_BYTES=4194304`.
  Photos are compressed in the browser first, so this is rarely reached.
- **Cron runs once a day on Hobby** (`vercel.json`). Expired searches are
  also closed whenever a page loads, so this only matters for housekeeping.
- **Map tiles** come from the public OpenStreetMap server, fine for a demo,
  not for real traffic.
- Check that the site opens from Syrian networks (Syriatel, MTN) after deploying.

## 1. Accounts to create (all free)

1. **GitHub** - holds the code. Create an empty private repository.
2. **Vercel** - sign up with GitHub.
3. **Database**: in Vercel, *Storage > Create Database > Neon (Postgres)*.
   Vercel adds `DATABASE_URL` to the project automatically.
4. **File bucket** (S3-compatible), e.g. Supabase Storage or Backblaze B2.
   Note the endpoint, region, bucket name and access keys. Keep the bucket **private**.

## 2. Push the code

```bash
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin master
```
`.env` is ignored by git and is never pushed.

## 3. Import into Vercel

*Add New > Project >* pick the repository. Framework: Next.js. The build
runs `npm run vercel-build` (applies migrations, then builds).

## 4. Environment variables (Vercel > Settings > Environment Variables)

Generate secrets with `node scripts/generate-secrets.mjs` and paste them.

| Name | Value |
|---|---|
| `NODE_ENV` | `production` |
| `APP_URL` | `https://<your-project>.vercel.app` |
| `DATABASE_URL` | set by the Neon integration |
| `SESSION_SECRET`, `OTP_HMAC_SECRET`, `ID_HASH_SECRET` | from the script |
| `FILE_ENCRYPTION_KEYS`, `FILE_ENCRYPTION_ACTIVE_VERSION` | from the script |
| `CRON_SECRET` | from the script |
| `RATE_LIMIT_DRIVER` | `postgres` |
| `SMS_PROVIDER` | `stub` (no SMS gateway yet: phone sign-in is hidden) |
| `EMAIL_PROVIDER` | `smtp` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | `smtp.gmail.com` / `465` / `true` |
| `SMTP_USER` | the Gmail address |
| `SMTP_PASS` | the Gmail App Password |
| `EMAIL_FROM` | `نجدة الطريق 24 <the Gmail address>` |
| `STORAGE_DRIVER` | `s3` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | from the bucket provider |
| `S3_FORCE_PATH_STYLE` | `true` for most non-AWS providers |
| `UPLOAD_MAX_BYTES` | `4194304` |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_DISPATCHER_EMAIL`, `SEED_DISPATCHER_PASSWORD` | long, unique passwords |

Leave everything else at its default.

## 5. First data (admins, services, settings)

Once, from your computer, against the production database (no demo data is
created when `NODE_ENV=production`):

```bash
DATABASE_URL="<Neon connection string>" NODE_ENV=production SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... SEED_DISPATCHER_EMAIL=... SEED_DISPATCHER_PASSWORD=... npm run db:seed
```

## 6. Check after deploying

- `https://<site>/api/health` returns `{"status":"ok"}`.
- Sign in by email with a real address; the code arrives (check spam).
- Upload a photo in the request form (tests the bucket).
- Sign in at `/ar/admin/login`, open Settings, set the business phone numbers.
