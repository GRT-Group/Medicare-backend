-- Supplier profile expansion: structured contact/identity fields for both
-- INDIVIDUAL and COMPANY supplier types, plus an auto-generated
-- supplier_code (SUP-000001). Additive only — the legacy contact_info
-- free-text column is kept for backward compatibility.
-- Applied via the pg driver (Prisma migration engine can't reach the DB
-- host from the build environment).

ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "supplier_code" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "address" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "tax_id" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "contact_person" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "contact_person_phone" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "registration_number" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "national_id" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "notes" TEXT;

-- Backfill supplier_code for existing rows: SUP-000001, SUP-000002, ...
-- ordered by id so codes are stable and predictable.
WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "id") AS rn
  FROM "Supplier"
  WHERE "supplier_code" IS NULL
)
UPDATE "Supplier" s
SET "supplier_code" = 'SUP-' || LPAD(numbered.rn::text, 6, '0')
FROM numbered
WHERE s."id" = numbered."id";

CREATE UNIQUE INDEX IF NOT EXISTS "Supplier_supplier_code_key" ON "Supplier"("supplier_code");
