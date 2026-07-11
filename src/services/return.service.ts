// @ts-nocheck
import { prisma } from '@/lib/prisma';
import { ReturnStatus } from '@prisma/client';
import { InventoryService } from '@/services/inventory.service';

export class ReturnService {
  static async getReturns(organizationId: bigint, branchId?: bigint) {
    const where: any = { organization_id: organizationId, deleted_at: null };
    if (branchId) where.branch_id = branchId;

    const returns = await prisma.return.findMany({
      where,
      include: {
        Sale: { select: { invoice_number: true } },
        Product: { select: { name: true } },
        ProductBatch: { select: { batch_number: true } },
        User_Return_created_by_idToUser: { select: { first_name: true, last_name: true } },
      },
      orderBy: { timestamp: 'desc' }
    });

    return returns.map(({ Sale, Product, ProductBatch, User_Return_created_by_idToUser, ...ret }) => ({
      ...ret,
      sale: Sale,
      product: Product,
      batch: ProductBatch,
      created_by: User_Return_created_by_idToUser
    }));
  }

  static async processReturn(organizationId: bigint, data: {
    sale_id: bigint;
    product_id: bigint;
    batch_id: bigint;
    quantity: number;
    reason?: string;
    type?: string;
    stock_restored?: boolean;
    refund_amount: number;
    branch_id: bigint;
  }, adminId: bigint) {
    return prisma.$transaction(async (tx) => {
      // 1. Verify Sale Item exists
      const saleItem = await tx.saleItem.findFirst({
        where: {
          sale_id: data.sale_id,
          product_id: data.product_id,
          batch_id: data.batch_id
        }
      });

      if (!saleItem) {
        throw new Error('Sale item not found for the given product and batch.');
      }
      
      if (saleItem.quantity < data.quantity) {
        throw new Error('Return quantity exceeds sold quantity.');
      }

      // 2. Add stock back to batch if requested
      const shouldRestoreStock = data.stock_restored !== false;

      if (shouldRestoreStock) {
        const batch = await tx.productBatch.findUniqueOrThrow({
          where: { id: data.batch_id }
        });

        await tx.productBatch.update({
          where: { id: data.batch_id },
          data: {
            quantity_remaining: batch.quantity_remaining + data.quantity
          }
        });

        // Increase global batch stock since item was returned
          await tx.productBatch.update({
            where: { id: data.batch_id },
            data: { quantity_remaining: batch.quantity_remaining + data.quantity }
          });
      }

      // 3. Create Return Record
      const returnRecord = await tx.return.create({
        data: {
          organization_id: organizationId,
          branch_id: data.branch_id,
          sale_id: data.sale_id,
          product_id: data.product_id,
          batch_id: data.batch_id,
          quantity: data.quantity,
          reason: data.reason,
          type: data.type || 'REFUND',
          stock_restored: shouldRestoreStock,
          refund_amount: data.refund_amount,
          status: 'COMPLETED',
          created_by_id: adminId
        }
      });

      // 4. Create Inventory Movement
      if (shouldRestoreStock) {
        await tx.inventoryMovement.create({
          data: {
            organization_id: organizationId,
            branch_id: data.branch_id,
            product_id: data.product_id,
            batch_id: data.batch_id,
            movement_type_id: 'RETURN',
            quantity: data.quantity,
            reference_id: returnRecord.id.toString(),
            created_by_id: adminId
          }
        });
      }

      // 5. Create Cashbook entry for the refund (Cash out)
      if (data.refund_amount > 0) {
        await tx.cashbook.create({
          data: {
            organization_id: organizationId,
            branch_id: data.branch_id,
            transaction_type: 'OUT',
            category: 'REFUND',
            amount: data.refund_amount,
            description: `Refund for return ${returnRecord.id}`,
            reference_id: data.sale_id.toString(),
            created_by_id: adminId
          }
        });
      }

      // 6. Audit Log
      await tx.auditLog.create({
        data: {
          organization_id: organizationId,
          branch_id: data.branch_id,
          user_id: adminId,
          module: 'RETURNS',
          action: 'PROCESS_RETURN',
          table_affected: 'Return',
          record_id: returnRecord.id.toString(),
          after: { quantity: data.quantity, refund: data.refund_amount, stock_restored: shouldRestoreStock, type: data.type } as any
        }
      });

      return returnRecord;
    });
  }
}
