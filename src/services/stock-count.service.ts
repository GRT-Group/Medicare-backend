import { prisma } from '@/lib/prisma';
import { InventoryService } from './inventory.service';

export class StockCountService {
  static async initiateCount(organizationId: bigint, data: {
    branch_id?: bigint;
    product_id: bigint;
    count_number: string;
    system_quantity: number;
    counted_quantity: number;
    variance: number;
    notes?: string;
    count_date?: Date;
  }, adminId: bigint) {
    return prisma.stockCount.create({
      data: {
        organization_id: organizationId,
        branch_id: data.branch_id,
        product_id: data.product_id,
        count_number: data.count_number,
        system_quantity: data.system_quantity,
        counted_quantity: data.counted_quantity,
        variance: data.variance,
        notes: data.notes,
        count_date: data.count_date,
        created_by_id: adminId,
        status: 'ACTIVE'
      },
      include: {
        Product: { select: { name: true } },
        Branch: { select: { name: true } }
      }
    });
  }

  static async completeCount(countId: bigint, organizationId: bigint, adminId: bigint) {
    let countData: any;
    
    await prisma.$transaction(async (tx: any) => {
      const count = await tx.stockCount.findUniqueOrThrow({
        where: { id: countId, organization_id: organizationId }
      });

      if (count.status !== 'ACTIVE') {
        throw new Error(`Count is already ${count.status}`);
      }

      countData = count;

      // Mark as completed
      await tx.stockCount.update({
        where: { id: count.id },
        data: { status: 'COMPLETED' }
      });

      await tx.auditLog.create({
        data: {
          organization_id: organizationId,
          branch_id: count.branch_id || BigInt(0),
          user_id: adminId,
          module: 'INVENTORY',
          action: 'COMPLETE_STOCK_COUNT',
          table_affected: 'StockCount',
          record_id: count.id.toString(),
          after: { variance: count.variance, status: 'COMPLETED' } as any
        }
      });
    });

    // We do adjustGeneralStock OUTSIDE the transaction since adjustGeneralStock creates its own transaction.
    if (countData && countData.variance !== 0) {
      if (countData.variance < 0) {
        // Shortage: deduct stock
        await InventoryService.adjustGeneralStock(organizationId, {
          product_id: countData.product_id,
          quantity_change: countData.variance, // e.g., -5
          reference: 'STOCK_COUNT_SHORTAGE',
          note: `Auto-reconciled from Stock Count ${countData.count_number}`
        }, adminId);
      } else {
        // Surplus: add stock
        const lastBatch = await prisma.productBatch.findFirst({
          where: { product_id: countData.product_id, organization_id: organizationId },
          orderBy: { id: 'desc' }
        });

        await InventoryService.adjustGeneralStock(organizationId, {
          product_id: countData.product_id,
          quantity_change: countData.variance, // e.g., 5
          cost_price: lastBatch ? Number(lastBatch.unit_cost) : 0,
          selling_price: lastBatch ? Number(lastBatch.selling_price) : 0,
          reference: 'STOCK_COUNT_SURPLUS',
          note: `Auto-reconciled from Stock Count ${countData.count_number}`
        }, adminId);
      }
    }

    return prisma.stockCount.findUnique({
      where: { id: countId },
      include: {
        Product: { select: { name: true } }
      }
    });
  }

  static async getCounts(organizationId: bigint, status?: string) {
    const where: any = { organization_id: organizationId, is_deleted: false };
    if (status) where.status = status;

    return prisma.stockCount.findMany({
      where,
      include: {
        Product: { select: { name: true, sku: true } },
        Branch: { select: { name: true } },
        User: { select: { first_name: true, last_name: true } }
      },
      orderBy: { timestamp: 'desc' }
    });
  }
}
