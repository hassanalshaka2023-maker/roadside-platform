-- Start of the current search round, so a retry does not count offers from
-- an earlier round.
ALTER TABLE "ServiceRequest" ADD COLUMN "searchStartedAt" TIMESTAMP(3);

UPDATE "ServiceRequest" SET "searchStartedAt" = "createdAt" WHERE "searchStartedAt" IS NULL;

-- An ACCEPTED offer keeps its money frozen forever. Its status may move to
-- WITHDRAWN only - when the booked provider drops out - so the partial unique
-- index "one accepted offer per request" lets the next offer be accepted.
CREATE OR REPLACE FUNCTION "freeze_accepted_offer"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'ACCEPTED' AND (
       NEW."calloutFeeSyp" <> OLD."calloutFeeSyp" OR
       NEW."laborSyp"      <> OLD."laborSyp"      OR
       NEW."partsSyp"      <> OLD."partsSyp"      OR
       NEW."totalSyp"      <> OLD."totalSyp"      OR
       (NEW."status" <> OLD."status" AND NEW."status" <> 'WITHDRAWN')
     ) THEN
    RAISE EXCEPTION 'accepted offer % is immutable', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
