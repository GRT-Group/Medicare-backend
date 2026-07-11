import { prisma } from '@/lib/prisma';

export class InventoryService {
  // ==============================================
  // STOCK MOVEMENTS
  // ==============================================

  static async getInventoryMovements(organizationId: bigint, productId?: bigint) {
    const where: any = { organization_id: organizationId, deleted_at: null };
    if (productId) where.product_id = productId;

    return prisma.inventoryMovement.findMany({
      where,
      include: {
        Product: { select: { name: true, barcode: true } },
        ProductBatch: { select: { batch_number: true } },
        User_InventoryMovement_created_by_idToUser: { select: { first_name: true, last_name: true } }
      },
      orderBy: { timestamp: 'desc' }
    });
  }

  // ==============================================
  // STOCK ADJUSTMENT (DAMAGE / LOSS)
  // ==============================================

  static async adjustStock(organizationId: bigint, data: {
    product_id: bigint;
    batch_id: bigint;
    quantity_change: number; // e.g., -5 for loss, +2 for correction
    reason: string;
    note?: string;
  }, adminId: bigint) {
    return prisma.$transaction(async (tx) => {
      // 1. Fetch batch to verify stock
      const batch = await tx.productBatch.findUniqueOrThrow({
        where: { id: data.batch_id, organization_id: organizationId }
      });

      const newQuantity = batch.quantity_remaining + data.quantity_change;
      if (newQuantity < 0) {
        throw new Error(`Insufficient stock. Cannot deduct ${Math.abs(data.quantity_change)}. Remaining: ${batch.quantity_remaining}`);
      }

      // 2. Update Batch
      await tx.productBatch.update({
        where: { id: data.batch_id },
        data: { quantity_remaining: newQuantity }
      });

      // 3. Create Movement
      const movementType = data.quantity_change > 0 ? 'ADJUSTMENT_UP' : 'ADJUSTMENT_DOWN';

      const movement = await tx.inventoryMovement.create({
        data: {
          organization_id: organizationId,
          product_id: data.product_id,
          batch_id: data.batch_id,
          movement_type_id: movementType,
          quantity: Math.abs(data.quantity_change),
          reference_id: data.reason, // e.g., 'DAMAGED_STOCK'
          created_by_id: adminId
        }
      });

      // Add to AuditLog for safety (Optional, but good for adjustments)
      await tx.auditLog.create({
        data: {
          organization_id: organizationId,
          user_id: adminId,
          action: 'STOCK_ADJUSTMENT',
          table_affected: 'ProductBatch',
          record_id: data.batch_id.toString(),
          status: 'SUCCESS'
        }
      });

      return movement;
    });
  }

  // ==============================================
  // RECEIVE STOCK (GRN) - finds/creates category + product, then adds a batch
  // ==============================================

  static async receiveStock(organizationId: bigint, data: {
    productName: string;
    categoryId?: string | null;
    newCategoryName?: string | null;
    unitOfMeasure: string;
    reorderLevel?: number;
    batchNumber?: string;
    expiryDate?: string;
    quantity: number;
    unitCost: number;
    sellingPrice: number;
  }, adminId: bigint) {
    let categoryId: bigint;

    if (data.categoryId) {
      categoryId = BigInt(data.categoryId);
    } else {
      // No category chosen - find-or-create one under a default product type,
      // since Category.product_type_id is required but the GRN form doesn't collect it.
      let productType = await prisma.productType.findFirst({
        where: { organization_id: organizationId, deleted_at: null }
      });
      if (!productType) {
        productType = await prisma.productType.create({
          data: { organization_id: organizationId, name: 'General', created_by_id: adminId }
        });
      }

      const categoryName = data.newCategoryName?.trim() || 'Uncategorized';
      const existingCategory = await prisma.category.findFirst({
        where: { organization_id: organizationId, name: categoryName, deleted_at: null }
      });
      const category = existingCategory ?? await prisma.category.create({
        data: {
          organization_id: organizationId,
          product_type_id: productType.id,
          name: categoryName,
          created_by_id: adminId
        }
      });
      categoryId = category.id;
    }

    // Find-or-create the product by name within the resolved category.
    const existingProduct = await prisma.product.findFirst({
      where: { organization_id: organizationId, name: data.productName, deleted_at: null }
    });
    const product = existingProduct ?? await prisma.product.create({
      data: {
        organization_id: organizationId,
        category_id: categoryId,
        name: data.productName,
        unit_of_measure: data.unitOfMeasure,
        base_cost: data.unitCost,
        base_price: data.sellingPrice,
        reorder_level: data.reorderLevel || 0,
        created_by_id: adminId
      }
    });

    return this.addDirectStock(
      organizationId,
      {
        product_id: product.id,
        quantity: Number(data.quantity),
        unit_cost: Number(data.unitCost),
        selling_price: Number(data.sellingPrice),
        batch_number: data.batchNumber,
        expiry_date: data.expiryDate ? new Date(data.expiryDate) : undefined
      },
      adminId
    );
  }

