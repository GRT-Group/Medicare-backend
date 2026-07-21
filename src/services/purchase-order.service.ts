import { prisma } from '@/lib/prisma';
import { PricingEngine } from './pricing.service';

export class PurchaseOrderService {
  /**
   * Process a purchase order (can be DRAFT or RECEIVED).
   * If RECEIVED, it will automatically generate stock batches and adjust inventory.
   */
  static async processPurchaseOrder(data: any, organizationId: bigint, adminId: bigint) {
    return prisma.$transaction(async (tx) => {
      // 1. Calculate pricing securely
      const pricingItems = data.items.map((i: any) => ({
        quantity: Number(i.quantity),
        unit_price: Number(i.unit_cost), // For POs, the "price" the org pays is the unit_cost
        unit_cost: Number(i.unit_cost),
        line_discount: Number(i.line_discount || 0),
        tax_rate: Number(i.tax_rate || 0)
      }));

      const totals = PricingEngine.recalculateTotals(pricingItems);
      const shipping = Number(data.shipping_amount || 0);
      const grandTotal = totals.grand_total + shipping;
      const paidAmount = Number(data.paid_amount || 0);

      // 2. Create Header
      const poNumber = data.po_number || `PO-${Date.now()}`;
      
      const po = await tx.purchaseOrder.create({
        data: {
          organization_id: organizationId,
          created_by_id: adminId,
          po_number: poNumber,
          supplier_id: data.supplier_id ? BigInt(data.supplier_id) : undefined,
          branch_id: data.branch_id ? BigInt(data.branch_id) : undefined,
          status: data.status || 'DRAFT',
          payment_method: data.payment_method || null,
          notes: data.notes || null,
          
          subtotal: totals.subtotal,
          tax_amount: totals.tax_total,
          discount_amount: totals.discount_total,
          shipping_amount: shipping,
          total_amount: grandTotal,
          paid_amount: paidAmount,
          due_amount: Math.max(0, grandTotal - paidAmount),
          
          local_id: data.local_id || null,
          sync_status: data.local_id ? 'PENDING' : 'SYNCED',
          expected_delivery_date: data.expected_delivery_date ? new Date(data.expected_delivery_date) : null,
          actual_delivery_date: data.status === 'RECEIVED' ? new Date() : null,
        }
      });

      // 3. Process Items and Receive Stock
      for (let i = 0; i < data.items.length; i++) {
        const itemInput = data.items[i];
        const computed = totals.items[i];

        await tx.purchaseOrderItem.create({
          data: {
            purchase_order_id: po.id,
            product_id: BigInt(itemInput.product_id),
            expected_quantity: itemInput.quantity,
            received_quantity: data.status === 'RECEIVED' ? itemInput.quantity : 0,
            unit_cost: itemInput.unit_cost,
            selling_price: itemInput.selling_price || null,
            subtotal: computed.subtotal,
            tax_amount: computed.line_tax,
          }
        });

        // 4. If received, generate the stock batch instantly!
        if (data.status === 'RECEIVED') {
          // Fetch the current product to fallback the selling price if not provided
          const product = await tx.product.findUniqueOrThrow({
            where: { id: BigInt(itemInput.product_id) }
          });

          const sellingPrice = itemInput.selling_price || product.base_price;

          const batch = await tx.productBatch.create({
            data: {
              organization_id: organizationId,
              product_id: product.id,
              batch_number: `RCV-${po.id}-${product.id}-${Date.now()}`,
              quantity_remaining: itemInput.quantity,
              unit_cost: itemInput.unit_cost,
              selling_price: sellingPrice,
              expiry_date: itemInput.expiry_date ? new Date(itemInput.expiry_date) : null,
              supplier_id: po.supplier_id
            }
          });

          // Log the inventory movement
          await tx.inventoryMovement.create({
            data: {
              organization_id: organizationId,
              branch_id: po.branch_id || BigInt(0),
              product_id: product.id,
              batch_id: batch.id,
              movement_type_id: 'PURCHASE_RECEIPT',
              type: 'PURCHASE_RECEIPT',
              quantity: itemInput.quantity,
              reference_id: `PO-${po.id}`,
              created_by_id: adminId,
              status: 'ACTIVE'
            }
          });
        }
      }

      return await tx.purchaseOrder.findUnique({
        where: { id: po.id },
        include: { PurchaseOrderItem: true, Supplier: true }
      });
    }, { timeout: 20000 });
  }
}
