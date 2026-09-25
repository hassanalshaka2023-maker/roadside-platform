/**
 * Database seed.
 *
 * Idempotent by construction: everything is an upsert keyed on a natural
 * unique column, so running it twice changes nothing and running it against a
 * live database is safe. Platform settings are created ONCE and never
 * overwritten, so an admin's changes in the panel survive a re-seed.
 *
 * This file runs under `tsx`, outside Next.js, so it deliberately does NOT
 * import from src/lib/*: those modules import "server-only", which throws
 * outside a React Server Component graph. It builds its own Prisma client and
 * reads process.env directly.
 */
import { hash, type Algorithm } from "@node-rs/argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

try {
  process.loadEnvFile();
} catch {
  // Already in the environment (CI, Docker).
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: required("DATABASE_URL") }),
});

const isProduction = process.env.NODE_ENV === "production";

/** Algorithm.Argon2id - see the note in src/lib/auth/password.ts. */
const ARGON2ID = 2 as Algorithm;

function hashPassword(plain: string): Promise<string> {
  return hash(plain, {
    algorithm: ARGON2ID,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

// ---------------------------------------------------------------------------
// Service catalogue
// ---------------------------------------------------------------------------

/**
 * The seven customer-facing services.
 *
 * There are NO prices here: the platform does not invent market rates. Every
 * price comes from a provider's offer; the pricing note explains how that
 * kind of job is priced.
 *
 * Passenger transport is deliberately absent (deferred).
 */
const SERVICE_TYPES = [
  {
    slug: "towing",
    nameAr: "سحب وسطحة",
    nameEn: "Towing",
    descriptionAr: "نقل سيارتك إلى الورشة أو إلى أي مكان تحدّده",
    descriptionEn: "Move your car to a garage or anywhere you choose",
    pricingNoteAr: "السعر حسب مكان الانطلاق والوجهة ونوع السيارة وحالتها.",
    pricingNoteEn: "Priced by pickup, destination, vehicle type and condition.",
    requiresDestination: true,
    sortOrder: 1,
  },
  {
    slug: "battery",
    nameAr: "بطارية",
    nameEn: "Battery",
    descriptionAr: "تشغيل السيارة بالاشتراك أو تبديل البطارية في مكانك",
    descriptionEn: "Jump-start or battery replacement on the spot",
    pricingNoteAr: "رسوم الوصول والتشغيل معروفة مسبقاً. سعر البطارية الجديدة منفصل ويحتاج موافقتك.",
    pricingNoteEn:
      "Callout and jump-start are quoted upfront. A new battery is priced separately and needs your approval.",
    requiresDestination: false,
    sortOrder: 2,
  },
  {
    slug: "tire-change",
    nameAr: "بنشر وإطارات",
    nameEn: "Tyres",
    descriptionAr: "تبديل الإطار أو إصلاح البنشر",
    descriptionEn: "Tyre change or puncture repair",
    pricingNoteAr: "رسوم الوصول والعمل معروفة مسبقاً. الإطارات أو القطع إضافات تحتاج موافقتك.",
    pricingNoteEn: "Callout and labour are quoted upfront. Tyres or parts are extras that need your approval.",
    requiresDestination: false,
    sortOrder: 3,
  },
  {
    slug: "on-site-mechanic",
    nameAr: "ميكانيك وكهرباء",
    nameEn: "Mechanic & electrics",
    descriptionAr: "كشف وإصلاح أعطال الميكانيك والكهرباء في مكانك",
    descriptionEn: "Diagnosis and repair of mechanical and electrical faults where you are",
    pricingNoteAr:
      "رسوم الوصول والكشف معروفة قبل التأكيد. بعد المعاينة يصلك عرض الإصلاح، وإذا رفضته تبقى رسوم الكشف فقط.",
    pricingNoteEn:
      "Callout and inspection are known before you confirm. After inspection you get a repair quote; if you decline it, only the inspection fee is due.",
    requiresDestination: false,
    sortOrder: 4,
  },
  {
    slug: "fuel-delivery",
    nameAr: "توصيل وقود",
    nameEn: "Fuel delivery",
    descriptionAr: "بنزين أو مازوت يصلك أينما كنت",
    descriptionEn: "Petrol or diesel delivered to you",
    pricingNoteAr: "رسوم التوصيل معروفة مسبقاً، وثمن الوقود يُذكر في العرض.",
    pricingNoteEn: "Delivery is quoted upfront; the fuel itself is listed in the offer.",
    requiresDestination: false,
    sortOrder: 5,
  },
  {
    slug: "lockout",
    nameAr: "فتح أقفال",
    nameEn: "Lockout",
    descriptionAr: "نسيت المفتاح داخل السيارة؟ نفتحها لك بأمان",
    descriptionEn: "Locked your keys inside? We open it safely",
    pricingNoteAr: "السعر محدّد في العرض قبل التأكيد.",
    pricingNoteEn: "The price is fixed in the offer before you confirm.",
    requiresDestination: false,
    sortOrder: 6,
  },
  {
    slug: "pre-purchase-inspection",
    nameAr: "فحص ما قبل الشراء",
    nameEn: "Pre-purchase inspection",
    descriptionAr: "فحص شامل للسيارة قبل أن تشتريها",
    descriptionEn: "A full check of a car before you buy it",
    pricingNoteAr: "السعر محدّد في العرض قبل التأكيد.",
    pricingNoteEn: "The price is fixed in the offer before you confirm.",
    requiresDestination: false,
    sortOrder: 7,
  },
] as const;

/**
 * Platform settings, created ONCE. Values are validated at read time by
 * src/features/settings/platform.ts, which also holds the defaults used when
 * a key is missing.
 */
const SETTINGS: Array<{ key: string; value: unknown }> = [
  { key: "customerIdMode", value: "NEVER" },
  { key: "businessPhones", value: ["0938503705", "0992605513", "0981488760"] },
  { key: "whatsappEnabled", value: true },
  { key: "searchRadiusKm", value: 30 },
  { key: "searchTimeoutMinutes", value: 20 },
  { key: "offerValidityMinutes", value: 15 },
  { key: "maxOffersPerRequest", value: 5 },
  // The free period: commission disabled and zero.
  {
    key: "commissionPolicy",
    value: { current: { enabled: false, rateBps: 0, base: "TOTAL" }, scheduled: null },
  },
  { key: "commissionNoticeDays", value: 14 },
];

/** Keys from earlier phases that nothing reads any more. */
const OBSOLETE_SETTINGS = [
  "defaultCurrency",
  "otpProvider",
  "providerRoles",
  "workingHours",
  "coverageNote",
];

// ---------------------------------------------------------------------------
// Seeding steps
// ---------------------------------------------------------------------------

async function seedAdmins() {
  const adminEmail = required("SEED_ADMIN_EMAIL").toLowerCase();
  const adminPassword = required("SEED_ADMIN_PASSWORD");
  const dispatcherEmail = required("SEED_DISPATCHER_EMAIL").toLowerCase();
  const dispatcherPassword = required("SEED_DISPATCHER_PASSWORD");

  const superAdmin = await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail,
      role: "ADMIN",
      adminLevel: "SUPER_ADMIN",
      name: "المدير العام",
      passwordHash: await hashPassword(adminPassword),
      status: "ACTIVE",
    },
    // Re-running with a changed password in .env updates it, and clears any
    // lockout left over from testing.
    update: {
      role: "ADMIN",
      adminLevel: "SUPER_ADMIN",
      passwordHash: await hashPassword(adminPassword),
      status: "ACTIVE",
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });

  const dispatcher = await prisma.user.upsert({
    where: { email: dispatcherEmail },
    create: {
      email: dispatcherEmail,
      role: "ADMIN",
      adminLevel: "DISPATCHER",
      name: "موزّع الطلبات",
      passwordHash: await hashPassword(dispatcherPassword),
      status: "ACTIVE",
    },
    update: {
      role: "ADMIN",
      adminLevel: "DISPATCHER",
      passwordHash: await hashPassword(dispatcherPassword),
      status: "ACTIVE",
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });

  console.log(`  admins:        ${superAdmin.email} (SUPER_ADMIN), ${dispatcher.email} (DISPATCHER)`);
}

async function seedServiceTypes() {
  for (const service of SERVICE_TYPES) {
    await prisma.serviceType.upsert({
      where: { slug: service.slug },
      create: { ...service, isActive: true },
      // isActive is left alone: an admin may have switched a service off.
      update: {
        nameAr: service.nameAr,
        nameEn: service.nameEn,
        descriptionAr: service.descriptionAr,
        descriptionEn: service.descriptionEn,
        pricingNoteAr: service.pricingNoteAr,
        pricingNoteEn: service.pricingNoteEn,
        requiresDestination: service.requiresDestination,
        sortOrder: service.sortOrder,
      },
    });
  }
  console.log(`  serviceTypes:  ${SERVICE_TYPES.length}`);
}

async function seedSettings() {
  for (const setting of SETTINGS) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      create: { key: setting.key, value: setting.value as object },
      // Admin edits win over the seed.
      update: {},
    });
  }
  await prisma.setting.deleteMany({ where: { key: { in: OBSOLETE_SETTINGS } } });
  console.log(`  settings:      ${SETTINGS.length} (existing values kept)`);
}

