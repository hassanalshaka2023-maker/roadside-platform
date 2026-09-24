-- CreateEnum
CREATE TYPE "ProviderKind" AS ENUM ('INDEPENDENT', 'WORKSHOP');

-- CreateEnum
CREATE TYPE "VehicleCategory" AS ENUM ('SEDAN', 'SUV', 'PICKUP', 'VAN', 'MINIBUS', 'LIGHT_TRUCK');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'NOT_SELECTED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ExtraChargeStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "CommissionBase" AS ENUM ('TOTAL', 'LABOR');

-- CreateEnum
CREATE TYPE "CommissionEntryStatus" AS ENUM ('DUE', 'SETTLED', 'WAIVED');

-- CreateEnum
CREATE TYPE "ComplaintStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED');

-- AlterEnum
BEGIN;
CREATE TYPE "ApplicationStatus_new" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'NEEDS_INFO', 'APPROVED', 'REJECTED', 'SUSPENDED');
ALTER TABLE "public"."ProviderApplication" ALTER COLUMN "status" DROP DEFAULT;
-- The old pipeline stages all meant "not decided yet".
ALTER TABLE "ProviderApplication" ALTER COLUMN "status" TYPE "ApplicationStatus_new" USING (
  CASE "status"::text
    WHEN 'APPROVED' THEN 'APPROVED'
    WHEN 'REJECTED' THEN 'REJECTED'
    ELSE 'PENDING_REVIEW'
  END::"ApplicationStatus_new");
ALTER TYPE "ApplicationStatus" RENAME TO "ApplicationStatus_old";
ALTER TYPE "ApplicationStatus_new" RENAME TO "ApplicationStatus";
DROP TYPE "public"."ApplicationStatus_old";
ALTER TABLE "ProviderApplication" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FileKind" ADD VALUE 'VEHICLE_PHOTO';
ALTER TYPE "FileKind" ADD VALUE 'VEHICLE_DOCUMENT';

