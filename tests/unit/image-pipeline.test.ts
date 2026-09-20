import { describe, expect, it } from "vitest";
import sharp from "sharp";

import {
  detectImageType,
  ImageProcessingError,
  OUTPUT_MIME_TYPE,
  processUploadedImage,
} from "@/lib/files/image";

/** A plain JPEG of the given size. */
async function jpeg(width = 400, height = 300): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 60, b: 40 } },
  })
    .jpeg()
    .toBuffer();
}

/** A real AVIF, which this sharp build can decode. */
async function avif(): Promise<Buffer> {
  return sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 5, g: 5, b: 5 } },
  })
    .heif({ compression: "av1" })
    .toBuffer();
}

/**
 * An iPhone-style HEIC.
 *
 * sharp cannot ENCODE HEVC ("heifsave: Unsupported compression"), which is
 * the same reason it cannot decode one, so a genuine fixture is impossible to
 * produce here. Rewriting the major brand of an AVIF yields a file our
 * detector classifies exactly as it would a real one - which is what is under
 * test.
 */
async function fakeHeic(): Promise<Buffer> {
  const bytes = await avif();
  bytes.write("heic", 8, "ascii");
  return bytes;
}

/**
 * A JPEG carrying GPS coordinates in its EXIF, i.e. exactly the file a phone
 * camera produces and exactly what must never reach our storage.
 */
async function jpegWithGps(): Promise<Buffer> {
  return sharp({
    create: { width: 300, height: 200, channels: 3, background: { r: 10, g: 90, b: 160 } },
  })
    .withExif({
      IFD0: { Make: "TestCam", Model: "Phase2", Software: "vitest" },
      IFD3: {
        // 33.5138 N, 36.2765 E - central Damascus.
        GPSLatitudeRef: "N",
        GPSLatitude: "33/1 30/1 4968/100",
        GPSLongitudeRef: "E",
        GPSLongitude: "36/1 16/1 3540/100",
      },
    })
    .jpeg()
    .toBuffer();
}

describe("detectImageType", () => {
  it("identifies a real JPEG", async () => {
    expect(detectImageType(await jpeg())).toBe("jpeg");
  });

  it("identifies a real PNG", async () => {
    const png = await sharp({
      create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
    })
      .png()
      .toBuffer();
    expect(detectImageType(png)).toBe("png");
  });

  it("identifies a real WebP", async () => {
    const webp = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .webp()
      .toBuffer();
    expect(detectImageType(webp)).toBe("webp");
  });

  it("identifies AVIF, which we CAN decode", async () => {
    expect(detectImageType(await avif())).toBe("avif");
  });

  it("identifies an iPhone HEIC, which we CANNOT decode", async () => {
    expect(detectImageType(await fakeHeic())).toBe("heic");
  });

  it("does not mistake AVIF for HEIC because of the mif1 compatible brand", async () => {
    const bytes = await avif();
    // "mif1" really is in there, just not as the major brand.
    expect(bytes.includes(Buffer.from("mif1"))).toBe(true);
    expect(detectImageType(bytes)).toBe("avif");
  });

  it("does not trust an extension: a text file is not an image", () => {
    const text = Buffer.from("#!/bin/sh\nrm -rf /\n", "utf8");
    expect(detectImageType(text)).toBe("unknown");
  });

  it("rejects a Windows executable", () => {
    const exe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(64, 0x90)]);
    expect(detectImageType(exe)).toBe("unknown");
  });

  it("rejects a buffer too short to identify", () => {
    expect(detectImageType(Buffer.from([0xff, 0xd8]))).toBe("unknown");
  });
});

