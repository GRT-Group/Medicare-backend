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

    const transfers = await StockTransferService.getTransfers(
      BigInt(orgId),
      branchId ? BigInt(branchId) : undefined
    );
    
    return NextResponse.json(transfers, { status: 200 });
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
    
    const data = {
      from_branch_id: BigInt(body.from_branch_id),
      to_branch_id: BigInt(body.to_branch_id),
      reference: body.reference,
      items: body.items.map((i: any) => ({
        product_id: BigInt(i.product_id),
        batch_id: BigInt(i.batch_id),
        quantity: Number(i.quantity)
      }))
    };

    const transfer = await StockTransferService.initiateTransfer(BigInt(orgId), data, BigInt(adminId));
    
    return NextResponse.json(transfer, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id') || '1';
    
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const body = await req.json();
    
    if (!body.transfer_id) {
      return NextResponse.json({ error: 'Missing transfer_id' }, { status: 400 });
    }

    // In a real app we might handle CANCEL as well, here we just do complete
    const transfer = await StockTransferService.completeTransfer(
      BigInt(body.transfer_id),
      BigInt(orgId),
      BigInt(adminId)
    );
    
    return NextResponse.json(transfer, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
