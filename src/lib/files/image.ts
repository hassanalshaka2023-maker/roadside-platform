/**
 * Image validation and re-encoding.
 *
 * The client's Content-Type and filename are never trusted. The real type is
 * determined from magic bytes, and the image is then FULLY DECODED and
 * RE-ENCODED. That re-encode is what actually removes EXIF, GPS coordinates,
 * thumbnails, colour profiles and any appended payload - far more reliable
 * than trying to strip metadata field by field, and it also neutralises a
 * polyglot file that is both a valid JPEG and something executable.
 *
 * Error codes rather than messages are returned, so the caller renders them
 * through next-intl.
 */
import "server-only";

import sharp from "sharp";

import { env } from "../env";
import { loggerFor } from "../logger";

const log = loggerFor("files/image");

export type ImageErrorCode =
  | "EMPTY"
  | "TOO_LARGE"
  | "UNSUPPORTED_TYPE"
  | "HEIC_UNSUPPORTED"
  | "TOO_MANY_PIXELS"
  | "CORRUPT";

export class ImageProcessingError extends Error {
  constructor(readonly code: ImageErrorCode, detail?: string) {
    super(`Image rejected (${code})${detail ? `: ${detail}` : ""}`);
    this.name = "ImageProcessingError";
  }
}

/**
 * What we are willing to decode.
 *
 * `avif` and `heic` are both ISO-BMFF containers and look almost identical,
 * but they differ where it counts: AVIF is AV1-coded and this build of sharp
 * decodes it, while an iPhone's HEIC is HEVC-coded and it cannot.
 */
type DetectedType = "jpeg" | "png" | "webp" | "avif" | "heic" | "unknown";

/**
 * Identifies a file by its leading bytes.
 *
 * A .jpg extension proves nothing; a text file, a script or a Windows
 * executable renamed to .jpg all fail here.
 */
export function detectImageType(buffer: Buffer): DetectedType {
  if (buffer.length < 12) return "unknown";

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "png";
  }

  // WebP: "RIFF" ???? "WEBP"
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }

  // ISO-BMFF container: the MAJOR brand sits in the ftyp box at offset 8.
  // Only the major brand is read - "mif1" also turns up in AVIF's list of
  // compatible brands further along, and matching on that would misclassify
  // every AVIF as an undecodable HEIC.
  if (buffer.toString("ascii", 4, 8) === "ftyp") {
    const brand = buffer.toString("ascii", 8, 12);

    if (brand === "avif" || brand === "avis") return "avif";

    // HEVC-coded. This is what an iPhone produces by default.
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) {
      return "heic";
    }
  }

  return "unknown";
}

/** The MIME type we store. Always ours, never the client's. */
export const OUTPUT_MIME_TYPE = "image/jpeg";

export interface ProcessedImage {
  data: Buffer;
  mimeType: string;
  width: number;
  height: number;
}

/**
 * Validates and re-encodes an uploaded image.
 *
 * Output is JPEG rather than WebP on purpose: providers and customers here are
 * on old Android phones, and JPEG is the one format that is guaranteed to
 * render on every device that can open a browser at all. The bandwidth WebP
 * would save is not worth a photo that will not display for some users.
 */
export async function processUploadedImage(input: Buffer): Promise<ProcessedImage> {
  if (input.length === 0) throw new ImageProcessingError("EMPTY");

  if (input.length > env.UPLOAD_MAX_BYTES) {
    throw new ImageProcessingError("TOO_LARGE", `${input.length} bytes`);
  }

  const detected = detectImageType(input);

  if (detected === "heic") {
    // Verified on this build of sharp: HEVC-coded HEIC cannot be decoded
    // ("heifsave: Unsupported compression"). The upload widget converts HEIC
    // in the browser, where Safari can decode it natively, so this path is
    // only reached when that conversion was bypassed.
    throw new ImageProcessingError("HEIC_UNSUPPORTED");
  }

  if (detected === "unknown") {
    throw new ImageProcessingError("UNSUPPORTED_TYPE");
  }

  try {
    const pipeline = sharp(input, {
      // Decompression-bomb guard: a 100 KB PNG can declare 40000x40000 pixels
      // and exhaust memory when decoded. sharp refuses beyond this.
      limitInputPixels: env.UPLOAD_MAX_PIXELS,
      failOn: "error",
    });

    const metadata = await pipeline.metadata();
    if (!metadata.width || !metadata.height) {
      throw new ImageProcessingError("CORRUPT", "no dimensions");
    }

    const output = await pipeline
      // Applies the EXIF orientation, then discards it - so the image is
      // visually upright without carrying the tag that said so.
      .rotate()
      .resize({
        width: env.UPLOAD_MAX_DIMENSION,
        height: env.UPLOAD_MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      // sharp drops all metadata unless withMetadata() is called. It is not
      // called here, and must never be: that is what strips EXIF and GPS.
      .jpeg({ quality: 82, progressive: true, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

    return {
      data: output.data,
      mimeType: OUTPUT_MIME_TYPE,
      width: output.info.width,
      height: output.info.height,
    };
  } catch (error) {
    if (error instanceof ImageProcessingError) throw error;

    const message = error instanceof Error ? error.message : String(error);

    // sharp reports the pixel-limit refusal as a plain Error.
    if (/pixels|limitInputPixels|exceeds/i.test(message)) {
      throw new ImageProcessingError("TOO_MANY_PIXELS", message.slice(0, 120));
    }

    // Never log the file contents - only why the decode failed.
    log.warn({ reason: message.slice(0, 200) }, "image decode failed");
    throw new ImageProcessingError("CORRUPT", message.slice(0, 120));
  }
}
