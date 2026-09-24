/**
 * Builders for integration tests. Everything goes through the real services
 * where the behaviour under test depends on it (applications, offers), and
 * straight to Prisma only for plain fixtures.
 */
import { randomUUID } from "node:crypto";

import type { FileKind } from "@prisma/client";

import { prisma } from "@/lib/db";
import { decideApplication, saveApplication } from "@/features/applications/service";
import type { ApplicationInput } from "@/features/applications/schemas";
import { createRequest } from "@/features/requests/service";
import type { CreateRequestInput } from "@/features/requests/schemas";

export const DAMASCUS = { lat: 33.5138, lng: 36.2765 };

/** Wipes every table except the migration history. Test database only. */
export async function resetDatabase(): Promise<void> {
  const [{ current_database: name }] = await prisma.$queryRaw<Array<{ current_database: string }>>`
    SELECT current_database()`;
  if (!name.endsWith("_test")) throw new Error(`refusing to reset ${name}`);

  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

let phoneCounter = 0;
function nextPhone(): string {
  phoneCounter += 1;
  return `+9639${String(10_000_000 + phoneCounter).padStart(8, "0")}`;
}

export async function seedServices() {
  const towing = await prisma.serviceType.create({
    data: { slug: "towing", nameAr: "سطحة", nameEn: "Towing", requiresDestination: true, sortOrder: 1 },
  });
  const mechanic = await prisma.serviceType.create({
    data: { slug: "on-site-mechanic", nameAr: "ميكانيك", nameEn: "Mechanic", sortOrder: 2 },
  });
  const battery = await prisma.serviceType.create({
    data: { slug: "battery", nameAr: "بطارية", nameEn: "Battery", sortOrder: 3 },
  });
  return { towing, mechanic, battery };
}

export async function makeUser(role: "CUSTOMER" | "ADMIN" = "CUSTOMER") {
  if (role === "ADMIN") {
    return prisma.user.create({
      data: { role: "ADMIN", adminLevel: "SUPER_ADMIN", email: `${randomUUID()}@test.local`, name: "admin" },
    });
  }
  return prisma.user.create({
    data: { role: "CUSTOMER", phone: nextPhone(), isPhoneVerified: true, name: "customer" },
  });
}

/** A fake, unattached upload row - enough for ownership checks. */
export async function fakeUpload(ownerId: string, kind: FileKind): Promise<string> {
  const file = await prisma.uploadedFile.create({
    data: {
      ownerId,
      kind,
      storageKey: randomUUID(),
      mimeType: "image/jpeg",
      sizeBytes: 100,
      sha256: "0".repeat(64),
    },
  });
  return file.id;
}

export async function applicationInput(
  userId: string,
  overrides: Partial<ApplicationInput> = {},
): Promise<ApplicationInput> {
  return {
    fullName: "Test Provider",
    providerKind: "INDEPENDENT",
    workshopName: "",
    workshopAddress: "",
    specialties: ["auto-mechanic"],
    serviceTypes: ["on-site-mechanic", "battery"],
    yearsOfExperience: 5,
    equipmentDescription: "",
    governorate: "damascus",
    coverageAreas: [],
    baseLat: DAMASCUS.lat,
    baseLng: DAMASCUS.lng,
    availability: "H24",
    availabilityNotes: "",
    towVehicleType: "",
    towVehiclePlate: "",
    towCapacities: [],
    vehiclePhotoIds: [],
    vehicleDocumentId: undefined,
    idDocumentFrontId: await fakeUpload(userId, "ID_FRONT"),
    idDocumentBackId: undefined,
    selfieId: await fakeUpload(userId, "SELFIE"),
    equipmentPhotoIds: [],
    consentTerms: true,
    consentAccuracy: true,
    consentNoHiddenFees: true,
    ...overrides,
  };
}

/** Applies, gets approved by an admin, and switches availability on. */
export async function makeApprovedProvider(
  adminId: string,
  options: { lat?: number; lng?: number; services?: string[] } = {},
) {
  const user = await makeUser();
  const input = await applicationInput(user.id, {
    baseLat: options.lat ?? DAMASCUS.lat,
    baseLng: options.lng ?? DAMASCUS.lng,
    serviceTypes: options.services ?? ["on-site-mechanic", "battery"],
  });
  await saveApplication({ userId: user.id, phone: user.phone!, input, submit: true });
  const app = await prisma.providerApplication.findUniqueOrThrow({ where: { userId: user.id } });
  await decideApplication({ adminId, applicationId: app.id, decision: "APPROVED" });
  await prisma.providerProfile.update({ where: { userId: user.id }, data: { isAvailable: true } });
  return user;
}

export async function makeRequest(
  customerId: string,
  serviceTypeId: string,
  overrides: Partial<CreateRequestInput> = {},
) {
  return createRequest({
    customerId,
    idRequired: false,
    input: {
      clientRequestId: randomUUID(),
      serviceTypeId,
      lat: DAMASCUS.lat + 0.01,
      lng: DAMASCUS.lng + 0.01,
      governorate: "damascus",
      addressText: "",
      landmarkText: "",
      carMake: "Kia",
      carModel: "Rio",
      plateNumber: "",
      problemDescription: "",
      problemUnknown: true,
      photoIds: [],
      ...overrides,
    },
  });
}

export const offer = (requestId: string, total = { callout: 20_000, labor: 30_000, parts: 0 }) => ({
  requestId,
  calloutFeeSyp: total.callout,
  laborSyp: total.labor,
  partsSyp: total.parts,
  etaMinutes: 25,
  includesText: "",
  excludesText: "",
  calloutDueIfDeclined: true,
});
