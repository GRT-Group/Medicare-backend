import { NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { InventoryService } from '@/services/inventory.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function POST(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id'); // Fallback handled below
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const body = await req.json();
    
    // Support frontend payload structure:
    // productId, adjustmentType, quantityChange, costPrice, sellingPrice, reference, notes
    const productId = body.productId || body.product_id;
    const batchId = body.batchId || body.batch_id;
    const quantityChange = body.quantityChange !== undefined ? Number(body.quantityChange) : (body.quantity_change !== undefined ? Number(body.quantity_change) : undefined);
    const reason = body.reference || body.reason || body.adjustmentType || 'GENERAL_ADJUSTMENT';
    const note = body.notes || body.note;
    
    if (!productId || quantityChange === undefined) {
      return NextResponse.json({ error: 'Missing productId or quantityChange for stock adjustment' }, { status: 400 });
    }

    let movement;

    if (batchId) {
      // Legacy / Specific Batch Adjustment
      movement = await InventoryService.adjustStock(
        BigInt(orgId), 
        {
          product_id: BigInt(productId),
          batch_id: BigInt(batchId),
          quantity_change: quantityChange,
          reason: reason,
          note: note
        }, 
        BigInt(adminId || 1)
      );
    } else {
      // General Stock Adjustment (FIFO for deductions, create new batch for additions)
      movement = await InventoryService.adjustGeneralStock(
        BigInt(orgId),
        {
          product_id: BigInt(productId),
          quantity_change: quantityChange,
          cost_price: body.costPrice ? Number(body.costPrice) : undefined,
          selling_price: body.sellingPrice ? Number(body.sellingPrice) : undefined,
          reference: reason,
          note: note
        },
        BigInt(adminId || 1)
      );
    }

    return NextResponse.json({ message: 'Stock adjusted successfully', result: movement }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
