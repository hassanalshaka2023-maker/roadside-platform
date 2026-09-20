-- CreateEnum
CREATE TYPE "FileLinkStatus" AS ENUM ('UNATTACHED', 'ATTACHED', 'DELETED');

-- AlterTable
ALTER TABLE "ServiceRequest" ALTER COLUMN "publicCode" SET DEFAULT ('RS-' || lpad(nextval('service_request_public_code_seq')::text, 6, '0'));

-- AlterTable
ALTER TABLE "UploadedFile" ADD COLUMN     "attachedAt" TIMESTAMP(3),
ADD COLUMN     "keyVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "scannedAt" TIMESTAMP(3),
ADD COLUMN     "status" "FileLinkStatus" NOT NULL DEFAULT 'UNATTACHED';

-- CreateIndex
CREATE INDEX "UploadedFile_status_createdAt_idx" ON "UploadedFile"("status", "createdAt");

-- CreateIndex
CREATE INDEX "UploadedFile_keyVersion_idx" ON "UploadedFile"("keyVersion");
