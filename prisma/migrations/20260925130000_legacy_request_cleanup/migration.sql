-- Requests carried over from the manual-dispatch model.
--
-- ASSIGNED rows were mapped to SEARCHING, but kept the provider the
-- dispatcher had picked. In the offer model a SEARCHING request has nobody
-- booked, so the assignment is released (it is still in the status history).
UPDATE "ServiceRequest"
SET "assignedProviderId" = NULL,
    "assignedAt" = NULL
WHERE "status" = 'SEARCHING'
  AND "acceptedOfferId" IS NULL
  AND "assignedProviderId" IS NOT NULL;

-- Old searching rows had no search window at all, so the timeout sweep could
-- never close them. Give them one that ends now: the next sweep closes them
-- as NO_PROVIDER_AVAILABLE, and the customer can restart the search.
UPDATE "ServiceRequest"
SET "searchStartedAt" = COALESCE("searchStartedAt", "createdAt"),
    "searchExpiresAt" = now()
WHERE "status" = 'SEARCHING'
  AND "searchExpiresAt" IS NULL;
