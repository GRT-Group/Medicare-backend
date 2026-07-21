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

  static async initiateGeneralTransfer(organizationId: bigint, data: {
    from_branch_id: bigint;
    to_branch_id: bigint;
    reference?: string;
    notes?: string;
    transfer_date?: Date;
    expected_date?: Date;
    completed_date?: Date;
    items: Array<{ product_id: bigint; quantity: number }>;
  }, adminId: bigint) {
    return prisma.$transaction(async (tx) => {
      const org = await tx.organization.findUnique({ where: { id: organizationId } });
      const method = org?.inventory_method || 'FIFO';
      const orderBy = method === 'LIFO' 
        ? [{ id: 'desc' as any }] 
        : [{ expiry_date: 'asc' as any }, { id: 'asc' as any }];

      const detailedItems: Array<{ product_id: bigint; batch_id: bigint; quantity: number }> = [];

      for (const item of data.items) {
        const activeBatches = await tx.productBatch.findMany({
          where: { product_id: item.product_id, organization_id: organizationId, is_deleted: false, quantity_remaining: { gt: 0 } },
          orderBy: orderBy
        });

        let remainingQtyToTransfer = item.quantity;
        let totalResolved = 0;

        for (const batch of activeBatches) {
          if (remainingQtyToTransfer <= 0) break;
          const take = Math.min(batch.quantity_remaining, remainingQtyToTransfer);

          detailedItems.push({
            product_id: item.product_id,
            batch_id: batch.id,
            quantity: take
          });

          remainingQtyToTransfer -= take;
          totalResolved += take;
        }

        if (remainingQtyToTransfer > 0) {
          const product = await tx.product.findUnique({ where: { id: item.product_id } });
          throw new Error(`Insufficient stock for product "${product?.name || item.product_id}". Cannot transfer ${item.quantity}. Only ${totalResolved} available in branch.`);
        }
      }

      // 2. Delegate to the core transfer logic
      return this.initiateTransfer(organizationId, {
        from_branch_id: data.from_branch_id,
        to_branch_id: data.to_branch_id,
        reference: data.reference,
        notes: data.notes,
        transfer_date: data.transfer_date,
        expected_date: data.expected_date,
        completed_date: data.completed_date,
        items: detailedItems
      }, adminId, tx);
    });
  }

  static async initiateTransfer(organizationId: bigint, data: {
    from_branch_id: bigint;
    to_branch_id: bigint;
    reference?: string;
    notes?: string;
    transfer_date?: Date;
    expected_date?: Date;
    completed_date?: Date;
    items: Array<{ product_id: bigint; batch_id: bigint; quantity: number }>;
  }, adminId: bigint, providedTx?: any) {
    const run = async (tx: any) => {
      // 0. Compute total value impact to determine risk level
      let totalValue = 0;
      let totalQuantity = 0;
      for (const item of data.items) {
        const batch = await tx.productBatch.findUnique({ where: { id: item.batch_id } });
        if (batch) {
          totalValue += item.quantity * Number(batch.unit_cost || 0);
        }
        totalQuantity += item.quantity;
      }
      const riskLevel = (totalQuantity > 100 || totalValue > 50000) ? 'High Risk' : 'Normal';

      // 1. Create StockTransfer record
      const transfer = await tx.stockTransfer.create({
        data: {
          organization_id: organizationId,
          from_branch_id: data.from_branch_id,
          to_branch_id: data.to_branch_id,
          reference: data.reference,
          notes: data.notes,
          transfer_date: data.transfer_date,
          expected_date: data.expected_date,
          completed_date: data.completed_date,
          status: 'PENDING',
          created_by_id: adminId,
          risk_level: riskLevel,
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

      // 2. Deduct stock from origin branch via InventoryMovement and ProductBatch
      for (const item of data.items) {
        // Find batch to verify
        const batch = await tx.productBatch.findUniqueOrThrow({
          where: { id: item.batch_id, organization_id: organizationId }
        });
        if (batch.quantity_remaining < item.quantity) {
          throw new Error(`Insufficient stock in batch ${batch.batch_number} for transfer.`);
        }

        // Deduct from batch immediately (since stock is moving OUT of source branch)
        await tx.productBatch.update({
          where: { id: item.batch_id },
          data: { quantity_remaining: batch.quantity_remaining - item.quantity }
        });

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
    };

    if (providedTx) {
      return run(providedTx);
    }
    return prisma.$transaction(run, { timeout: 20000, maxWait: 10000 });
  }

  static async updateTransferStatus(transferId: bigint, action: 'approve' | 'transit' | 'complete' | 'cancel', organizationId: bigint, adminId: bigint) {
    if (action === 'complete') {
      return this.completeTransfer(transferId, organizationId, adminId);
    }
    
    return prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findFirstOrThrow({
        where: { id: transferId, organization_id: organizationId }
      });

      let newStatus: any = transfer.status;
      if (action === 'approve') {
        newStatus = 'APPROVED';
        if (transfer.status !== 'PENDING') throw new Error(`Cannot approve transfer in status ${transfer.status}`);
      } else if (action === 'transit') {
        newStatus = 'IN_TRANSIT';
        if (transfer.status !== 'APPROVED' && transfer.status !== 'PENDING') throw new Error(`Cannot dispatch transfer in status ${transfer.status}`);
      } else if (action === 'cancel') {
        newStatus = 'CANCELLED';
        if (transfer.status === 'COMPLETED') throw new Error('Cannot cancel a completed transfer');
        
        // Return stock to source branch if it was already deducted
        // In our current logic, stock is deducted in `initiateTransfer` (PENDING).
        // If we cancel, we need to return it.
        const items = await tx.stockTransferItem.findMany({ where: { transfer_id: transferId } });
        for (const item of items) {
          const batch = await tx.productBatch.findUnique({ where: { id: item.batch_id } });
          if (batch) {
            await tx.productBatch.update({
              where: { id: item.batch_id },
              data: { quantity_remaining: batch.quantity_remaining + item.quantity }
            });
            await tx.inventoryMovement.create({
              data: {
                organization_id: organizationId,
                branch_id: transfer.from_branch_id,
                product_id: item.product_id,
                batch_id: item.batch_id,
                movement_type_id: 'TRANSFER_CANCEL',
                type: 'STOCK_TRANSFER',
                quantity: item.quantity,
                reference_id: transfer.id.toString(),
                created_by_id: adminId
              }
            });
          }
        }
      }

      const updateData: any = { status: newStatus };
      if (action === 'approve') updateData.approved_by_id = adminId;
      
      const updatedTransfer = await tx.stockTransfer.update({
        where: { id: transferId },
        data: updateData
      });

      return updatedTransfer;
    });
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
