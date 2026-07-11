-- Pricing snapshot columns on SubscriptionPayment (additive, non-destructive).
-- Applied to the shared instance via the pg driver because the Prisma
-- migration engine cannot reach the DB host from the build environment.

ALTER TABLE "SubscriptionPayment" ADD COLUMN IF NOT EXISTS "plan_name" TEXT;
ALTER TABLE "SubscriptionPayment" ADD COLUMN IF NOT EXISTS "plan_price" DECIMAL(15,2);
ALTER TABLE "SubscriptionPayment" ADD COLUMN IF NOT EXISTS "months" INTEGER;
ALTER TABLE "SubscriptionPayment" ADD COLUMN IF NOT EXISTS "base_amount" DECIMAL(15,2);
ALTER TABLE "SubscriptionPayment" ADD COLUMN IF NOT EXISTS "discount_percentage" DECIMAL(5,2);
ALTER TABLE "SubscriptionPayment" ADD COLUMN IF NOT EXISTS "discount_amount" DECIMAL(15,2);

-- Backfill existing rows with best-effort values derived from their linked
-- subscription/plan, so historical payments aren't left with blank columns
-- in the admin table.
UPDATE "SubscriptionPayment" sp
SET
  "plan_name" = COALESCE(sp."plan_name", s."plan_name"),
  "months" = COALESCE(sp."months", s."duration_months"),
  "plan_price" = COALESCE(sp."plan_price", plan.price),
  "base_amount" = COALESCE(sp."base_amount", plan.price * s."duration_months"),
  "discount_amount" = COALESCE(sp."discount_amount", GREATEST(plan.price * s."duration_months" - sp."amount", 0)),
  "discount_percentage" = COALESCE(
    sp."discount_percentage",
    CASE
      WHEN plan.price IS NOT NULL AND plan.price * s."duration_months" > 0
        THEN ROUND(GREATEST(plan.price * s."duration_months" - sp."amount", 0) / (plan.price * s."duration_months") * 100, 2)
      ELSE 0
    END
  )
FROM "Subscription" s
LEFT JOIN "SubscriptionPlan" plan ON plan.id = s.plan_id
WHERE sp.subscription_id = s.id
  AND sp."plan_name" IS NULL;
