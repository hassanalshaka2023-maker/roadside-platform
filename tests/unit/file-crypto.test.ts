import { describe, expect, it } from "vitest";

import {
  decryptFile,
  encryptFile,
  FileDecryptionError,
  HEADER_LEN,
  readKeyVersion,
  UnknownKeyVersionError,
} from "@/lib/files/crypto";

const PLAINTEXT = Buffer.from("a national ID scan would be here", "utf8");

describe("round trip", () => {
  it("decrypts back to exactly the original bytes", () => {
    const envelope = encryptFile(PLAINTEXT);
    expect(decryptFile(envelope)).toEqual(PLAINTEXT);
  });

  it("handles an empty file", () => {
    const envelope = encryptFile(Buffer.alloc(0));
    expect(decryptFile(envelope)).toEqual(Buffer.alloc(0));
  });

  it("handles binary content with every byte value", () => {
    const binary = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    expect(decryptFile(encryptFile(binary))).toEqual(binary);
  });

  it("handles a payload larger than one cipher block", () => {
    const large = Buffer.alloc(200_000, 0xab);
    expect(decryptFile(encryptFile(large))).toEqual(large);
  });
});

describe("the ciphertext is actually ciphertext", () => {
  it("does not contain the plaintext", () => {
    const envelope = encryptFile(PLAINTEXT);
    expect(envelope.includes(PLAINTEXT)).toBe(false);
  });

  it("produces a different ciphertext every time, from the random IV", () => {
    const a = encryptFile(PLAINTEXT);
    const b = encryptFile(PLAINTEXT);

    expect(a.equals(b)).toBe(false);
    // Both still decrypt to the same thing.
    expect(decryptFile(a)).toEqual(decryptFile(b));
  });

  it("carries the expected header", () => {
    const envelope = encryptFile(PLAINTEXT);
    expect(envelope.subarray(0, 4).toString("ascii")).toBe("RSF1");
    expect(envelope.length).toBe(HEADER_LEN + PLAINTEXT.length);
  });
});

describe("tamper detection", () => {
  it("rejects a flipped bit in the ciphertext", () => {
    const envelope = encryptFile(PLAINTEXT);
    envelope[HEADER_LEN + 3] ^= 0x01;

    expect(() => decryptFile(envelope)).toThrow(FileDecryptionError);
    expect(() => decryptFile(envelope)).toThrow(/authentication tag mismatch/);
  });

  it("rejects a modified auth tag", () => {
    const envelope = encryptFile(PLAINTEXT);
    // The tag sits at offset 18 (4 magic + 1 format + 1 version + 12 IV).
    envelope[18] ^= 0xff;
    expect(() => decryptFile(envelope)).toThrow(FileDecryptionError);
  });

  it("rejects a modified IV", () => {
    const envelope = encryptFile(PLAINTEXT);
    envelope[6] ^= 0xff;
    expect(() => decryptFile(envelope)).toThrow(FileDecryptionError);
  });

  it("rejects a truncated file", () => {
    const envelope = encryptFile(PLAINTEXT);
    expect(() => decryptFile(envelope.subarray(0, envelope.length - 4))).toThrow(
      FileDecryptionError,
    );
  });

  it("rejects appended bytes", () => {
    const envelope = Buffer.concat([encryptFile(PLAINTEXT), Buffer.from("extra")]);
    expect(() => decryptFile(envelope)).toThrow(FileDecryptionError);
  });

  it("rejects a file shorter than the header", () => {
    expect(() => decryptFile(Buffer.alloc(5))).toThrow(/shorter than/);
  });

  it("rejects something that is not an envelope at all", () => {
    const notOurs = Buffer.concat([
      Buffer.from("JUNK"),
      Buffer.alloc(HEADER_LEN + 10, 7),
    ]);
    expect(() => decryptFile(notOurs)).toThrow(/bad magic bytes/);
  });

  it("rejects an unknown envelope format version", () => {
    const envelope = encryptFile(PLAINTEXT);
    envelope.writeUInt8(99, 4);
    expect(() => decryptFile(envelope)).toThrow(/unsupported envelope format/);
  });
});

describe("key versions", () => {
  it("records the version used", () => {
    expect(readKeyVersion(encryptFile(PLAINTEXT, 1))).toBe(1);
    expect(readKeyVersion(encryptFile(PLAINTEXT, 2))).toBe(2);
  });

  it("decrypts a version 1 file after rotating to version 2", () => {
    // This is the whole point of versioning: yesterday's files must survive
    // today's rotation.
    const old = encryptFile(PLAINTEXT, 1);
    const fresh = encryptFile(PLAINTEXT, 2);

    expect(decryptFile(old)).toEqual(PLAINTEXT);
    expect(decryptFile(fresh)).toEqual(PLAINTEXT);
  });

  it("produces different ciphertext under different keys", () => {
    const v1 = encryptFile(PLAINTEXT, 1);
    const v2 = encryptFile(PLAINTEXT, 2);
    expect(v1.subarray(HEADER_LEN).equals(v2.subarray(HEADER_LEN))).toBe(false);
  });

  it("refuses to encrypt with a version that has no key", () => {
    expect(() => encryptFile(PLAINTEXT, 9)).toThrow(UnknownKeyVersionError);
  });

  it("refuses to decrypt a file whose key version was removed", () => {
    const envelope = encryptFile(PLAINTEXT, 1);
    // Claim it was encrypted with a key we do not hold.
    envelope.writeUInt8(9, 5);

    expect(() => decryptFile(envelope)).toThrow(UnknownKeyVersionError);
    expect(() => decryptFile(envelope)).toThrow(/Restore that key from backup/);
  });

  it("fails when a file is decrypted with the wrong key of a known version", () => {
    // Encrypted under v1, relabelled as v2: the tag will not verify.
    const envelope = encryptFile(PLAINTEXT, 1);
    envelope.writeUInt8(2, 5);
    expect(() => decryptFile(envelope)).toThrow(/authentication tag mismatch/);
  });
});
