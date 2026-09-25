-- The customer could not place a pin: lat/lng is the governorate centre and
-- the landmark text describes the real location.
ALTER TABLE "ServiceRequest" ADD COLUMN "locationApproximate" BOOLEAN NOT NULL DEFAULT false;
