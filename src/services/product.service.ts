// @ts-nocheck
import { prisma } from '@/lib/prisma';

export class ProductService {
  // ==============================================
  // PRODUCT TYPES
  // ==============================================

  static async getProductTypes(organizationId: bigint) {
    return prisma.productType.findMany({
      where: { organization_id: organizationId, deleted_at: null },
      orderBy: { name: 'asc' }
    });
  }

  static async createProductType(organizationId: bigint, data: { name: string }, adminId?: bigint) {
    return prisma.productType.create({
      data: {
        organization_id: organizationId,
        name: data.name,
        created_by_id: adminId
      }
    });
  }

  static async updateProductType(id: bigint, organizationId: bigint, data: { name?: string; status?: string }) {
    // Prisma's update() where-clause must resolve to a single unique key;
    // { id, organization_id } together isn't one (no compound unique on the
    // model), which throws. Verify tenant ownership first, then update by id.
    const existing = await prisma.productType.findFirst({ where: { id, organization_id: organizationId } });
    if (!existing) throw new Error('Product type not found');

    // Whitelist + coerce fields from the request body: ProductType has no
    // organizationId column, so blindly spreading the body (which the
    // frontend includes for its own bookkeeping) throws an unknown-argument
    // error in Prisma and surfaces as an opaque 500.
    const updateData: { name?: string; status?: string } = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.status !== undefined) updateData.status = data.status;

