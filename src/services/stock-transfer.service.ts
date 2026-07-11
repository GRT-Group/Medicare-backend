import { prisma } from '@/lib/prisma';
import { InventoryService } from './inventory.service';

export class StockTransferService {
  static async getTransfers(organizationId: bigint, branchId?: bigint) {
    const where: any = { organization_id: organizationId, deleted_at: null };
    if (branchId) {
      where.OR = [
        { from_branch_id: branchId },
        { to_branch_id: branchId }
      ];
    }

    return prisma.stockTransfer.findMany({
      where,
      include: {
        from_branch: { select: { name: true } },
        to_branch: { select: { name: true } },
        User_StockTransfer_created_by_idToUser: { select: { first_name: true, last_name: true } },
        items: {
          include: {
            Product: { select: { name: true } },
            ProductBatch: { select: { batch_number: true } }
          }
        }
      },
      orderBy: { timestamp: 'desc' }
    });
  }

  static async initiateTransfer(organizationId: bigint, data: {
    from_branch_id: bigint;
    to_branch_id: bigint;
    reference?: string;
    items: Array<{ product_id: bigint; batch_id: bigint; quantity: number }>;
  }, adminId: bigint) {
    return prisma.$transaction(async (tx) => {
      // 1. Create StockTransfer record
      const transfer = await tx.stockTransfer.create({
        data: {
          organization_id: organizationId,
          from_branch_id: data.from_branch_id,
          to_branch_id: data.to_branch_id,
          reference: data.reference,
          status: 'PENDING',
          created_by_id: adminId,
          items: {
            create: data.items.map(item => ({
              product_id: item.product_id,
              batch_id: item.batch_id,
              quantity: item.quantity
            }))
          }
        },
        include: { items: true }
      });

      // 2. Deduct stock from origin branch via InventoryMovement and BranchStock
      for (const item of data.items) {
        await tx.inventoryMovement.create({
          data: {
            organization_id: organizationId,
            branch_id: data.from_branch_id,
            product_id: item.product_id,
            batch_id: item.batch_id,
            movement_type_id: 'TRANSFER_OUT',
            type: 'STOCK_TRANSFER',
            quantity: item.quantity,
            reference_id: transfer.id.toString(),
            created_by_id: adminId
          }
        });

        // Update BranchStock
        
      }

      await tx.auditLog.create({
        data: {
          organization_id: organizationId,
          branch_id: data.from_branch_id,
          user_id: adminId,
          module: 'INVENTORY',
          action: 'INITIATE_TRANSFER',
          table_affected: 'StockTransfer',
          record_id: transfer.id.toString(),
          after: { to_branch: data.to_branch_id.toString(), items_count: data.items.length } as any
        }
      });

      return transfer;
    }, { timeout: 20000, maxWait: 10000 });
  }

  static async completeTransfer(transferId: bigint, organizationId: bigint, adminId: bigint) {
    return prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findFirstOrThrow({
        where: { id: transferId, organization_id: organizationId },
        include: { items: true }
      });

      if (transfer.status !== 'PENDING' && transfer.status !== 'IN_TRANSIT') {
        throw new Error(`Cannot complete transfer with status ${transfer.status}`);
      }

      // Update transfer status
      const updatedTransfer = await tx.stockTransfer.update({
        where: { id: transferId },
        data: { status: 'COMPLETED' }
      });

      // Add stock to destination branch via InventoryMovement and BranchStock
      for (const item of transfer.items) {
        await tx.inventoryMovement.create({
          data: {
            organization_id: organizationId,
            branch_id: transfer.to_branch_id,
            product_id: item.product_id,
            batch_id: item.batch_id,
            movement_type_id: 'TRANSFER_IN',
            type: 'STOCK_TRANSFER',
            quantity: item.quantity,
            reference_id: transfer.id.toString(),
            created_by_id: adminId
          }
        });

        // Update BranchStock
        
      }

      await tx.auditLog.create({
        data: {
          organization_id: organizationId,
          branch_id: transfer.to_branch_id,
          user_id: adminId,
          module: 'INVENTORY',
          action: 'COMPLETE_TRANSFER',
          table_affected: 'StockTransfer',
          record_id: transfer.id.toString(),
          after: { status: 'COMPLETED' } as any
        }
      });

      return updatedTransfer;
    }, { timeout: 20000, maxWait: 10000 });
  }
}
