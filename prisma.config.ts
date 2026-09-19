import { defineConfig, env } from "prisma/config";

/**
 * Prisma CLI configuration.
 *
 * Prisma 7 removed `url` from the datasource block in schema.prisma and
 * stopped loading .env automatically, so both live here instead.
 *
 * `process.loadEnvFile()` is built into Node (20.6+), which saves adding
 * dotenv just so `prisma migrate` can read DATABASE_URL. It throws when the
 * file is absent - which is normal in CI and in Docker, where the variables
 * are already in the environment.
 */
try {
  process.loadEnvFile();
} catch {
  // No .env file: assume the environment is already populated.
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
