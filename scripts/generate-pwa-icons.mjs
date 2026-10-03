/**
 * Builds the PWA icons in public/icons/ from the master logo (design/logo.png).
 * The logo is never redrawn: it is placed, unchanged, on its own black
 * background and padded into a square.
 *
 *   node scripts/generate-pwa-icons.mjs
 *
 * - icon-192.png / icon-512.png: "any" purpose, logo fills most of the square.
 * - maskable-512.png: logo kept inside the central 80% safe zone, because
 *   Android may crop the icon to a circle or squircle.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";

const root = join(import.meta.dirname, "..");
const source = join(root, "design", "logo.png");
const outDir = join(root, "public", "icons");
const black = { r: 0, g: 0, b: 0, alpha: 1 };

// The master has a wide black margin; trim it so the artwork, not the margin,
// is what gets scaled into the square.
const trimmed = await sharp(source).trim({ background: "#000000", threshold: 20 }).toBuffer();

mkdirSync(outDir, { recursive: true });

async function icon(name, size, logoScale) {
  const inner = Math.round(size * logoScale);
  const logo = await sharp(trimmed)
    .resize(inner, inner, { fit: "contain", background: black })
    .toBuffer();

  await sharp({ create: { width: size, height: size, channels: 4, background: black } })
    .composite([{ input: logo, gravity: "center" }])
    .png({ compressionLevel: 9, palette: true })
    .toFile(join(outDir, name));

  console.log(`wrote public/icons/${name}`);
}

await icon("icon-192.png", 192, 0.92);
await icon("icon-512.png", 512, 0.92);
await icon("maskable-512.png", 512, 0.78);