describe("processUploadedImage", () => {
  it("re-encodes to JPEG", async () => {
    const result = await processUploadedImage(await jpeg());
    expect(result.mimeType).toBe(OUTPUT_MIME_TYPE);
    expect(detectImageType(result.data)).toBe("jpeg");
  });

  it("accepts PNG input, always producing JPEG", async () => {
    const png = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 9, g: 9, b: 9 } },
    })
      .png()
      .toBuffer();

    const result = await processUploadedImage(png);
    expect(result.mimeType).toBe(OUTPUT_MIME_TYPE);
  });

  it("accepts AVIF input", async () => {
    const result = await processUploadedImage(await avif());
    expect(result.mimeType).toBe(OUTPUT_MIME_TYPE);
    expect(result.width).toBe(32);
  });

  it("keeps images within the maximum dimension", async () => {
    const huge = await jpeg(4000, 3000);
    const result = await processUploadedImage(huge);

    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(2000);
    // Aspect ratio preserved.
    expect(result.width / result.height).toBeCloseTo(4000 / 3000, 1);
  });

  it("does not enlarge a small image", async () => {
    const small = await jpeg(100, 80);
    const result = await processUploadedImage(small);
    expect(result.width).toBe(100);
    expect(result.height).toBe(80);
  });

  // --- the one that matters most -----------------------------------------
  it("STRIPS GPS coordinates and all other EXIF", async () => {
    const input = await jpegWithGps();

    // Sanity check: the fixture really does carry EXIF, otherwise this test
    // would pass for the wrong reason.
    const before = await sharp(input).metadata();
    expect(before.exif).toBeDefined();

    const result = await processUploadedImage(input);
    const after = await sharp(result.data).metadata();

    expect(after.exif).toBeUndefined();
    // And nothing survives as raw bytes either.
    expect(result.data.includes(Buffer.from("TestCam"))).toBe(false);
    expect(result.data.includes(Buffer.from("GPS"))).toBe(false);
  });

  it("does not carry the original ICC profile or XMP", async () => {
    const input = await jpegWithGps();
    const after = await sharp((await processUploadedImage(input)).data).metadata();

    expect(after.icc).toBeUndefined();
    expect(after.xmp).toBeUndefined();
  });

  it("rejects an empty buffer", async () => {
    await expect(processUploadedImage(Buffer.alloc(0))).rejects.toThrow(
      ImageProcessingError,
    );
    await expect(processUploadedImage(Buffer.alloc(0))).rejects.toMatchObject({
      code: "EMPTY",
    });
  });

  it("rejects a text file renamed to .jpg", async () => {
    const fake = Buffer.from("this is definitely not an image", "utf8");
    await expect(processUploadedImage(fake)).rejects.toMatchObject({
      code: "UNSUPPORTED_TYPE",
    });
  });

  it("rejects a file larger than the limit", async () => {
    // Bigger than UPLOAD_MAX_BYTES, with a valid JPEG header so the size
    // check is what rejects it rather than the type check.
    const oversized = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.alloc(9 * 1024 * 1024, 0),
    ]);
    await expect(processUploadedImage(oversized)).rejects.toMatchObject({
      code: "TOO_LARGE",
    });
  });

  it("rejects HEIC with a specific code, not a generic failure", async () => {
    // The user needs to be told to change their camera setting, which a
    // generic "corrupt image" message would never convey.
    await expect(processUploadedImage(await fakeHeic())).rejects.toMatchObject({
      code: "HEIC_UNSUPPORTED",
    });
  });

  it("rejects a decompression bomb", async () => {
    // Tiny on disk, enormous when decoded. The limit is 25 million pixels in
    // the test environment; 6000x6000 is 36 million.
    const bomb = await sharp({
      create: {
        width: 6000,
        height: 6000,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();

    await expect(processUploadedImage(bomb)).rejects.toMatchObject({
      code: "TOO_MANY_PIXELS",
    });
  });

  it("rejects a corrupt JPEG", async () => {
    const corrupt = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.from("garbage that is not a jpeg body", "utf8"),
    ]);
    await expect(processUploadedImage(corrupt)).rejects.toThrow(ImageProcessingError);
  });
});
