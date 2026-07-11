CREATE TABLE IF NOT EXISTS "ProductSupplier" (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES "Product"(id) ON DELETE CASCADE,
  supplier_id BIGINT NOT NULL REFERENCES "Supplier"(id) ON DELETE CASCADE,
  created_at TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "ProductSupplier_product_id_supplier_id_key" UNIQUE (product_id, supplier_id)
);
