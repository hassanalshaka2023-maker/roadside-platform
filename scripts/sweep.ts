/**
 * Closes expired searches and expires stale offers.
 *
 * The app already does this lazily whenever a list or tracking page loads;
 * run this from cron (e.g. every minute) so searches also close when nobody
 * is looking:
 *
 *   * * * * *  cd /app && npm run jobs:sweep
 */
import { prisma } from "../src/lib/db";
import { sweepExpiredSearches } from "../src/features/requests/service";

async function main() {
  const closed = await sweepExpiredSearches();
  console.log(`closed ${closed} expired search(es)`);
}

main()
  .catch((error) => {
    console.error("sweep failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
