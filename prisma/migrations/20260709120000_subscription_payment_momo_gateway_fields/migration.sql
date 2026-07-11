-- MTN MoMo (Mobile Money) gateway tracking fields on SubscriptionPayment:
-- the request-to-pay reference (idempotency key + polling/webhook lookup),
-- the raw provider status/reason, the payer phone, and when we last checked.
-- Additive only, all nullable, existing rows unaffected.
-- Applied via the pg driver (Prisma migration engine can't reach the DB
-- host from the build environment) — see prior *_expansion migrations.

ALTER TABLE "SubscriptionPayment" ADD COLUMN IF NOT EXISTS "gateway_reference" TEXT;
ALTER TABLE "SubscriptionPayment" ADD COLUMN IF NOT EXISTS "gateway_status" TEXT;
ALTER TABLE "SubscriptionPayment" ADD COLUMN IF NOT EXISTS "gateway_reason" TEXT;
ALTER TABLE "SubscriptionPayment" ADD COLUMN IF NOT EXISTS "gateway_phone" TEXT;
ALTER TABLE "SubscriptionPayment" ADD COLUMN IF NOT EXISTS "gateway_checked_at" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionPayment_gateway_reference_key" ON "SubscriptionPayment"("gateway_reference");
