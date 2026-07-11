import { NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { InventoryService } from '@/services/inventory.service';

export const dynamic = 'force-dynamic';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function GET(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const batches = await InventoryService.getBatches(BigInt(orgId));
    return NextResponse.json({ success: true, data: batches }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id') || '1';
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const body = await req.json();
    if (!body.product_id || !body.quantity || body.unit_cost === undefined || body.selling_price === undefined) {
      return NextResponse.json({ error: 'Missing required fields: product_id, quantity, unit_cost, selling_price' }, { status: 400 });
    }

    const result = await InventoryService.addDirectStock(
      BigInt(orgId),
      {
        product_id: BigInt(body.product_id),
        quantity: Number(body.quantity),
        unit_cost: Number(body.unit_cost),
        selling_price: Number(body.selling_price),
        batch_number: body.batch_number,
        expiry_date: body.expiry_date ? new Date(body.expiry_date) : undefined
      },
      BigInt(adminId)
    );

    return NextResponse.json({ success: true, message: 'Batch created successfully', data: result.batch }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
