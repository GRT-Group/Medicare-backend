-- Track who closed a shift, alongside the existing opener (user_id) and
-- deleted_by_id. Additive/non-destructive.
ALTER TABLE "CashSession" ADD COLUMN IF NOT EXISTS "closed_by_id" BIGINT;

DO $$ BEGIN
  ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_closed_by_id_fkey"
    FOREIGN KEY ("closed_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
