-- Adds the unguessable tracking token used by /track/<token>.
--
-- Done in three steps rather than one, because the column is NOT NULL and
-- UNIQUE while the table already holds rows: adding it directly would fail.
--   1. add it nullable
--   2. backfill existing rows with random values
--   3. tighten to NOT NULL and add the unique index

-- 1 ------------------------------------------------------------------------
ALTER TABLE "ServiceRequest" ADD COLUMN "trackingToken" TEXT;

-- 2 ------------------------------------------------------------------------
-- Two concatenated UUIDs give 32 random bytes of entropy, which is plenty for
-- the handful of demo rows this touches. New rows get their token from the
-- application (crypto.randomBytes), not from here.
UPDATE "ServiceRequest"
SET "trackingToken" = replace(gen_random_uuid()::text, '-', '')
                   || replace(gen_random_uuid()::text, '-', '')
WHERE "trackingToken" IS NULL;

-- 3 ------------------------------------------------------------------------
ALTER TABLE "ServiceRequest" ALTER COLUMN "trackingToken" SET NOT NULL;

CREATE UNIQUE INDEX "ServiceRequest_trackingToken_key"
  ON "ServiceRequest"("trackingToken");