/**
 * Sample data for local testing. NEVER created in production.
 *
 * Every demo name starts with DEMO_PREFIX and every demo phone is in the
 * +96393..96/0000000x range, so demo rows are obvious on every screen.
 */
const DEMO_PREFIX = "[تجريبي]";

async function seedDemoData() {
  const customers = [
    { phone: "+963930000001", name: `${DEMO_PREFIX} أحمد`, city: "damascus" },
    { phone: "+963940000002", name: `${DEMO_PREFIX} ليلى`, city: "aleppo" },
  ];

  const providers = [
    {
      phone: "+963950000003",
      name: `${DEMO_PREFIX} سامر - سطحة`,
      governorate: "damascus",
      lat: 33.5138,
      lng: 36.2765,
      services: ["towing", "battery"],
      specialties: ["tow-truck-driver"],
      towCapacities: ["SEDAN", "SUV", "PICKUP"] as const,
    },
    {
      phone: "+963960000004",
      name: `${DEMO_PREFIX} خالد - ميكانيكي`,
      governorate: "damascus",
      lat: 33.52,
      lng: 36.29,
      services: ["on-site-mechanic", "tire-change", "battery"],
      specialties: ["auto-mechanic", "auto-electrician"],
      towCapacities: [] as const,
    },
  ];

  for (const customer of customers) {
    await prisma.user.upsert({
      where: { phone: customer.phone },
      create: {
        phone: customer.phone,
        name: customer.name,
        role: "CUSTOMER",
        isPhoneVerified: true,
        customerProfile: { create: { city: customer.city } },
      },
      update: { name: customer.name },
    });
  }

  for (const provider of providers) {
    const serviceTypeIds = (
      await prisma.serviceType.findMany({
        where: { slug: { in: [...provider.services] } },
        select: { id: true },
      })
    ).map((row) => row.id);

    const user = await prisma.user.upsert({
      where: { phone: provider.phone },
      create: { phone: provider.phone, name: provider.name, role: "PROVIDER", isPhoneVerified: true },
      update: { name: provider.name, role: "PROVIDER" },
    });

    // A demo provider carries the same approval record as a real one.
    const application = await prisma.providerApplication.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        fullName: provider.name,
        phone: provider.phone,
        specialties: provider.specialties,
        serviceTypes: [...provider.services],
        governorate: provider.governorate,
        coverageAreas: [],
        baseLat: provider.lat,
        baseLng: provider.lng,
        towCapacities: [...provider.towCapacities],
        consentTerms: true,
        consentAccuracy: true,
        consentNoHiddenFees: true,
        consentAcceptedAt: new Date(),
        status: "APPROVED",
        submittedAt: new Date(),
        reviewedAt: new Date(),
        decisionReason: "demo data",
      },
      update: {},
    });

    await prisma.providerProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        applicationId: application.id,
        serviceTypeIds,
        governorate: provider.governorate,
        coverageAreas: [],
        towCapacities: [...provider.towCapacities],
        serviceRadiusKm: 40,
        isAvailable: true,
        currentLat: provider.lat,
        currentLng: provider.lng,
        locationUpdatedAt: new Date(),
        status: "ACTIVE",
      },
      // Demo rows are reset on every seed, so they stay in a known state.
      update: {
        serviceTypeIds,
        applicationId: application.id,
        governorate: provider.governorate,
        towCapacities: [...provider.towCapacities],
        serviceRadiusKm: 40,
        currentLat: provider.lat,
        currentLng: provider.lng,
        locationUpdatedAt: new Date(),
        status: "ACTIVE",
      },
    });
  }

  console.log(
    `  demo data:     ${customers.length} customers, ${providers.length} approved providers (names start with ${DEMO_PREFIX})`,
  );
}

async function main() {
  console.log("Seeding database…");

  await seedAdmins();
  await seedServiceTypes();
  await seedSettings();

  if (isProduction) {
    console.log("  demo data:     skipped (NODE_ENV=production)");
  } else {
    await seedDemoData();
  }

  console.log("Seed complete.");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
