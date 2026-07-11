-- Brings every _RecycleBin table onto the same generic shape (original_id + snapshot JSON)
-- that ArchiveService.softDelete/restore assumes. 17 of these tables were denormalized
-- (mirrored source columns instead of a JSON snapshot) and had no original_id/snapshot at
-- all, which made every soft-delete of that entity type throw inside the transaction.
ALTER TABLE "PurchaseOrderItem_RecycleBin" ADD COLUMN IF NOT EXISTS original_id BIGINT;
ALTER TABLE "PurchaseOrderItem_RecycleBin" ADD COLUMN IF NOT EXISTS snapshot JSONB;

ALTER TABLE "PurchaseOrder_RecycleBin" ADD COLUMN IF NOT EXISTS original_id BIGINT;
ALTER TABLE "PurchaseOrder_RecycleBin" ADD COLUMN IF NOT EXISTS snapshot JSONB;

ALTER TABLE "Return_RecycleBin" ADD COLUMN IF NOT EXISTS original_id BIGINT;
ALTER TABLE "Return_RecycleBin" ADD COLUMN IF NOT EXISTS snapshot JSONB;

ALTER TABLE "RolePermission_RecycleBin" ADD COLUMN IF NOT EXISTS original_id BIGINT;
ALTER TABLE "RolePermission_RecycleBin" ADD COLUMN IF NOT EXISTS snapshot JSONB;

ALTER TABLE "SaleItem_RecycleBin" ADD COLUMN IF NOT EXISTS original_id BIGINT;
ALTER TABLE "SaleItem_RecycleBin" ADD COLUMN IF NOT EXISTS snapshot JSONB;

ALTER TABLE "Sale_RecycleBin" ADD COLUMN IF NOT EXISTS original_id BIGINT;
ALTER TABLE "Sale_RecycleBin" ADD COLUMN IF NOT EXISTS snapshot JSONB;

ALTER TABLE "StockTransferItem_RecycleBin" ADD COLUMN IF NOT EXISTS original_id BIGINT;
ALTER TABLE "StockTransferItem_RecycleBin" ADD COLUMN IF NOT EXISTS snapshot JSONB;

ALTER TABLE "StockTransfer_RecycleBin" ADD COLUMN IF NOT EXISTS original_id BIGINT;
ALTER TABLE "StockTransfer_RecycleBin" ADD COLUMN IF NOT EXISTS snapshot JSONB;

ALTER TABLE "SubscriptionPayment_RecycleBin" ADD COLUMN IF NOT EXISTS original_id BIGINT;
ALTER TABLE "SubscriptionPayment_RecycleBin" ADD COLUMN IF NOT EXISTS snapshot JSONB;

ALTER TABLE "SubscriptionPlan_RecycleBin" ADD COLUMN IF NOT EXISTS original_id BIGINT;
ALTER TABLE "SubscriptionPlan_RecycleBin" ADD COLUMN IF NOT EXISTS snapshot JSONB;

ALTER TABLE "Subscription_RecycleBin" ADD COLUMN IF NOT EXISTS original_id BIGINT;
ALTER TABLE "Subscription_RecycleBin" ADD COLUMN IF NOT EXISTS snapshot JSONB;

ALTER TABLE "UserPermission_RecycleBin" ADD COLUMN IF NOT EXISTS original_id BIGINT;
ALTER TABLE "UserPermission_RecycleBin" ADD COLUMN IF NOT EXISTS snapshot JSONB;

ALTER TABLE "UserRole_RecycleBin" ADD COLUMN IF NOT EXISTS original_id BIGINT;
ALTER TABLE "UserRole_RecycleBin" ADD COLUMN IF NOT EXISTS snapshot JSONB;

ALTER TABLE "UserSession_RecycleBin" ADD COLUMN IF NOT EXISTS original_id BIGINT;
ALTER TABLE "UserSession_RecycleBin" ADD COLUMN IF NOT EXISTS snapshot JSONB;

ALTER TABLE "User_RecycleBin" ADD COLUMN IF NOT EXISTS original_id BIGINT;
ALTER TABLE "User_RecycleBin" ADD COLUMN IF NOT EXISTS snapshot JSONB;

ALTER TABLE "VerificationToken_RecycleBin" ADD COLUMN IF NOT EXISTS original_id BIGINT;
ALTER TABLE "VerificationToken_RecycleBin" ADD COLUMN IF NOT EXISTS snapshot JSONB;

ALTER TABLE "Supplier_RecycleBin" ADD COLUMN IF NOT EXISTS original_id BIGINT;
ALTER TABLE "Supplier_RecycleBin" ADD COLUMN IF NOT EXISTS snapshot JSONB;
