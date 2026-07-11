import { prisma } from '@/lib/prisma';
import { InventoryMovementType } from '@prisma/client';

export class InventoryTransactionService {
  /**
   * Centralized method to handle all inventory movements.
   * Prevents manual editing of stock quantities outside of defined transaction types.
   */
  static async processMovement(organizationId: bigint, data: {
    branch_id?: bigint;
    product_id: bigint;
    batch_id: bigint;
    type: InventoryMovementType;
    quantity: number;
    reference_id?: string;
    user_id: bigint;
  }, txClient?: any) {
    const execute = async (tx: any) => {
      // 1. Fetch current batch to ensure it belongs to the org
      const batch = await tx.productBatch.findFirst({
        where: { id: data.batch_id, product_id: data.product_id, organization_id: organizationId }
      });

      if (!batch) throw new Error('Product batch not found or does not belong to your organization');

      // 2. Determine quantity adjustment based on movement type
      // Types that DECREASE stock:
      const decreasingTypes = [
        'SALES', 'SUPPLIER_RETURN', 'STOCK_TRANSFER', 'DAMAGED_STOCK', 'EXPIRED_STOCK'
      ];

      const isDecrease = decreasingTypes.includes(data.type);
      const absoluteQuantity = Math.abs(data.quantity);
      const quantityChange = isDecrease ? -absoluteQuantity : absoluteQuantity;

      // Calculate new quantity
      let newQuantity = batch.quantity_remaining + quantityChange;
      if (data.type === 'STOCK_COUNT_ADJUSTMENT') {
        // Special case: STOCK_COUNT_ADJUSTMENT quantity is the exact discrepancy
        newQuantity = batch.quantity_remaining + data.quantity;
      }

      if (newQuantity < 0) {
        throw new Error(`Insufficient stock for transaction. Available: ${batch.quantity_remaining}, Requested reduction: ${absoluteQuantity}`);
      }

      // 3. Update the ProductBatch stock
      await tx.productBatch.update({
        where: { id: data.batch_id },
        data: { quantity_remaining: newQuantity }
      });

      // 4. Record the specific InventoryMovement
      const movement = await tx.inventoryMovement.create({
        data: {
          organization_id: organizationId,
          branch_id: data.branch_id,
          product_id: data.product_id,
          batch_id: data.batch_id,
          movement_type_id: data.type, // keeping legacy field populated
          type: data.type,
          quantity: data.quantity,
          reference_id: data.reference_id,
          created_by_id: data.user_id
        }
      });

      // 5. Update BranchStock if applicable
      if (data.branch_id) {
        const branchStock = await tx.branchStock.findUnique({
          where: { branch_id_batch_id: { branch_id: data.branch_id, batch_id: data.batch_id } }
        });

        if (branchStock) {
          await tx.branchStock.update({
            where: { id: branchStock.id },
            data: { quantity: branchStock.quantity + quantityChange }
          });
        } else {
          if (newQuantity > 0) {
            await tx.branchStock.create({
              data: {
                organization_id: organizationId,
                branch_id: data.branch_id,
                product_id: data.product_id,
                batch_id: data.batch_id,
                quantity: newQuantity
              }
            });
          }
        }
      }

      return movement;
    };

    return txClient ? execute(txClient) : prisma.$transaction(execute);
  }
}
