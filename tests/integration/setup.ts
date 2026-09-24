/**
 * Integration-test environment: the same fakes as the unit tests, except
 * DATABASE_URL points at the real *_test database.
 */
import "../setup";

// @ts-expect-error - plain .mjs helper shared with the prepare script
import { testDatabaseUrl } from "../../scripts/test-db-url.mjs";

process.env.DATABASE_URL = (testDatabaseUrl as () => string)();
process.env.RATE_LIMIT_DRIVER = "memory";
