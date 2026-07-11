-- Agrovet extension migration (additive, non-destructive).
-- Applied to the shared instance via the pg driver because the Prisma
-- migration engine cannot reach the DB host from the build environment.

-- Enums (guarded: CREATE TYPE has no IF NOT EXISTS in PG <=14 via plain DDL)
DO $$ BEGIN
  CREATE TYPE "ProductDepartment" AS ENUM ('GENERAL','AGRO','VET');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "EbmStatus" AS ENUM ('PENDING','SUCCESS','FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "DiscountRequestStatus" AS ENUM ('PENDING','APPROVED','REJECTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Product.department
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "department" "ProductDepartment" NOT NULL DEFAULT 'GENERAL';

-- Sale additions
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "cash_session_id" BIGINT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "discount_amount" DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "vat_amount" DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "ebm_invoice_number" TEXT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "ebm_receipt_data" JSONB;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "ebm_status" "EbmStatus" NOT NULL DEFAULT 'PENDING';
DO $$ BEGIN
  ALTER TABLE "Sale" ADD CONSTRAINT "Sale_cash_session_id_fkey"
    FOREIGN KEY ("cash_session_id") REFERENCES "CashSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- DiscountRequest
CREATE TABLE IF NOT EXISTS "DiscountRequest" (
  "id" BIGSERIAL PRIMARY KEY,
  "organization_id" BIGINT NOT NULL,
  "branch_id" BIGINT,
  "requested_by_id" BIGINT NOT NULL,
  "reviewed_by_id" BIGINT,
  "customer_id" BIGINT,
  "amount" DECIMAL(15,2) NOT NULL,
  "sale_total" DECIMAL(15,2) NOT NULL,
  "reason" TEXT,
  "status" "DiscountRequestStatus" NOT NULL DEFAULT 'PENDING',
  "applied_sale_id" BIGINT,
  "review_comment" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" TIMESTAMP(3)
);
DO $$ BEGIN
  ALTER TABLE "DiscountRequest" ADD CONSTRAINT "DiscountRequest_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id");
  ALTER TABLE "DiscountRequest" ADD CONSTRAINT "DiscountRequest_branch_fkey" FOREIGN KEY ("branch_id") REFERENCES "Branch"("id");
  ALTER TABLE "DiscountRequest" ADD CONSTRAINT "DiscountRequest_reqby_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "User"("id");
  ALTER TABLE "DiscountRequest" ADD CONSTRAINT "DiscountRequest_revby_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "User"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- NotificationEvent
CREATE TABLE IF NOT EXISTS "NotificationEvent" (
  "id" BIGSERIAL PRIMARY KEY,
  "organization_id" BIGINT NOT NULL,
  "branch_id" BIGINT,
  "type" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'INFO',
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "target_role" TEXT,
  "data" JSONB,
  "is_read" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
DO $$ BEGIN
  ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id");
  ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_branch_fkey" FOREIGN KEY ("branch_id") REFERENCES "Branch"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
CREATE INDEX IF NOT EXISTS "NotificationEvent_org_read_idx" ON "NotificationEvent"("organization_id","is_read");
CREATE INDEX IF NOT EXISTS "NotificationEvent_org_type_idx" ON "NotificationEvent"("organization_id","type");

-- SupplierPayment
CREATE TABLE IF NOT EXISTS "SupplierPayment" (
  "id" BIGSERIAL PRIMARY KEY,
  "organization_id" BIGINT NOT NULL,
  "supplier_id" BIGINT NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL,
  "payment_method" "PaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
  "reference" TEXT,
  "note" TEXT,
  "created_by_id" BIGINT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
DO $$ BEGIN
  ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id");
  ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_sup_fkey" FOREIGN KEY ("supplier_id") REFERENCES "Supplier"("id");
  ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_by_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
CREATE INDEX IF NOT EXISTS "SupplierPayment_org_sup_idx" ON "SupplierPayment"("organization_id","supplier_id");
