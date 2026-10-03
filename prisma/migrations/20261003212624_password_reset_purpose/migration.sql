-- AlterEnum
ALTER TYPE "OtpPurpose" ADD VALUE 'PASSWORD_RESET';

-- AlterTable
ALTER TABLE "ProviderApplication" ALTER COLUMN "publicReference" SET DEFAULT ('AP-' || lpad(nextval('provider_application_ref_seq')::text, 6, '0'));

-- AlterTable
ALTER TABLE "ServiceRequest" ALTER COLUMN "publicCode" SET DEFAULT ('RS-' || lpad(nextval('service_request_public_code_seq')::text, 6, '0'));
