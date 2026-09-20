/**
 * Local disk driver - development only.
 *
 * Two safety properties matter here:
 *
 *  1. The directory MUST be outside the project. Anything inside risks being
 *     picked up by the bundler, served as a static asset, or swept into a git
 *     commit. The constructor refuses to start otherwise, loudly, rather than
 *     discovering it after ID scans are already on disk.
 *
 *  2. Writes are atomic: content goes to a temp file in the same directory
 *     and is then renamed. A crash mid-write leaves either nothing or a
 *     complete file, never a half-written one that would fail to decrypt.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { rename, readFile, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { loggerFor } from "../logger";
import {
  assertValidStorageKey,
  StorageObjectNotFoundError,
  type StorageDriver,
} from "./types";

const log = loggerFor("storage/local");

export class UnsafeUploadsDirError extends Error {
  constructor(message: string) {
    super(`Refusing to use UPLOADS_DIR: ${message}`);
    this.name = "UnsafeUploadsDirError";
  }
}

/**
 * Validates a candidate uploads directory against the project root.
 *
 * Exported so it can be unit tested without touching the filesystem.
 */
export function assertUploadsDirIsSafe(uploadsDir: string, projectRoot: string): void {
  if (!isAbsolute(uploadsDir)) {
    throw new UnsafeUploadsDirError(`"${uploadsDir}" is not an absolute path`);
  }

  const target = resolve(uploadsDir);
  const root = resolve(projectRoot);

  // `relative` gives a path that starts with ".." when target is outside root.
  // An empty result means the two are the same directory.
  const rel = relative(root, target);
  const isInsideProject = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));

  if (isInsideProject) {
    throw new UnsafeUploadsDirError(
      `"${target}" is inside the project directory ("${root}"). ` +
        `Private uploads must live outside the project so they cannot be served ` +
        `statically or committed to git. Use something like C:\\roadside-data\\uploads.`,
    );
  }

  // Belt and braces: even outside the project, never a directory called public.
  const segments = target.split(sep).map((segment) => segment.toLowerCase());
  if (segments.includes("public")) {
    throw new UnsafeUploadsDirError(
      `"${target}" contains a "public" path segment. These files are private ` +
        `and must never sit in anything named public.`,
    );
  }
}

export class LocalDiskDriver implements StorageDriver {
  readonly name = "local";
  private readonly root: string;

  constructor(uploadsDir: string, projectRoot: string = process.cwd()) {
    assertUploadsDirIsSafe(uploadsDir, projectRoot);
    this.root = resolve(uploadsDir);

    if (!existsSync(this.root)) {
      mkdirSync(this.root, { recursive: true, mode: 0o700 });
      log.info("created uploads directory");
    }
  }

  /** The absolute path for a key. Only ever called after key validation. */
  private pathFor(key: string): string {
    assertValidStorageKey(key);
    return join(this.root, key);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const target = this.pathFor(key);
    // Temp file in the SAME directory, so the rename stays on one filesystem
    // and is therefore atomic.
    const temp = `${target}.${randomUUID()}.tmp`;

    try {
      await writeFile(temp, data, { mode: 0o600 });
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {});
      throw error;
    }
  }

  async get(key: string): Promise<Buffer> {
    const target = this.pathFor(key);
    try {
      return await readFile(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new StorageObjectNotFoundError();
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }
}
