import { NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { ReturnService } from '@/services/return.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function GET(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const url = new URL(req.url);
    const branchId = url.searchParams.get('branchId');

    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const returns = await ReturnService.getReturns(BigInt(orgId), branchId ? BigInt(branchId) : undefined);
    return NextResponse.json(returns, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id');
    
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });
    if (!adminId) return NextResponse.json({ error: 'Missing x-user-id header' }, { status: 400 });

    const body = await req.json();
    const {
      sale_id,
      product_id,
      batch_id,
      quantity,
      reason,
      type,
      stock_restored,
      refund_amount,
      branch_id
    } = body;

    if (!sale_id || !product_id || !batch_id || !quantity || !branch_id) {
      return NextResponse.json({ error: 'sale_id, product_id, batch_id, quantity, and branch_id are required' }, { status: 400 });
    }

    const returnRecord = await ReturnService.processReturn(BigInt(orgId), {
      sale_id: BigInt(sale_id),
      product_id: BigInt(product_id),
      batch_id: BigInt(batch_id),
      quantity: Number(quantity),
      reason,
      type,
      stock_restored: stock_restored !== false,
      refund_amount: Number(refund_amount || 0),
      branch_id: BigInt(branch_id)
    }, BigInt(adminId));

    return NextResponse.json(returnRecord, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