  // ==============================================
  // PRODUCT BATCHES (CRUD)
  // ==============================================

  static async getBatches(organizationId: bigint) {
    return prisma.productBatch.findMany({
      where: { organization_id: organizationId, is_deleted: false },
      orderBy: { id: 'desc' }
    });
  }

  static async getBatchById(organizationId: bigint, batchId: bigint) {
    return prisma.productBatch.findFirst({
      where: { id: batchId, organization_id: organizationId, is_deleted: false }
    });
  }

  static async updateBatch(organizationId: bigint, batchId: bigint, data: {
    batch_number?: string;
    expiry_date?: Date | null;
    unit_cost?: number;
    selling_price?: number;
    quantity_remaining?: number;
    status?: string;
  }) {
    const existing = await prisma.productBatch.findFirst({
      where: { id: batchId, organization_id: organizationId, is_deleted: false }
    });
    if (!existing) throw new Error('Product batch not found');

    return prisma.productBatch.update({
      where: { id: batchId },
      data: {
        batch_number: data.batch_number,
        expiry_date: data.expiry_date,
        unit_cost: data.unit_cost,
        selling_price: data.selling_price,
        quantity_remaining: data.quantity_remaining,
        status: data.status
      }
    });
  }

  static async deleteBatch(organizationId: bigint, batchId: bigint, adminId: bigint) {
    const { ArchiveService } = await import('@/services/archive.service');
    const existing = await prisma.productBatch.findFirst({
      where: { id: batchId, organization_id: organizationId, is_deleted: false }
    });
    if (!existing) throw new Error('Product batch not found');
    return ArchiveService.softDelete(organizationId, 'productBatch', batchId, adminId);
  }

  // ==============================================
  // DIRECT STOCK ENTRY (NO PURCHASE ORDER)
  // ==============================================

  static async addDirectStock(organizationId: bigint, data: {
    product_id: bigint;
    quantity: number;
    unit_cost: number;
    selling_price: number;
    batch_number?: string;
    expiry_date?: Date;
  }, adminId: bigint) {
    return prisma.$transaction(async (tx) => {
      // 1. Create a ProductBatch
      const batch = await tx.productBatch.create({
        data: {
          organization_id: organizationId,
          product_id: data.product_id,
          batch_number: data.batch_number || `DIRECT-${Date.now()}`,
          quantity_remaining: data.quantity,
          unit_cost: data.unit_cost,
          selling_price: data.selling_price,
          expiry_date: data.expiry_date,
        }
      });

      // 2. Create the InventoryMovement (INCREASE)
      const movement = await tx.inventoryMovement.create({
        data: {
          organization_id: organizationId,
          product_id: data.product_id,
          batch_id: batch.id,
          movement_type_id: 'INCREASE',
          quantity: data.quantity,
          reference_id: 'DIRECT_STOCK_ENTRY',
          created_by_id: adminId
        }
      });

      // 3. Update Product's base_cost and base_price if provided
      await tx.product.update({
        where: { id: data.product_id },
        data: {
          base_cost: data.unit_cost,
          base_price: data.selling_price
        }
      });

      return { batch, movement };
    });
  }

  // ==============================================
  // BATCH DISPOSAL
  // ==============================================

  static async disposeBatch(organizationId: bigint, data: {
    batch_id: bigint;
    disposal_status: 'DISPOSED' | 'EXPIRED' | 'DAMAGED';
    disposal_reason?: string;
    branch_id?: bigint;
  }, adminId: bigint) {
    return prisma.$transaction(async (tx) => {
      const batch = await tx.productBatch.findUniqueOrThrow({
        where: { id: data.batch_id, organization_id: organizationId }
      });

      const remainingQty = batch.quantity_remaining;

      if (remainingQty <= 0) {
        throw new Error('Batch has no remaining stock to dispose.');
      }

      // 1. Zero out the batch
      const updatedBatch = await tx.productBatch.update({
        where: { id: data.batch_id },
        data: {
          quantity_remaining: 0,
          disposal_status: data.disposal_status,
          disposal_date: new Date(),
          disposal_reason: data.disposal_reason,
          status: 'INACTIVE' // Optional: mark as inactive
        }
      });

      // 2. Create Movement
      await tx.inventoryMovement.create({
        data: {
          organization_id: organizationId,
          branch_id: data.branch_id,
          product_id: batch.product_id,
          batch_id: batch.id,
          movement_type_id: 'DISPOSAL',
          quantity: remainingQty,
          reference_id: data.disposal_reason || data.disposal_status,
          created_by_id: adminId
        }
      });

      // 3. Audit Log
      await tx.auditLog.create({
        data: {
          organization_id: organizationId,
          branch_id: data.branch_id,
          user_id: adminId,
          module: 'INVENTORY',
          action: 'DISPOSE_BATCH',
          table_affected: 'ProductBatch',
          record_id: batch.id.toString(),
          after: { disposed_qty: remainingQty, reason: data.disposal_reason, status: data.disposal_status } as any
        }
      });

      return updatedBatch;
    });
  }
}
