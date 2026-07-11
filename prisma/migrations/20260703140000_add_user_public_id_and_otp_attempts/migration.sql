ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "public_id" TEXT;

-- Backfill existing rows with a deterministic public id derived from the
-- real numeric id, matching the format used for new registrations
-- (see AuthService.registerTenant): MC-000123.
UPDATE "User"
SET "public_id" = 'MC-' || LPAD("id"::text, 6, '0')
WHERE "public_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "User_public_id_key" ON "User"("public_id");

ALTER TABLE "VerificationToken"
ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
