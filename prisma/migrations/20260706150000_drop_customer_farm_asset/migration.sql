-- Reverts the CustomerFarmAsset table/enum introduced in
-- 20260706140000_customer_farm_asset. Farm assets (crops/livestock) are now
-- stored in the existing Customer.metadata JSON field instead of a
-- dedicated table.

DROP TABLE IF EXISTS "CustomerFarmAsset";
DROP TYPE IF EXISTS "FarmAssetType";
