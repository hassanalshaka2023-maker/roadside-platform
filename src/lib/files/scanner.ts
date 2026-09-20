/**
 * Malware scanning.
 *
 * Nothing scans today. The interface exists so that adding ClamAV later is a
 * new class and one line in the factory, rather than a change to the upload
 * pipeline.
 *
 * Note that scanning is a second line of defence here, not the first: every
 * image is fully decoded and re-encoded before it is stored, which already
 * destroys any appended payload or polyglot trickery.
 */
import "server-only";

import { loggerFor } from "../logger";

const log = loggerFor("files/scanner");

export interface ScanResult {
  clean: boolean;
  /** Set when clean is false, e.g. the signature name from ClamAV. */
  threat?: string;
}

export interface FileScanner {
  readonly name: string;
  scan(data: Buffer): Promise<ScanResult>;
}

/**
 * Passes everything. Records that a scan step ran, so `scannedAt` means
 * "went through the scanner we had at the time", which is the honest claim.
 */
export class NoopFileScanner implements FileScanner {
  readonly name = "noop";

  async scan(data: Buffer): Promise<ScanResult> {
    log.debug({ bytes: data.length }, "noop scan");
    return { clean: true };
  }
}

/**
 * Placeholder for ClamAV via clamd. When implemented: open a socket to
 * CLAMAV_HOST/PORT, stream with INSTREAM, and map a FOUND response to
 * { clean: false, threat }. Fail CLOSED - a scanner that cannot be reached
 * must reject the upload, not wave it through.
 */

export const fileScanner: FileScanner = new NoopFileScanner();