    return prisma.productType.update({
      where: { id },
      data: updateData
    });
  }

  static async deleteProductType(id: bigint, organizationId: bigint, adminId: bigint) {
    const { ArchiveService } = await import('@/services/archive.service');
    return ArchiveService.softDelete(organizationId, 'productType', id, adminId);
  }

  // ==============================================
  // CATEGORIES
  // ==============================================

  static async getCategories(organizationId: bigint, productTypeId?: bigint) {
    const where: any = { organization_id: organizationId, deleted_at: null };
    if (productTypeId) where.product_type_id = productTypeId;

    return prisma.category.findMany({
      where,
      orderBy: { name: 'asc' }
    });
  }

  static async createCategory(organizationId: bigint, data: { name: string; product_type_id: bigint | string }, adminId?: bigint) {
    return prisma.category.create({
      data: {
        organization_id: organizationId,
        product_type_id: BigInt(data.product_type_id),
        name: data.name,
        created_by_id: adminId
      }
    });
  }

  static async updateCategory(id: bigint, organizationId: bigint, data: { name?: string; product_type_id?: bigint | string; status?: string }) {
    const existing = await prisma.category.findFirst({ where: { id, organization_id: organizationId } });
    if (!existing) throw new Error('Category not found');

    // Whitelist + coerce fields from the request body: Category has no
    // organizationId column, and product_type_id must be a BigInt, but the
    // frontend sends it (and an extra organizationId) as plain strings from
    // a <select>. Spreading the raw body throws an unknown-argument /
    // type-mismatch error in Prisma and surfaces as an opaque 500.
    const updateData: { name?: string; product_type_id?: bigint; status?: string } = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.product_type_id !== undefined) updateData.product_type_id = BigInt(data.product_type_id);

    return prisma.category.update({
      where: { id },
      data: updateData
    });
  }

  static async deleteCategory(id: bigint, organizationId: bigint, adminId: bigint) {
    const { ArchiveService } = await import('@/services/archive.service');
    return ArchiveService.softDelete(organizationId, 'category', id, adminId);
  }

  // ==============================================
  // PRODUCTS
  // ==============================================

  static async getProducts(organizationId: bigint, categoryId?: bigint) {
    const where: any = { organization_id: organizationId, deleted_at: null };
    if (categoryId) where.category_id = categoryId;

    return prisma.product.findMany({
      where,
      include: {
        Category: {
          include: {
            ProductType: { select: { id: true, name: true } }
          }
        },
        ProductBatch: {
          where: { deleted_at: null, quantity_remaining: { gt: 0 } },
          orderBy: { expiry_date: 'asc' }
        }
      },
      orderBy: { name: 'asc' }
    });
  }

  static async createProduct(organizationId: bigint, data: {
    category_id: bigint;
    brand_id?: bigint;
    name: string;
    barcode?: string;
    unit_of_measure: string;
    base_cost?: number;
    base_price?: number;
    tax_rate?: number;
    reorder_level?: number;
    image_url?: string;
  }, adminId?: bigint) {
    return prisma.product.create({
      data: {
        organization_id: organizationId,
        category_id: data.category_id,
        brand_id: data.brand_id,
        name: data.name,
        barcode: data.barcode,
        unit_of_measure: data.unit_of_measure,
        base_cost: data.base_cost || 0,
        base_price: data.base_price || 0,
        tax_rate: data.tax_rate || 0,
        reorder_level: data.reorder_level || 0,
        image_url: data.image_url,
        created_by_id: adminId
      }
    });
  }

  static async updateProduct(id: bigint, organizationId: bigint, data: Partial<{
    category_id: bigint;
    brand_id: bigint;
    name: string;
    barcode: string;
    unit_of_measure: string;
    base_cost: number;
    base_price: number;
    tax_rate: number;
    reorder_level: number;
    status: string;
    image_url: string;
  }>, adminId: bigint) {
    return prisma.$transaction(async (tx) => {
      const oldProduct = await tx.product.findFirst({ where: { id, organization_id: organizationId } });
      if (!oldProduct) throw new Error('Product not found');

      const updated = await tx.product.update({
        where: { id },
        data
      });

      // PRODUCT HISTORY (Phase 3 Requirement)
      for (const [key, value] of Object.entries(data)) {
        if (oldProduct && (oldProduct as any)[key] !== value && value !== undefined) {
          await tx.productHistory.create({
            data: {
              product_id: id,
              user_id: adminId,
              field_changed: key,
              old_value: String((oldProduct as any)[key]),
              new_value: String(value),
              action: 'UPDATE'
            }
          });
        }
      }

      // SYSTEM RULE: "Product price is fixed but can be updated - But must log history"
      if (data.base_price !== undefined || data.base_cost !== undefined) {
        await tx.auditLog.create({
          data: {
            organization_id: organizationId,
            user_id: adminId,
            action: 'PRICE_UPDATE',
            table_affected: 'Product',
            record_id: id.toString(),
            status: `SUCCESS - Old Price: ${oldProduct?.base_price}, New Price: ${updated.base_price}`
          }
        });
      }

      if (data.base_cost !== undefined && Number(oldProduct?.base_cost) !== Number(data.base_cost)) {
        await tx.productCostHistory.create({
          data: {
            organization_id: organizationId,
            product_id: id,
            purchase_price: data.base_cost
          }
        });
      }

      return updated;
    });
  }

  static async deleteProduct(id: bigint, organizationId: bigint, adminId: bigint) {
    const { ArchiveService } = await import('@/services/archive.service');
    return ArchiveService.softDelete(organizationId, 'product', id, adminId);
  }

  // ==============================================
  // LIFECYCLE, SUPPLIERS, & COST HISTORY
  // ==============================================

  static async updateLifecycleStatus(id: bigint, organizationId: bigint, lifecycleStatus: string, adminId: bigint) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.product.findFirst({ where: { id, organization_id: organizationId } });
      if (!existing) throw new Error('Product not found');

      const product = await tx.product.update({
        where: { id },
        data: { lifecycle_status: lifecycleStatus }
      });

      await tx.auditLog.create({
        data: {
          organization_id: organizationId,
          user_id: adminId,
          action: 'UPDATE_LIFECYCLE',
          table_affected: 'Product',
          record_id: id.toString(),
          after: { lifecycle_status: lifecycleStatus } as any
        }
      });

      return product;
    });
  }

  static async addProductSupplier(productId: bigint, supplierId: bigint, organizationId: bigint) {
    // Ensure product belongs to org
    await prisma.product.findUniqueOrThrow({ where: { id: productId, organization_id: organizationId } });
    return prisma.productSupplier.create({
      data: {
        product_id: productId,
        supplier_id: supplierId
      }
    });
  }

  static async removeProductSupplier(productId: bigint, supplierId: bigint, organizationId: bigint) {
    await prisma.product.findUniqueOrThrow({ where: { id: productId, organization_id: organizationId } });
    return prisma.productSupplier.delete({
      where: {
        product_id_supplier_id: {
          product_id: productId,
          supplier_id: supplierId
        }
      }
    });
  }

  static async getProductCostHistory(productId: bigint, organizationId: bigint) {
    await prisma.product.findUniqueOrThrow({ where: { id: productId, organization_id: organizationId } });
    return prisma.productCostHistory.findMany({
      where: { product_id: productId },
      orderBy: { date: 'desc' }
    });
  }
}
