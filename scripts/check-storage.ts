/**
 * Round-trips one small object through the configured storage driver:
 * write, exists, read back, delete. Run it after setting S3_* in .env to make
 * sure the bucket works BEFORE real uploads depend on it:
 *
 *   npm run storage:check
 */
import { randomUUID } from "node:crypto";

import { env } from "../src/lib/env";
import { storage } from "../src/lib/storage";

async function main() {
  const key = randomUUID();
  const payload = Buffer.from(`najdat storage check ${new Date().toISOString()}`);
  console.log(`driver: ${env.STORAGE_DRIVER}${env.STORAGE_DRIVER === "s3" ? ` (bucket ${env.S3_BUCKET})` : ""}`);

  await storage.put(key, payload);
  console.log("put     ok");
  if (!(await storage.exists(key))) throw new Error("object not found right after writing it");
  console.log("exists  ok");
  const back = await storage.get(key);
  if (!back.equals(payload)) throw new Error("read-back content differs");
  console.log("get     ok (content matches)");
  await storage.delete(key);
  if (await storage.exists(key)) throw new Error("object still there after delete");
  console.log("delete  ok");
  console.log("Storage works.");
}

main().catch((error) => {
  console.error("Storage check FAILED:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
