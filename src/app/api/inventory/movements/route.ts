import { NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { InventoryService } from '@/services/inventory.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function GET(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const url = new URL(req.url);
    const productId = url.searchParams.get('productId');

    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const movements = await InventoryService.getInventoryMovements(BigInt(orgId), productId ? BigInt(productId) : undefined);
    
    // Formatting to match the expected structure
    const formatted = movements.map((m: any) => ({
      stockMovement: {
        id: m.id,
        productId: m.product_id,
        productName: m.Product?.name,
        batchNumber: m.ProductBatch?.batch_number,
        type: m.movement_type_id, // 'INCREASE', 'DECREASE', 'ADJUSTMENT_UP', 'ADJUSTMENT_DOWN'
        quantity: m.quantity,
        reason: m.reference_id,
        createdBy: m.User_InventoryMovement_created_by_idToUser
          ? `${m.User_InventoryMovement_created_by_idToUser.first_name} ${m.User_InventoryMovement_created_by_idToUser.last_name}`
          : null,
        createdAt: m.timestamp
      }
    }));

    return NextResponse.json(formatted, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
