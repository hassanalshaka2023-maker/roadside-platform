/**
 * Database seed.
 *
 * Idempotent by construction: everything is an upsert keyed on a natural
 * unique column, so running it twice changes nothing and running it against a
 * live database is safe.
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
 * Passenger transport ("سائق تكسي / نقل أشخاص") is deliberately absent: it is
 * a provider role on the recruitment flyer, not a roadside-assistance service
 * a customer requests here. It appears in PROVIDER_ROLES below instead.
 *
 * Prices are placeholders in the default currency and are shown to customers
 * as indicative only - payment is cash, agreed on site.
 */
const SERVICE_TYPES = [
  {
    slug: "towing",
    nameAr: "سطحة",
    nameEn: "Towing",
    descriptionAr: "نقل سيارتك إلى الورشة أو إلى أي مكان تحدّده",
    descriptionEn: "Move your car to a garage or anywhere you choose",
    estimatedPriceMin: 10,
    estimatedPriceMax: 40,
    sortOrder: 1,
  },
  {
    slug: "battery",
    nameAr: "بطارية",
    nameEn: "Battery",
    descriptionAr: "شحن البطارية أو تبديلها في مكانك",
    descriptionEn: "Jump-start or battery replacement on the spot",
    estimatedPriceMin: 5,
    estimatedPriceMax: 25,
    sortOrder: 2,
  },
  {
    slug: "tire-change",
    nameAr: "بنشر وإطارات",
    nameEn: "Tyre change",
    descriptionAr: "تبديل الإطار أو إصلاح البنشر",
    descriptionEn: "Tyre change or puncture repair",
    estimatedPriceMin: 3,
    estimatedPriceMax: 10,
    sortOrder: 3,
  },
  {
    slug: "fuel-delivery",
    nameAr: "توصيل وقود",
    nameEn: "Fuel delivery",
    descriptionAr: "بنزين أو مازوت يصلك أينما كنت",
    descriptionEn: "Petrol or diesel delivered to you",
    estimatedPriceMin: 5,
    estimatedPriceMax: 15,
    sortOrder: 4,
  },
  {
    slug: "lockout",
    nameAr: "فتح أقفال",
    nameEn: "Lockout",
    descriptionAr: "نسيت المفتاح داخل السيارة؟ نفتحها لك بأمان",
    descriptionEn: "Locked your keys inside? We open it safely",
    estimatedPriceMin: 5,
    estimatedPriceMax: 20,
    sortOrder: 5,
  },
  {
    slug: "on-site-mechanic",
    nameAr: "ميكانيكي في الموقع",
    nameEn: "On-site mechanic",
    descriptionAr: "إصلاح الأعطال البسيطة في مكانك دون سحب السيارة",
    descriptionEn: "Minor repairs where you are, no towing needed",
    estimatedPriceMin: 5,
    estimatedPriceMax: 30,
    sortOrder: 6,
  },
  {
    slug: "pre-purchase-inspection",
    nameAr: "فحص ما قبل الشراء",
    nameEn: "Pre-purchase inspection",
    descriptionAr: "فحص شامل للسيارة قبل أن تشتريها",
    descriptionEn: "A full check of a car before you buy it",
    estimatedPriceMin: 15,
    estimatedPriceMax: 40,
    sortOrder: 7,
  },
] as const;

/**
 * Roles someone can apply for, straight from the recruitment flyer.
 * Stored as a Setting so the application form can change without a deploy.
 */
const PROVIDER_ROLES = [
  { slug: "auto-mechanic", nameAr: "ميكانيكي سيارات", nameEn: "Auto mechanic" },
  {
    slug: "auto-electrician",
    nameAr: "كهربائي سيارات",
    nameEn: "Auto electrician",
  },
  { slug: "tire-repair", nameAr: "كومجي / بنشرجي", nameEn: "Tyre & puncture repair" },
  { slug: "tow-truck-driver", nameAr: "سائق سطحة", nameEn: "Tow truck driver" },
  {
    slug: "passenger-transport",
    nameAr: "سائق تكسي / نقل أشخاص",
    nameEn: "Passenger transport driver",
    // Recruited, but not offered to customers as a request type.
    providerOnly: true,
  },
] as const;

const SETTINGS: Array<{ key: string; value: unknown }> = [
  // When a customer must upload an ID: NEVER | FIRST_REQUEST_ONLY | ALWAYS
  { key: "customerIdMode", value: "FIRST_REQUEST_ONLY" },
  { key: "defaultCurrency", value: "USD" },
  { key: "otpProvider", value: "console" },
  {
    key: "businessPhones",
    value: ["0938503705", "0992605513", "0981488760"],
  },
  { key: "whatsappEnabled", value: true },
  {
    key: "workingHours",
    value: { allDay: true, noteAr: "24 ساعة، كل أيام الأسبوع", noteEn: "24/7" },
  },
  {
    key: "coverageNote",
    value: { ar: "كافة أنحاء سوريا", en: "All regions of Syria" },
  },
  { key: "providerRoles", value: PROVIDER_ROLES },
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
  return { superAdmin, dispatcher };
}

