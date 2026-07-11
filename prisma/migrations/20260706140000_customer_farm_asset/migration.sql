-- CustomerFarmAsset: a farmer-customer's declared farm assets (crops,
-- livestock) — agrovet-specific customer profile data. Additive, non-destructive.
-- Applied to the shared instance via the pg driver because the Prisma
-- migration engine cannot reach the DB host from the build environment.

DO $$ BEGIN
  CREATE TYPE "FarmAssetType" AS ENUM ('CROP', 'LIVESTOCK');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "CustomerFarmAsset" (
  "id" BIGSERIAL PRIMARY KEY,
  "organization_id" BIGINT NOT NULL,
  "customer_id" BIGINT NOT NULL,
  "type" "FarmAssetType" NOT NULL,
  "name" TEXT NOT NULL,
  "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
  "unit" TEXT,
  "notes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_by_id" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_by_id" BIGINT,
  "deleted_at" TIMESTAMP(3),
  "is_deleted" BOOLEAN NOT NULL DEFAULT false,
  "restore_allowed" BOOLEAN NOT NULL DEFAULT true
);

DO $$ BEGIN
  ALTER TABLE "CustomerFarmAsset" ADD CONSTRAINT "CustomerFarmAsset_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "CustomerFarmAsset" ADD CONSTRAINT "CustomerFarmAsset_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "CustomerFarmAsset" ADD CONSTRAINT "CustomerFarmAsset_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "CustomerFarmAsset" ADD CONSTRAINT "CustomerFarmAsset_deleted_by_id_fkey"
    FOREIGN KEY ("deleted_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "CustomerFarmAsset_organization_id_customer_id_idx" ON "CustomerFarmAsset"("organization_id", "customer_id");
CREATE INDEX IF NOT EXISTS "CustomerFarmAsset_organization_id_type_idx" ON "CustomerFarmAsset"("organization_id", "type");
