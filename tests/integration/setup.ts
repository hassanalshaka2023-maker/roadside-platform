/**
 * Integration-test environment: the same fakes as the unit tests, except
 * DATABASE_URL points at the real *_test database.
 */
import "../setup";

// Plain .mjs helper shared with scripts/prepare-test-db.mjs.
import { testDatabaseUrl } from "../../scripts/test-db-url.mjs";

process.env.DATABASE_URL = (testDatabaseUrl as () => string)();
process.env.RATE_LIMIT_DRIVER = "memory";
