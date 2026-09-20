import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertUploadsDirIsSafe,
  LocalDiskDriver,
  UnsafeUploadsDirError,
} from "@/lib/storage/local";
import {
  assertValidStorageKey,
  InvalidStorageKeyError,
  isValidStorageKey,
  StorageObjectNotFoundError,
} from "@/lib/storage/types";

const PROJECT_ROOT = "C:\\projects\\roadside-platform";

describe("assertUploadsDirIsSafe", () => {
  it("accepts a directory outside the project", () => {
    expect(() =>
      assertUploadsDirIsSafe("C:\\roadside-data\\uploads", PROJECT_ROOT),
    ).not.toThrow();
  });

  it("REFUSES a directory inside the project", () => {
    // The whole point: anything inside the project can end up served
    // statically or committed to git.
    expect(() =>
      assertUploadsDirIsSafe(join(PROJECT_ROOT, "uploads"), PROJECT_ROOT),
    ).toThrow(UnsafeUploadsDirError);
  });

  it("refuses the project root itself", () => {
    expect(() => assertUploadsDirIsSafe(PROJECT_ROOT, PROJECT_ROOT)).toThrow(
      UnsafeUploadsDirError,
    );
  });

  it("refuses a nested directory deep inside the project", () => {
    expect(() =>
      assertUploadsDirIsSafe(join(PROJECT_ROOT, "public", "uploads"), PROJECT_ROOT),
    ).toThrow(UnsafeUploadsDirError);
  });

  it("refuses anything with a public segment, even outside the project", () => {
    expect(() =>
      assertUploadsDirIsSafe("C:\\www\\public\\uploads", PROJECT_ROOT),
    ).toThrow(/public/);
  });

  it("refuses a relative path", () => {
    expect(() => assertUploadsDirIsSafe("./uploads", PROJECT_ROOT)).toThrow(
      /absolute/,
    );
  });

  it("is not fooled by traversal that lands back inside the project", () => {
    const sneaky = join(PROJECT_ROOT, "..", "roadside-platform", "uploads");
    expect(() => assertUploadsDirIsSafe(sneaky, PROJECT_ROOT)).toThrow(
      UnsafeUploadsDirError,
    );
  });

  it("explains why, naming both paths", () => {
    try {
      assertUploadsDirIsSafe(join(PROJECT_ROOT, "uploads"), PROJECT_ROOT);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(String(error)).toContain("inside the project directory");
    }
  });
});

describe("storage key validation", () => {
  it("accepts a UUID", () => {
    expect(isValidStorageKey(randomUUID())).toBe(true);
  });

  it.each([
    ["parent traversal", "../../etc/passwd"],
    ["traversal inside a uuid", "../3f2504e0-4f89-41d3-9a0c-0305e82c3301"],
    ["forward slash", "a/b"],
    ["backslash", "a\\b"],
    ["absolute windows path", "C:\\Windows\\System32\\config\\SAM"],
    ["absolute posix path", "/etc/shadow"],
    ["empty", ""],
    ["not a uuid", "hello"],
    ["uuid with a suffix", "3f2504e0-4f89-41d3-9a0c-0305e82c3301.jpg"],
    ["uuid with a prefix", "x3f2504e0-4f89-41d3-9a0c-0305e82c3301"],
    ["null byte", "3f2504e0-4f89-41d3-9a0c-0305e82c3301\u0000.png"],
    ["nil uuid has an invalid version nibble", "00000000-0000-0000-0000-000000000000"],
  ])("rejects %s", (_label, key) => {
    expect(isValidStorageKey(key)).toBe(false);
    expect(() => assertValidStorageKey(key)).toThrow(InvalidStorageKeyError);
  });

  it("never echoes the offending key into the error message", () => {
    // It would land in a log line otherwise.
    const secretish = "../../../home/deploy/.ssh/id_rsa";
    try {
      assertValidStorageKey(secretish);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(String(error)).not.toContain(secretish);
      expect(String(error)).toContain("Invalid storage key");
    }
  });
});

describe("LocalDiskDriver", () => {
  let root: string;
  let driver: LocalDiskDriver;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "roadside-storage-"));
    driver = new LocalDiskDriver(root, PROJECT_ROOT);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses to construct with an unsafe directory", () => {
    expect(() => new LocalDiskDriver(join(PROJECT_ROOT, "uploads"), PROJECT_ROOT)).toThrow(
      UnsafeUploadsDirError,
    );
  });

  it("stores and returns bytes unchanged", async () => {
    const key = randomUUID();
    const data = Buffer.from([0, 1, 2, 250, 251, 255]);

    await driver.put(key, data);
    expect(await driver.get(key)).toEqual(data);
  });

  it("writes the file under exactly the key name, with no extension", async () => {
    const key = randomUUID();
    await driver.put(key, Buffer.from("x"));

    expect(readFileSync(join(root, key)).toString()).toBe("x");
  });

  it("leaves no temp files behind after a write", async () => {
    const { readdirSync } = await import("node:fs");
    const key = randomUUID();
    await driver.put(key, Buffer.alloc(1024, 7));

    expect(readdirSync(root).filter((name) => name.endsWith(".tmp"))).toHaveLength(0);
  });

  it("overwrites an existing key atomically", async () => {
    const key = randomUUID();
    await driver.put(key, Buffer.from("first"));
    await driver.put(key, Buffer.from("second"));

    expect((await driver.get(key)).toString()).toBe("second");
  });

  it("reports existence correctly", async () => {
    const key = randomUUID();
    expect(await driver.exists(key)).toBe(false);

    await driver.put(key, Buffer.from("here"));
    expect(await driver.exists(key)).toBe(true);
  });

  it("throws StorageObjectNotFoundError for a missing object", async () => {
    await expect(driver.get(randomUUID())).rejects.toThrow(StorageObjectNotFoundError);
  });

  it("deletes, and deleting twice is not an error", async () => {
    const key = randomUUID();
    await driver.put(key, Buffer.from("bye"));

    await driver.delete(key);
    expect(await driver.exists(key)).toBe(false);

    await expect(driver.delete(key)).resolves.toBeUndefined();
  });

  it("refuses a traversal key on every operation", async () => {
    const evil = "../escaped";

    await expect(driver.put(evil, Buffer.from("x"))).rejects.toThrow(
      InvalidStorageKeyError,
    );
    await expect(driver.get(evil)).rejects.toThrow(InvalidStorageKeyError);
    await expect(driver.delete(evil)).rejects.toThrow(InvalidStorageKeyError);
    await expect(driver.exists(evil)).rejects.toThrow(InvalidStorageKeyError);
  });
});
