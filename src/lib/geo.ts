/**
 * Geography helpers. Pure, so they run on both server and client.
 *
 * No geocoding service is used anywhere: the governorate is suggested from
 * the nearest governorate capital, and the customer can correct it. That is
 * approximate by design - it only decides which providers see the request
 * and what area label they see, never where anyone drives.
 */

export interface Governorate {
  slug: string;
  nameAr: string;
  nameEn: string;
  /** Approximate centre of the capital city. */
  lat: number;
  lng: number;
}

/** The fourteen Syrian governorates. */
export const GOVERNORATES: readonly Governorate[] = [
  { slug: "damascus", nameAr: "دمشق", nameEn: "Damascus", lat: 33.5138, lng: 36.2765 },
  { slug: "rif-dimashq", nameAr: "ريف دمشق", nameEn: "Rif Dimashq", lat: 33.5711, lng: 36.4017 },
  { slug: "aleppo", nameAr: "حلب", nameEn: "Aleppo", lat: 36.2021, lng: 37.1343 },
  { slug: "homs", nameAr: "حمص", nameEn: "Homs", lat: 34.7324, lng: 36.7137 },
  { slug: "hama", nameAr: "حماة", nameEn: "Hama", lat: 35.1318, lng: 36.7578 },
  { slug: "latakia", nameAr: "اللاذقية", nameEn: "Latakia", lat: 35.5317, lng: 35.7901 },
  { slug: "tartus", nameAr: "طرطوس", nameEn: "Tartus", lat: 34.8959, lng: 35.8867 },
  { slug: "idlib", nameAr: "إدلب", nameEn: "Idlib", lat: 35.9306, lng: 36.6339 },
  { slug: "daraa", nameAr: "درعا", nameEn: "Daraa", lat: 32.6189, lng: 36.1021 },
  { slug: "as-suwayda", nameAr: "السويداء", nameEn: "As-Suwayda", lat: 32.7089, lng: 36.5695 },
  { slug: "quneitra", nameAr: "القنيطرة", nameEn: "Quneitra", lat: 33.1256, lng: 35.8244 },
  { slug: "deir-ez-zor", nameAr: "دير الزور", nameEn: "Deir ez-Zor", lat: 35.3359, lng: 40.1408 },
  { slug: "raqqa", nameAr: "الرقة", nameEn: "Raqqa", lat: 35.9594, lng: 39.0078 },
  { slug: "al-hasakah", nameAr: "الحسكة", nameEn: "Al-Hasakah", lat: 36.5024, lng: 40.7477 },
];

export const GOVERNORATE_SLUGS = GOVERNORATES.map((g) => g.slug) as [string, ...string[]];

export function governorateBySlug(slug: string | null | undefined): Governorate | undefined {
  return GOVERNORATES.find((g) => g.slug === slug);
}

export function governorateName(slug: string | null | undefined, locale: string): string {
  const g = governorateBySlug(slug);
  if (!g) return "";
  return locale === "ar" ? g.nameAr : g.nameEn;
}

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance in kilometres. */
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Distance as shown to a provider who is NOT yet booked: rounded up to a
 * whole kilometre (and never below 1), so the exact position cannot be
 * triangulated from several readings.
 */
export function approximateDistanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  return Math.max(1, Math.ceil(distanceKm(a, b)));
}

/** Suggests the governorate for a point: the one with the nearest capital. */
export function nearestGovernorate(point: { lat: number; lng: number }): Governorate {
  let best = GOVERNORATES[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const governorate of GOVERNORATES) {
    const d = distanceKm(point, governorate);
    if (d < bestDistance) {
      best = governorate;
      bestDistance = d;
    }
  }
  return best;
}
