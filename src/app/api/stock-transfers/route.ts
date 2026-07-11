import { NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { StockTransferService } from '@/services/stock-transfer.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function GET(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const url = new URL(req.url);
    const branchId = url.searchParams.get('branchId');

    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const transfers = await StockTransferService.getTransfers(BigInt(orgId), branchId ? BigInt(branchId) : undefined);
    return NextResponse.json(transfers, { status: 200 });
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
    const { from_branch_id, to_branch_id, reference, items } = body;

    if (!from_branch_id || !to_branch_id || !items || !items.length) {
      return NextResponse.json({ error: 'from_branch_id, to_branch_id, and items are required' }, { status: 400 });
    }

    const mappedItems = items.map((i: any) => ({
      product_id: BigInt(i.product_id),
      batch_id: BigInt(i.batch_id),
      quantity: Number(i.quantity)
    }));

    const transfer = await StockTransferService.initiateTransfer(BigInt(orgId), {
      from_branch_id: BigInt(from_branch_id),
      to_branch_id: BigInt(to_branch_id),
      reference,
      items: mappedItems
    }, BigInt(adminId));

    return NextResponse.json(transfer, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
