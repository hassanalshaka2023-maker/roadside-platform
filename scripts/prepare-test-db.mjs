/**
 * Creates the integration-test database if needed and applies migrations.
 * Run by `npm run test:integration`; never touches the development database.
 */
import { execSync } from "node:child_process";

import pg from "pg";

import { testDatabaseUrl } from "./test-db-url.mjs";

const url = new URL(testDatabaseUrl());
const name = url.pathname.slice(1);

const admin = new URL(url);
admin.pathname = "/postgres";

const client = new pg.Client({ connectionString: admin.toString() });
await client.connect();
const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
if (exists.rowCount === 0) {
  // Identifier cannot be parameterised; the name was validated to end in _test
  // and is quoted.
  await client.query(`CREATE DATABASE "${name.replace(/"/g, "")}"`);
  console.log(`created database ${name}`);
}
await client.end();

execSync("npx prisma migrate deploy", {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url.toString() },
});
