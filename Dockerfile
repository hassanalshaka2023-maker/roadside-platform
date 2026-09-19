# syntax=docker/dockerfile:1
#
# Najdat Al-Tariq 24 - production image
#
# Debian slim rather than Alpine: @node-rs/argon2 and the pg driver ship
# prebuilt glibc binaries, and musl would mean building them from source.
#
# NOTE: this file has NOT been built or run yet - Docker is not installed on
# the development machine. Verify it before the first deployment.

# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---------------------------------------------------------------------------
# Dependencies. Split from the build so a source-only change does not reinstall
# every package.
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------
# Build. Also used as the migration/seed image: it has the Prisma CLI and tsx.
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx prisma generate

# Real secrets do not exist at image build time, and baking them in would be a
# mistake anyway. src/lib/env.ts honours this flag during a build only.
ENV SKIP_ENV_VALIDATION=1
ENV NODE_ENV=production
RUN npm run build

# ---------------------------------------------------------------------------
# Runtime. Only the standalone server and its traced dependencies.
FROM base AS runner
ENV NODE_ENV=production

# Never run the app as root.
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# The standalone build emits its own minimal server.
CMD ["node", "server.js"]
