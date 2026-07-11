-- Customer table expansion to match the new customer profile spec.
-- Additive only: existing customer_type/status text columns are KEPT
-- (not dropped) for backward compatibility; customer_type_v2/status_v2 are
-- the new enum-backed columns going forward. id stays BigInt (not UUID) -
-- Sale/CustomerPayment/Quotation all reference it as BigInt; customer_code
-- is the new human-readable identifier instead.
-- Applied via the pg driver (Prisma migration engine can't reach the DB
-- host from the build environment).

-- 1. Enums
DO $$ BEGIN
  CREATE TYPE "CustomerTypeEnum" AS ENUM ('Individual', 'Farmer', 'Cooperative', 'Company', 'Vet Clinic');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "CustomerStatusEnum" AS ENUM ('Active', 'Inactive', 'Blacklisted');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "CustomerCreditStatus" AS ENUM ('Active', 'Suspended');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. New columns (all nullable/defaulted so existing rows are never invalid)
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "customer_code" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "province" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "district" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "sector" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "payment_terms" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "credit_status" "CustomerCreditStatus" NOT NULL DEFAULT 'Active';
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "customer_type_v2" "CustomerTypeEnum" NOT NULL DEFAULT 'Individual';
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "status_v2" "CustomerStatusEnum" NOT NULL DEFAULT 'Active';
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "updated_by_id" BIGINT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- credit_limit precision widened from Decimal(15,2) to Decimal(18,2) per spec.
ALTER TABLE "Customer" ALTER COLUMN "credit_limit" TYPE DECIMAL(18,2);

-- 3. Foreign keys for the new updated_by_id column
DO $$ BEGIN
  ALTER TABLE "Customer" ADD CONSTRAINT "Customer_updated_by_id_fkey"
    FOREIGN KEY ("updated_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 4. Backfill customer_type_v2 / status_v2 from the legacy text columns,
-- mapping existing values to their closest new-enum equivalent.
UPDATE "Customer" SET "customer_type_v2" = CASE
  WHEN "customer_type" = 'WHOLESALE' THEN 'Company'::"CustomerTypeEnum"
  ELSE 'Individual'::"CustomerTypeEnum"
END;

UPDATE "Customer" SET "status_v2" = CASE
  WHEN "status" = 'ACTIVE' THEN 'Active'::"CustomerStatusEnum"
  ELSE 'Inactive'::"CustomerStatusEnum"
END;

-- 5. Backfill customer_code for existing rows: CUS-000001, CUS-000002, ...
-- ordered by id so codes are stable and predictable.
WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "id") AS rn
  FROM "Customer"
  WHERE "customer_code" IS NULL
)
UPDATE "Customer" c
SET "customer_code" = 'CUS-' || LPAD(numbered.rn::text, 6, '0')
FROM numbered
WHERE c."id" = numbered."id";

-- 6. Unique index on customer_code (after backfill, so it can enforce cleanly)
CREATE UNIQUE INDEX IF NOT EXISTS "Customer_customer_code_key" ON "Customer"("customer_code");
