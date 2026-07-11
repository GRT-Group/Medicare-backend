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
    
    if (!body.product_id || !body.batch_id || body.quantity_change === undefined || !body.reason) {
      return NextResponse.json({ error: 'Missing required fields for stock adjustment' }, { status: 400 });
    }

    const movement = await InventoryService.adjustStock(
      BigInt(orgId), 
      {
        product_id: BigInt(body.product_id),
        batch_id: BigInt(body.batch_id),
        quantity_change: Number(body.quantity_change),
        reason: body.reason,
        note: body.note
      }, 
      BigInt(adminId || 1)
    );

    return NextResponse.json({ message: 'Stock adjusted successfully', movement }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
