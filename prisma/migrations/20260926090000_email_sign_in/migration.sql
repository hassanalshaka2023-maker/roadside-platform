-- Email sign-in (while no SMS gateway exists) and an unverified contact
-- phone for accounts that signed in by email.
ALTER TABLE "User" ADD COLUMN "isEmailVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "contactPhone" TEXT;
