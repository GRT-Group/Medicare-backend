import { NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { InventoryService } from '@/services/inventory.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const orgId = req.headers.get('x-organization-id') || body.organizationId;
    const adminId = req.headers.get('x-user-id') || body.userId || '1';
    if (!orgId) return NextResponse.json({ error: 'Missing organization id' }, { status: 400 });

    if (!body.productName || !body.quantity || body.unitCost === undefined || body.sellingPrice === undefined) {
      return NextResponse.json({ error: 'Missing required fields: productName, quantity, unitCost, sellingPrice' }, { status: 400 });
    }

    const result = await InventoryService.receiveStock(
      BigInt(orgId),
      {
        productName: body.productName,
        categoryId: body.categoryId,
        newCategoryName: body.newCategoryName,
        unitOfMeasure: body.unitOfMeasure || 'Pieces',
        reorderLevel: body.reorderLevel,
        batchNumber: body.batchNumber,
        expiryDate: body.expiryDate,
        quantity: Number(body.quantity),
        unitCost: Number(body.unitCost),
        sellingPrice: Number(body.sellingPrice)
      },
      BigInt(adminId)
    );

    return NextResponse.json({ success: true, message: 'Stock received successfully', data: result }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
