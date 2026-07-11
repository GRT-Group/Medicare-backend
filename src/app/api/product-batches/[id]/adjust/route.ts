import { NextRequest, NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { InventoryService } from '@/services/inventory.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id');
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const { id } = await params;
    const body = await req.json();
    const quantityChange = body.adjustmentQuantity ?? body.quantity_change;
    const reason = body.reason;

    if (quantityChange === undefined || !reason) {
      return NextResponse.json({ error: 'Missing required fields: adjustmentQuantity, reason' }, { status: 400 });
    }

    const batch = await InventoryService.getBatchById(BigInt(orgId), BigInt(id));
    if (!batch) return NextResponse.json({ success: false, error: 'Product batch not found' }, { status: 404 });

    const movement = await InventoryService.adjustStock(
      BigInt(orgId),
      {
        product_id: batch.product_id,
        batch_id: BigInt(id),
        quantity_change: Number(quantityChange),
        reason
      },
      BigInt(body.userId || adminId || 1)
    );

    return NextResponse.json({ success: true, message: 'Stock adjusted successfully', data: movement }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
