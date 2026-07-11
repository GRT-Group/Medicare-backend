-- Supplier profile expansion v2: additional structured business fields
-- collected by the supplier edit form (country, business category, company
-- size, specialization/experience for individual suppliers, payment
-- preferences, credit/order limits, delivery availability, internal notes).
-- Additive only, all nullable/defaulted so existing rows are unaffected.
-- Applied via the pg driver (Prisma migration engine can't reach the DB
-- host from the build environment) — see 20260707100000_supplier_profile_expansion.

ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "country" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "business_category" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "company_size" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "website" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "specialization" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "experience_level" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "preferred_payment_method" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "currency" TEXT DEFAULT 'RWF';
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "credit_limit" DECIMAL(15,2);
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "lead_time_days" INTEGER;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "minimum_order_value" DECIMAL(15,2);
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "delivery_availability" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "internal_notes" TEXT;
