import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { PurchaseOrderService } from '@/services/purchase-order.service';
import { friendlyMessage } from '@/lib/api-error';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function GET(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    if (!orgId) return NextResponse.json({ error: 'Missing organization header' }, { status: 400 });

    const pos = await prisma.purchaseOrder.findMany({
      where: { organization_id: BigInt(orgId), deleted_at: null },
      include: {
        PurchaseOrderItem: { include: { Product: true } },
        Supplier: true,
        Branch: true
      },
      orderBy: { id: 'desc' }
    });

    return NextResponse.json(pos);
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id') || '1';
    
    if (!orgId) return NextResponse.json({ error: 'Missing organization header' }, { status: 400 });

    const body = await req.json();
    const po = await PurchaseOrderService.processPurchaseOrder(body, BigInt(orgId), BigInt(adminId));

    return NextResponse.json(po, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
