/**
 * Prisma client singleton.
 *
 * Prisma 7 connects through a driver adapter rather than its own Rust engine,
 * so the connection string is passed here instead of living in
 * schema.prisma. `prisma.config.ts` holds the equivalent for the CLI.
 *
 * The singleton exists because Next.js reloads modules on every edit in
 * development, which would otherwise open a new connection pool each time
 * until Postgres refuses more.
 */
import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { env, isProduction } from "./env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

  return new PrismaClient({
    adapter,
    // Never enable the "query" level outside local debugging: query logs
    // contain phone numbers, ID hashes and customer coordinates.
    log: isProduction ? ["error"] : ["warn", "error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (!isProduction) globalForPrisma.prisma = prisma;
