import { NextRequest, NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { InventoryService } from '@/services/inventory.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const orgId = req.headers.get('x-organization-id');
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const { id } = await params;
    const batch = await InventoryService.getBatchById(BigInt(orgId), BigInt(id));
    if (!batch) return NextResponse.json({ success: false, error: 'Product batch not found' }, { status: 404 });

    return NextResponse.json({ success: true, data: batch }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const orgId = req.headers.get('x-organization-id');
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const { id } = await params;
    const body = await req.json();

    const batch = await InventoryService.updateBatch(BigInt(orgId), BigInt(id), {
      batch_number: body.batchNumber ?? body.batch_number,
      expiry_date: body.expiryDate || body.expiry_date ? new Date(body.expiryDate ?? body.expiry_date) : undefined,
      unit_cost: body.unitCost ?? body.unit_cost,
      selling_price: body.sellingPrice ?? body.selling_price,
      quantity_remaining: body.quantityRemaining ?? body.quantity_remaining,
      status: body.status
    });

    return NextResponse.json({ success: true, message: 'Batch updated successfully', data: batch }, { status: 200 });
  } catch (error: any) {
    if (/not found/i.test(error?.message ?? '')) {
      return NextResponse.json({ success: false, error: 'Product batch not found' }, { status: 404 });
    }
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id') || '1';
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const { id } = await params;
    await InventoryService.deleteBatch(BigInt(orgId), BigInt(id), BigInt(adminId));

    return NextResponse.json({ success: true, message: 'Batch deleted successfully' }, { status: 200 });
  } catch (error: any) {
    if (/not found/i.test(error?.message ?? '')) {
      return NextResponse.json({ success: false, error: 'Product batch not found' }, { status: 404 });
    }
    if (/already deleted/i.test(error?.message ?? '')) {
      return NextResponse.json({ success: false, error: 'Batch is already deleted' }, { status: 409 });
    }
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