async function seedServiceTypes() {
  for (const service of SERVICE_TYPES) {
    await prisma.serviceType.upsert({
      where: { slug: service.slug },
      create: { ...service, isActive: true },
      // Names and prices are editable in the admin panel later, so only the
      // fields that define the catalogue entry are refreshed here.
      update: {
        nameAr: service.nameAr,
        nameEn: service.nameEn,
        descriptionAr: service.descriptionAr,
        descriptionEn: service.descriptionEn,
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
      update: { value: setting.value as object },
    });
  }
  console.log(`  settings:      ${SETTINGS.length}`);
}

/** Sample data for local testing. Never created in production. */
async function seedDemoData() {
  const customers = [
    { phone: "+963930000001", name: "أحمد العلي", city: "دمشق" },
    { phone: "+963940000002", name: "ليلى حسن", city: "حلب" },
  ];

  const providers = [
    {
      phone: "+963950000003",
      name: "سامر السطحة",
      city: "دمشق",
      lat: 33.5138,
      lng: 36.2765,
      services: ["towing", "battery"],
    },
    {
      phone: "+963960000004",
      name: "خالد الميكانيكي",
      city: "حلب",
      lat: 36.2021,
      lng: 37.1343,
      services: ["on-site-mechanic", "tire-change"],
    },
  ];

  const customerUsers = [];
  for (const customer of customers) {
    const user = await prisma.user.upsert({
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
    customerUsers.push(user);
  }

  const providerUsers = [];
  for (const provider of providers) {
    const serviceTypeIds = (
      await prisma.serviceType.findMany({
        where: { slug: { in: [...provider.services] } },
        select: { id: true },
      })
    ).map((row) => row.id);

    const user = await prisma.user.upsert({
      where: { phone: provider.phone },
      create: {
        phone: provider.phone,
        name: provider.name,
        role: "PROVIDER",
        isPhoneVerified: true,
      },
      update: { name: provider.name, role: "PROVIDER" },
    });

    await prisma.providerProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        serviceTypeIds,
        coverageAreas: [provider.city],
        isAvailable: true,
        currentLat: provider.lat,
        currentLng: provider.lng,
        locationUpdatedAt: new Date(),
        status: "ACTIVE",
      },
      update: { serviceTypeIds, coverageAreas: [provider.city] },
    });

    providerUsers.push(user);
  }

  // A few requests across the lifecycle, so the admin screens have something
  // to render in every state.
  const towing = await prisma.serviceType.findUniqueOrThrow({
    where: { slug: "towing" },
  });
  const mechanic = await prisma.serviceType.findUniqueOrThrow({
    where: { slug: "on-site-mechanic" },
  });

  const demoRequests = [
    {
      key: "demo-pending",
      customerId: customerUsers[0].id,
      serviceTypeId: towing.id,
      status: "PENDING" as const,
      lat: 33.5102,
      lng: 36.2913,
      addressText: "دمشق - المزة",
      landmarkText: "قرب جامع الرحمن",
      carMake: "Kia",
      carModel: "Rio",
      carYear: 2014,
      problemDescription: "السيارة لا تقلع والبطارية مشحونة",
    },
    {
      key: "demo-assigned",
      customerId: customerUsers[1].id,
      serviceTypeId: mechanic.id,
      status: "ASSIGNED" as const,
      lat: 36.1985,
      lng: 37.1541,
      addressText: "حلب - الفرقان",
      landmarkText: "مقابل الحديقة",
      carMake: "Hyundai",
      carModel: "Accent",
      carYear: 2016,
      problemDescription: "صوت غريب من المحرّك",
      assignedProviderId: providerUsers[1].id,
      assignedAt: new Date(),
    },
    {
      key: "demo-completed",
      customerId: customerUsers[0].id,
      serviceTypeId: towing.id,
      status: "COMPLETED" as const,
      lat: 33.5225,
      lng: 36.2786,
      addressText: "دمشق - أبو رمانة",
      carMake: "Toyota",
      carModel: "Corolla",
      carYear: 2012,
      assignedProviderId: providerUsers[0].id,
      assignedAt: new Date(),
      acceptedAt: new Date(),
      completedAt: new Date(),
      finalPrice: 25,
    },
  ];

  for (const request of demoRequests) {
    const { key, ...data } = request;

    // The demo rows need a stable identity across runs, and publicCode is
    // generated by a sequence, so a marker in problemDescription is not
    // enough: look the row up by an explicit demo code instead.
    const publicCode = `RS-DEMO-${key.replace("demo-", "").toUpperCase()}`;

    const existing = await prisma.serviceRequest.findUnique({ where: { publicCode } });
    if (existing) continue;

    const created = await prisma.serviceRequest.create({
      data: { ...data, publicCode },
    });

    await prisma.requestStatusHistory.create({
      data: {
        requestId: created.id,
        fromStatus: null,
        toStatus: created.status,
        note: "seeded demo request",
      },
    });
  }

  console.log(
    `  demo data:     ${customers.length} customers, ${providers.length} providers, ${demoRequests.length} requests`,
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
