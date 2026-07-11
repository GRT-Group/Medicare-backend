// @ts-nocheck
import { NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { PurchaseService } from '@/services/purchase.service';
import { resolveContext, toErrorResponse } from '@/lib/agrovet/context';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function GET(req: Request) {
  try {
    const ctx = await resolveContext(req as any);

    const url = new URL(req.url);
    const supplierIdParam = url.searchParams.get('supplier_id');
    const supplierId = supplierIdParam ? BigInt(supplierIdParam) : undefined;

    const pos = await PurchaseService.getPurchaseOrders(ctx.organizationId, supplierId);

    // Format response to match JSON requirements closely
    const formatted = pos.map((po: any) => ({
      purchaseOrder: {
        id: po.id,
        supplierId: po.supplier_id,
        supplierName: po.supplier.name,
        totalAmount: po.total_amount,
        status: po.status,
        createdAt: po.updated_at,
        items: po.items.map((i: any) => ({
          productId: i.product_id,
          productName: i.product.name,
          quantity: i.expected_quantity,
          purchasePrice: i.unit_cost
        }))
      }
    }));

    return NextResponse.json(formatted, { status: 200 });
  } catch (error: any) {
    const { body, status } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveContext(req as any);

    const body = await req.json();
    const action = body.action; // e.g., 'CREATE' or 'RECEIVE'

    if (action === 'RECEIVE') {
      if (!body.purchaseOrderId) return NextResponse.json({ error: 'Missing purchaseOrderId' }, { status: 400 });
      const branchId = body.branchId ? BigInt(body.branchId) : ctx.branchId;
      if (!branchId) return NextResponse.json({ error: 'Missing branchId' }, { status: 400 });
      await PurchaseService.receivePurchaseOrder(BigInt(body.purchaseOrderId), ctx.organizationId, branchId, ctx.userId);
      return NextResponse.json({ message: 'Purchase order received. Stock increased successfully.' }, { status: 200 });
    } else {
      // Default: Create
      if (!Array.isArray(body.items) || body.items.length === 0) {
        return NextResponse.json({ error: 'Missing items' }, { status: 400 });
      }

      // Derive the total server-side from the authoritative items list rather
      // than trusting a client-supplied total for a financial document.
      const total_amount = body.items.reduce(
        (sum: number, item: any) => sum + Number(item.expected_quantity) * Number(item.unit_cost),
        0
      );

      const po = await PurchaseService.createPurchaseOrder(ctx.organizationId, { ...body, total_amount }, ctx.userId);
      return NextResponse.json({ message: 'Purchase order created successfully', id: po.id }, { status: 201 });
    }
  } catch (error: any) {
    const { body, status } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await resolveContext(req as any);

    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing purchase order ID' }, { status: 400 });

    const body = await req.json();
    const po = await PurchaseService.updatePurchaseOrder(BigInt(id), ctx.organizationId, body);
    return NextResponse.json(po, { status: 200 });
  } catch (error: any) {
    const { body, status } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(req: Request) {
  try {
    const ctx = await resolveContext(req as any);

    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing purchase order ID' }, { status: 400 });

    await PurchaseService.deletePurchaseOrder(BigInt(id), ctx.organizationId, ctx.userId);
    return NextResponse.json({ message: 'Purchase Order deleted successfully' }, { status: 200 });
  } catch (error: any) {
    const { body, status } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
