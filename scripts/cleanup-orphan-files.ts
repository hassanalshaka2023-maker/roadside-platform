/**
 * Deletes uploaded files that were never linked to a real record.
 *
 * Someone who starts a provider application, photographs their national ID
 * and then abandons the form leaves that scan on our disk attached to
 * nothing. This removes it.
 *
 * Run manually for now:
 *     npm run files:cleanup
 *     npm run files:cleanup -- --hours=1 --dry-run
 *
 * Phase 6 will schedule it. Until then, running it by hand is the retention
 * policy, so run it regularly on any deployment that has real uploads.
 */
import { cleanupOrphanFiles } from "../src/lib/files/service";
import { prisma } from "../src/lib/db";
import { env } from "../src/lib/env";

function parseArgs() {
  const args = process.argv.slice(2);
  const hoursArg = args.find((a) => a.startsWith("--hours="));
  return {
    hours: hoursArg ? Number(hoursArg.split("=")[1]) : env.ORPHAN_FILE_TTL_HOURS,
    dryRun: args.includes("--dry-run"),
  };
}

async function main() {
  const { hours, dryRun } = parseArgs();

  if (!Number.isFinite(hours) || hours <= 0) {
    console.error("--hours must be a positive number");
    process.exit(1);
  }

  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  console.log(`Orphan cleanup: unattached files created before ${cutoff.toISOString()}`);

  if (dryRun) {
    // Counts only - deliberately never touches storage in this mode.
    const candidates = await prisma.uploadedFile.findMany({
      where: { status: "UNATTACHED", deletedAt: null, createdAt: { lt: cutoff } },
      select: { id: true, kind: true, sizeBytes: true, createdAt: true },
      take: 500,
    });

    console.log(`DRY RUN - would delete ${candidates.length} file(s):`);
    for (const file of candidates) {
      console.log(`  ${file.id}  ${file.kind.padEnd(16)} ${file.sizeBytes} B  ${file.createdAt.toISOString()}`);
    }
    return;
  }

  const result = await cleanupOrphanFiles(hours);
  console.log(
    `examined ${result.examined}, deleted ${result.deleted}, failed ${result.failed}`,
  );

  // A partial failure means bytes may still be on disk. Exit non-zero so a
  // scheduler notices rather than reporting success.
  if (result.failed > 0) process.exit(1);
}

main()
  .catch((error) => {
    console.error("Cleanup failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
