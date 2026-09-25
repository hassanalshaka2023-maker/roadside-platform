/**
 * Guards the translations: a missing key shows up to a customer as a raw
 * "wizard.dontKnow", so these checks run with every unit-test pass.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import ar from "../../messages/ar.json";
import en from "../../messages/en.json";
import { ALL_STATUSES } from "@/features/requests/state-machine";
import { VEHICLE_CATEGORIES } from "@/features/requests/schemas";
import { PROVIDER_SPECIALTIES } from "@/features/applications/schemas";

type Tree = { [key: string]: Tree | string | unknown[] };

function paths(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === "object" && !Array.isArray(value) ? paths(value as Tree, path) : [path];
  });
}

const AR = new Set(paths(ar as Tree));
const EN = new Set(paths(en as Tree));
const has = (key: string) => AR.has(key) || [...AR].some((k) => k.startsWith(`${key}.`));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(tsx?|mts)$/.test(name) ? [full] : [];
  });
}

const FILES = sourceFiles(join(__dirname, "../../src")).map((file) => ({ file, text: readFileSync(file, "utf8") }));

function literalUnion(file: string, typeName: string): string[] {
  const text = readFileSync(join(__dirname, "../../", file), "utf8");
  const block = text.slice(text.indexOf(`type ${typeName} =`));
  const end = block.indexOf(";");
  return [...block.slice(0, end).matchAll(/"([A-Za-z_]+)"/g)].map((m) => m[1]);
}

describe("messages", () => {
  it("has the same keys in Arabic and English", () => {
    expect([...AR].filter((k) => !EN.has(k))).toEqual([]);
    expect([...EN].filter((k) => !AR.has(k))).toEqual([]);
  });

  it("resolves every literal key used in the code", () => {
    const missing: string[] = [];
    for (const { file, text } of FILES) {
      const namespaces = [
        "",
        ...[...text.matchAll(/(?:useTranslations|getTranslations)\(\s*"([\w.]+)"/g)].map((m) => m[1]),
        ...[...text.matchAll(/namespace:\s*"([\w.]+)"/g)].map((m) => m[1]),
      ];
      for (const match of text.matchAll(/\bt\(\s*"([\w.-]+)"/g)) {
        const key = match[1];
        if (!namespaces.some((ns) => has(ns ? `${ns}.${key}` : key))) missing.push(`${file.split("src")[1]}: ${key}`);
      }
      for (const match of text.matchAll(/(?:successMessage|errorKey)="([\w.]+)"/g)) {
        if (!has(match[1])) missing.push(`${file.split("src")[1]}: ${match[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("names every request status, category and specialty", () => {
    for (const status of ALL_STATUSES) {
      expect(AR.has(`status.${status}`), status).toBe(true);
      expect(AR.has(`tracking.headline.${status}`), status).toBe(true);
      expect(AR.has(`tracking.explain.${status}`), status).toBe(true);
    }
    for (const c of VEHICLE_CATEGORIES) expect(AR.has(`vehicleCategory.${c}`), c).toBe(true);
    for (const s of PROVIDER_SPECIALTIES) expect(AR.has(`apply.specialty.${s}`), s).toBe(true);
  });

  it("has a sentence for every business error and missing application field", () => {
    for (const code of literalUnion("src/features/requests/errors.ts", "DomainErrorCode")) {
      expect(AR.has(`domainErrors.${code}`), code).toBe(true);
    }
    for (const field of literalUnion("src/features/applications/schemas.ts", "MissingField")) {
      expect(AR.has(`apply.missing.${field}`), field).toBe(true);
    }
  });

  it("has a sentence for every validation code the schemas can produce", () => {
    const codes = new Set<string>();
    for (const { text } of FILES.filter(({ file }) => /(schemas|actions)\.ts$/.test(file))) {
      // The message argument: the last argument of a validator call.
      for (const m of text.matchAll(/,\s*"([A-Z][A-Z_]{3,})"\s*\)/g)) codes.add(m[1]);
      for (const m of text.matchAll(/message:\s*"([A-Z][A-Z_]{3,})"/g)) codes.add(m[1]);
    }
    const missing = [...codes].filter((code) =>
      ["validation", "domainErrors", "phoneErrors", "otpErrors"].every((ns) => !AR.has(`${ns}.${code}`)),
    );
    expect(missing).toEqual([]);
  });
});
