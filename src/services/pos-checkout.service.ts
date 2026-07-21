import { prisma } from '@/lib/prisma';
import { InventoryService } from './inventory.service';
import { PricingEngine } from './pricing.service';

export class PosCheckoutService {
  /**
   * Finalize a draft sale, re-calculate totals, lock stock, deduct inventory, and complete.
   */
  static async checkout(saleId: bigint, organizationId: bigint, adminId: bigint, paymentAmount: number, paymentMethod: any) {
    return prisma.$transaction(async (tx) => {
      // 1. Fetch sale and lock it? (Usually locking the batches is more important)
      const sale = await tx.sale.findUniqueOrThrow({
        where: { id: saleId, organization_id: organizationId },
        include: { items: true }
      });

      if (sale.status !== 'PENDING' && sale.status !== 'HELD') {
        throw new Error(`Cannot checkout a sale in ${sale.status} status.`);
      }

      // 2. Map items for pricing engine
      const pricingItems = sale.items.map(i => ({
        quantity: i.quantity,
        unit_price: Number(i.unit_price),
        unit_cost: Number(i.unit_cost),
        line_discount: Number(i.line_discount),
        tax_rate: 0 // Optional: implement tax rate logic if needed
      }));

      // 3. Recompute totals securely on the server
      const totals = PricingEngine.recalculateTotals(pricingItems);

      if (paymentAmount < totals.grand_total) {
        throw new Error(`Insufficient payment. Grand total is ${totals.grand_total}`);
      }

      const changeDue = paymentAmount - totals.grand_total;

      // 4. Update Sale Items with recalculated line-level fields
      for (let i = 0; i < sale.items.length; i++) {
        const lineTotal = totals.items[i];
        await tx.saleItem.update({
          where: { id: sale.items[i].id },
          data: {
            subtotal: lineTotal.subtotal,
            line_tax: lineTotal.line_tax,
            line_profit: lineTotal.line_profit
          }
        });
      }

      // 5. Deduct inventory securely
      for (const item of sale.items) {
        // Because of the previous FIFO implementation, we can just use adjustGeneralStock,
        // BUT wait, adjustGeneralStock creates its own transaction, which we can't nest.
        // Also the items already have `batch_id` attached when they were added to cart!
        // We MUST use their specific batch_id to decrement to avoid race conditions.

        const batch = await tx.productBatch.findUnique({
          where: { id: item.batch_id }
        });

        if (!batch || batch.quantity_remaining < item.quantity) {
          throw new Error(`Insufficient stock for product ID ${item.product_id}. Request: ${item.quantity}, Available: ${batch?.quantity_remaining || 0}`);
        }

        await tx.productBatch.update({
          where: { id: batch.id },
          data: { quantity_remaining: batch.quantity_remaining - item.quantity }
        });

        // Log the inventory movement
        await tx.inventoryMovement.create({
          data: {
            organization_id: organizationId,
            branch_id: sale.branch_id || BigInt(0),
            product_id: item.product_id,
            batch_id: item.batch_id,
            movement_type_id: 'SALES',
            type: 'SALES',
            quantity: -item.quantity,
            reference_id: `SALE-${sale.id}`,
            created_by_id: adminId,
            status: 'ACTIVE'
          }
        });
      }

      // 6. Finalize Sale
      const completedSale = await tx.sale.update({
        where: { id: sale.id },
        data: {
          status: 'COMPLETED',
          payment_method: paymentMethod,
          total_amount: totals.grand_total, // The legacy field
          amount_paid: paymentAmount,
          subtotal: totals.subtotal,
          vat_amount: totals.tax_total,
          profit_total: totals.profit_total,
          margin_percent: totals.margin_percent,
          change_due: changeDue,
          completed_at: new Date()
        }
      });

      return completedSale;
    }, { timeout: 20000 });
  }
}