-- AlterEnum
BEGIN;
CREATE TYPE "RequestStatus_new" AS ENUM ('SEARCHING', 'CONFIRMED', 'ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'COMPLETED', 'DISPUTED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_PROVIDER', 'CANCELLED_BY_ADMIN', 'NO_PROVIDER_AVAILABLE', 'EXPIRED');
ALTER TABLE "public"."ServiceRequest" ALTER COLUMN "status" DROP DEFAULT;
-- The manual-dispatch statuses map onto the offer-based lifecycle.
ALTER TABLE "ServiceRequest" ALTER COLUMN "status" TYPE "RequestStatus_new" USING (
  CASE "status"::text
    WHEN 'PENDING'  THEN 'SEARCHING'
    WHEN 'ASSIGNED' THEN 'SEARCHING'
    WHEN 'ACCEPTED' THEN 'CONFIRMED'
    WHEN 'DECLINED' THEN 'CANCELLED_BY_PROVIDER'
    ELSE "status"::text
  END::"RequestStatus_new");
ALTER TABLE "RequestStatusHistory" ALTER COLUMN "fromStatus" TYPE "RequestStatus_new" USING (
  CASE "fromStatus"::text
    WHEN 'PENDING'  THEN 'SEARCHING'
    WHEN 'ASSIGNED' THEN 'SEARCHING'
    WHEN 'ACCEPTED' THEN 'CONFIRMED'
    WHEN 'DECLINED' THEN 'CANCELLED_BY_PROVIDER'
    ELSE "fromStatus"::text
  END::"RequestStatus_new");
ALTER TABLE "RequestStatusHistory" ALTER COLUMN "toStatus" TYPE "RequestStatus_new" USING (
  CASE "toStatus"::text
    WHEN 'PENDING'  THEN 'SEARCHING'
    WHEN 'ASSIGNED' THEN 'SEARCHING'
    WHEN 'ACCEPTED' THEN 'CONFIRMED'
    WHEN 'DECLINED' THEN 'CANCELLED_BY_PROVIDER'
    ELSE "toStatus"::text
  END::"RequestStatus_new");
ALTER TYPE "RequestStatus" RENAME TO "RequestStatus_old";
ALTER TYPE "RequestStatus_new" RENAME TO "RequestStatus";
DROP TYPE "public"."RequestStatus_old";
ALTER TABLE "ServiceRequest" ALTER COLUMN "status" SET DEFAULT 'SEARCHING';
COMMIT;

-- Sequence behind ProviderApplication.publicReference (AP-000123). It has to
-- exist before the column default that calls nextval() on it.
CREATE SEQUENCE "provider_application_ref_seq" START 1;

-- DropIndex
DROP INDEX "ProviderApplication_city_idx";

-- AlterTable
ALTER TABLE "ProviderApplication" DROP COLUMN "city",
DROP COLUMN "consentAccepted",
DROP COLUMN "referencesText",
ADD COLUMN     "baseLat" DOUBLE PRECISION,
ADD COLUMN     "baseLng" DOUBLE PRECISION,
ADD COLUMN     "consentAccuracy" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "consentNoHiddenFees" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "consentTerms" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "decisionReason" TEXT,
ADD COLUMN     "governorate" TEXT NOT NULL,
ADD COLUMN     "providerKind" "ProviderKind" NOT NULL DEFAULT 'INDEPENDENT',
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "specialties" TEXT[],
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "towCapacities" "VehicleCategory"[],
ADD COLUMN     "towVehiclePlate" TEXT,
ADD COLUMN     "towVehicleType" TEXT,
ADD COLUMN     "userId" UUID NOT NULL,
ADD COLUMN     "vehicleDocumentId" UUID,
ADD COLUMN     "vehiclePhotoIds" TEXT[],
ADD COLUMN     "workshopAddress" TEXT,
ADD COLUMN     "workshopName" TEXT,
ALTER COLUMN "status" SET DEFAULT 'DRAFT',
ALTER COLUMN "publicReference" SET DEFAULT ('AP-' || lpad(nextval('provider_application_ref_seq')::text, 6, '0'));

-- AlterTable
ALTER TABLE "ProviderProfile" DROP COLUMN "commissionPercent",
ADD COLUMN     "governorate" TEXT,
ADD COLUMN     "providerKind" "ProviderKind" NOT NULL DEFAULT 'INDEPENDENT',
ADD COLUMN     "serviceRadiusKm" INTEGER NOT NULL DEFAULT 25,
ADD COLUMN     "towCapacities" "VehicleCategory"[],
ADD COLUMN     "workingHours" TEXT,
ADD COLUMN     "workshopName" TEXT;

-- AlterTable
ALTER TABLE "ServiceRequest" DROP COLUMN "acceptedAt",
DROP COLUMN "estimatedPrice",
DROP COLUMN "finalPrice",
ADD COLUMN     "acceptedOfferId" UUID,
ADD COLUMN     "carCategory" "VehicleCategory",
ADD COLUMN     "clientRequestId" UUID,
ADD COLUMN     "commissionBase" "CommissionBase",
ADD COLUMN     "commissionEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "commissionRateBps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "commissionSyp" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "customerConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "destinationLat" DOUBLE PRECISION,
ADD COLUMN     "destinationLng" DOUBLE PRECISION,
ADD COLUMN     "destinationText" TEXT,
ADD COLUMN     "disputeReason" TEXT,
ADD COLUMN     "disputeResolution" TEXT,
ADD COLUMN     "etaAt" TIMESTAMP(3),
ADD COLUMN     "fallbackFromId" UUID,
ADD COLUMN     "feeTermsAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "finalAmountSyp" INTEGER,
ADD COLUMN     "governorate" TEXT,
ADD COLUMN     "problemUnknown" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "providerConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "searchAttempts" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "searchExpiresAt" TIMESTAMP(3),
ADD COLUMN     "vehicleCanRoll" BOOLEAN,
ALTER COLUMN "publicCode" SET DEFAULT ('RS-' || lpad(nextval('service_request_public_code_seq')::text, 6, '0')),
ALTER COLUMN "status" SET DEFAULT 'SEARCHING';

-- AlterTable
ALTER TABLE "ServiceType" DROP COLUMN "estimatedPriceMax",
DROP COLUMN "estimatedPriceMin",
ADD COLUMN     "pricingNoteAr" TEXT,
ADD COLUMN     "pricingNoteEn" TEXT,
ADD COLUMN     "requiresDestination" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ApplicationDecision" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "adminId" UUID,
    "fromStatus" "ApplicationStatus" NOT NULL,
    "toStatus" "ApplicationStatus" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestOffer" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'PENDING',
    "calloutFeeSyp" INTEGER NOT NULL,
    "laborSyp" INTEGER NOT NULL,
    "partsSyp" INTEGER NOT NULL,
    "totalSyp" INTEGER NOT NULL,
    "etaMinutes" INTEGER NOT NULL,
    "includesText" TEXT,
    "excludesText" TEXT,
    "calloutDueIfDeclined" BOOLEAN NOT NULL DEFAULT true,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "viaInvite" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "RequestOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtraCharge" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "laborSyp" INTEGER NOT NULL,
    "partsSyp" INTEGER NOT NULL,
    "totalSyp" INTEGER NOT NULL,
    "status" "ExtraChargeStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "ExtraCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestInvite" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "invitedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Complaint" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "filedById" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ComplaintStatus" NOT NULL DEFAULT 'OPEN',
    "adminNote" TEXT,
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionEntry" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "baseAmountSyp" INTEGER NOT NULL,
    "rateBps" INTEGER NOT NULL,
    "amountSyp" INTEGER NOT NULL,
    "status" "CommissionEntryStatus" NOT NULL DEFAULT 'DUE',
    "settlementId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionSettlement" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "amountSyp" INTEGER NOT NULL,
    "note" TEXT,
    "recordedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApplicationDecision_applicationId_createdAt_idx" ON "ApplicationDecision"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "RequestOffer_requestId_status_idx" ON "RequestOffer"("requestId", "status");

-- CreateIndex
CREATE INDEX "RequestOffer_providerId_status_idx" ON "RequestOffer"("providerId", "status");

-- CreateIndex
CREATE INDEX "RequestOffer_status_validUntil_idx" ON "RequestOffer"("status", "validUntil");

-- CreateIndex
CREATE INDEX "ExtraCharge_requestId_status_idx" ON "ExtraCharge"("requestId", "status");

-- CreateIndex
CREATE INDEX "RequestInvite_providerId_createdAt_idx" ON "RequestInvite"("providerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RequestInvite_requestId_providerId_key" ON "RequestInvite"("requestId", "providerId");

-- CreateIndex
CREATE INDEX "Complaint_status_createdAt_idx" ON "Complaint"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Complaint_requestId_idx" ON "Complaint"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionEntry_requestId_key" ON "CommissionEntry"("requestId");

-- CreateIndex
CREATE INDEX "CommissionEntry_providerId_status_idx" ON "CommissionEntry"("providerId", "status");

-- CreateIndex
CREATE INDEX "CommissionSettlement_providerId_createdAt_idx" ON "CommissionSettlement"("providerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderApplication_userId_key" ON "ProviderApplication"("userId");

-- CreateIndex
CREATE INDEX "ProviderApplication_governorate_idx" ON "ProviderApplication"("governorate");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceRequest_acceptedOfferId_key" ON "ServiceRequest"("acceptedOfferId");

-- CreateIndex
CREATE INDEX "ServiceRequest_status_searchExpiresAt_idx" ON "ServiceRequest"("status", "searchExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceRequest_customerId_clientRequestId_key" ON "ServiceRequest"("customerId", "clientRequestId");

-- AddForeignKey
ALTER TABLE "ProviderApplication" ADD CONSTRAINT "ProviderApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderApplication" ADD CONSTRAINT "ProviderApplication_vehicleDocumentId_fkey" FOREIGN KEY ("vehicleDocumentId") REFERENCES "UploadedFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationDecision" ADD CONSTRAINT "ApplicationDecision_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "ProviderApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationDecision" ADD CONSTRAINT "ApplicationDecision_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_acceptedOfferId_fkey" FOREIGN KEY ("acceptedOfferId") REFERENCES "RequestOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_fallbackFromId_fkey" FOREIGN KEY ("fallbackFromId") REFERENCES "ServiceRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestOffer" ADD CONSTRAINT "RequestOffer_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ServiceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestOffer" ADD CONSTRAINT "RequestOffer_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtraCharge" ADD CONSTRAINT "ExtraCharge_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ServiceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtraCharge" ADD CONSTRAINT "ExtraCharge_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestInvite" ADD CONSTRAINT "RequestInvite_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ServiceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestInvite" ADD CONSTRAINT "RequestInvite_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestInvite" ADD CONSTRAINT "RequestInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ServiceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_filedById_fkey" FOREIGN KEY ("filedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionEntry" ADD CONSTRAINT "CommissionEntry_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ServiceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionEntry" ADD CONSTRAINT "CommissionEntry_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionEntry" ADD CONSTRAINT "CommissionEntry_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "CommissionSettlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionSettlement" ADD CONSTRAINT "CommissionSettlement_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionSettlement" ADD CONSTRAINT "CommissionSettlement_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ==========================================================================
-- Hand-written constraints (Prisma cannot express these)
-- ==========================================================================

ALTER SEQUENCE "provider_application_ref_seq"
  OWNED BY "ProviderApplication"."publicReference";

-- Money: never negative, and a total is always exactly the sum of its parts.
ALTER TABLE "RequestOffer"
  ADD CONSTRAINT "RequestOffer_money_nonneg"
    CHECK ("calloutFeeSyp" >= 0 AND "laborSyp" >= 0 AND "partsSyp" >= 0),
  ADD CONSTRAINT "RequestOffer_total_is_sum"
    CHECK ("totalSyp" = "calloutFeeSyp" + "laborSyp" + "partsSyp"),
  ADD CONSTRAINT "RequestOffer_eta_range"
    CHECK ("etaMinutes" BETWEEN 1 AND 1440);

ALTER TABLE "ExtraCharge"
  ADD CONSTRAINT "ExtraCharge_money_nonneg"
    CHECK ("laborSyp" >= 0 AND "partsSyp" >= 0),
  ADD CONSTRAINT "ExtraCharge_total_is_sum"
    CHECK ("totalSyp" = "laborSyp" + "partsSyp" AND "totalSyp" > 0);

ALTER TABLE "ServiceRequest"
  ADD CONSTRAINT "ServiceRequest_money_nonneg"
    CHECK (("finalAmountSyp" IS NULL OR "finalAmountSyp" >= 0) AND "commissionSyp" >= 0),
  ADD CONSTRAINT "ServiceRequest_commission_rate_range"
    CHECK ("commissionRateBps" BETWEEN 0 AND 10000);

ALTER TABLE "CommissionEntry"
  ADD CONSTRAINT "CommissionEntry_money_nonneg"
    CHECK ("amountSyp" >= 0 AND "baseAmountSyp" >= 0 AND "rateBps" BETWEEN 0 AND 10000);

ALTER TABLE "CommissionSettlement"
  ADD CONSTRAINT "CommissionSettlement_positive" CHECK ("amountSyp" > 0);

-- At most ONE accepted offer per request: the database's own guard against
-- double booking, underneath the compare-and-swap in the service layer.
CREATE UNIQUE INDEX "RequestOffer_one_accepted_per_request"
  ON "RequestOffer"("requestId") WHERE "status" = 'ACCEPTED';

-- At most one live offer per provider per request: a provider revises by
-- withdrawing and offering again, never by stacking offers.
CREATE UNIQUE INDEX "RequestOffer_one_pending_per_provider"
  ON "RequestOffer"("requestId", "providerId") WHERE "status" = 'PENDING';

-- An accepted price is a record, not a draft. Any attempt to change the money
-- or status of an ACCEPTED offer - from the app, a script or a console - fails.
CREATE FUNCTION "freeze_accepted_offer"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'ACCEPTED' AND (
       NEW."calloutFeeSyp" <> OLD."calloutFeeSyp" OR
       NEW."laborSyp"      <> OLD."laborSyp"      OR
       NEW."partsSyp"      <> OLD."partsSyp"      OR
       NEW."totalSyp"      <> OLD."totalSyp"      OR
       NEW."status"        <> OLD."status"
     ) THEN
    RAISE EXCEPTION 'accepted offer % is immutable', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RequestOffer_freeze_accepted"
  BEFORE UPDATE ON "RequestOffer"
  FOR EACH ROW EXECUTE FUNCTION "freeze_accepted_offer"();
