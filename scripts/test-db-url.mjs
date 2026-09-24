/**
 * The integration-test database URL.
 *
 * TEST_DATABASE_URL if set; otherwise the real DATABASE_URL with "_test"
 * appended to the database name. Refuses anything whose name does not end in
 * "_test", so the integration suite - which deletes rows - can never point at
 * real data.
 *
 * Reads .env directly (without loading it into process.env), because the
 * unit-test setup has already replaced DATABASE_URL with a fake.
 */
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

export function testDatabaseUrl() {
  const file = existsSync(".env") ? parseEnv(readFileSync(".env", "utf8")) : {};

  const explicit = process.env.TEST_DATABASE_URL || file.TEST_DATABASE_URL;
  const base = explicit || file.DATABASE_URL || process.env.DATABASE_URL;
  if (!base) throw new Error("Set TEST_DATABASE_URL or DATABASE_URL");

  const url = new URL(base);
  if (!explicit) url.pathname = `${url.pathname.replace(/\/$/, "")}_test`;

  const name = url.pathname.slice(1);
  if (!name.endsWith("_test")) {
    throw new Error(`Refusing to run integration tests against "${name}": the name must end in _test`);
  }
  return url.toString();
}
