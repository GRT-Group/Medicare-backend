ALTER TABLE "UserSession"
ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMP(3);

UPDATE "UserSession"
SET "expires_at" = COALESCE("expires_at", "login_at" + INTERVAL '1 hour')
WHERE "expires_at" IS NULL;
