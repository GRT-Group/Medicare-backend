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
    
    const formattedTransfers = transfers.map(t => {
      const quantity = t.items.reduce((sum, item) => sum + item.quantity, 0);
      const productNames = t.items.map(i => i.Product?.name).join(', ');

      return {
        id: t.id,
        transferNo: t.reference || `TR-${t.id}`,
        status: t.status.toLowerCase(),
        productName: productNames || 'Unknown Product',
        quantity,
        fromLocation: t.from_branch?.name,
        toLocation: t.to_branch?.name,
        transferDate: t.transfer_date,
        expectedDate: t.expected_date,
        completedDate: t.completed_date,
        risk: t.risk_level || 'Normal',
        notes: t.notes || 'None',
        requestedBy: t.User_StockTransfer_created_by_idToUser?.first_name 
                     ? `${t.User_StockTransfer_created_by_idToUser.first_name} ${t.User_StockTransfer_created_by_idToUser.last_name || ''}`
                     : 'System'
      };
    });
    
    return NextResponse.json(formattedTransfers, { status: 200 });
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
    
    // Support either a single item or an array of items from frontend
    let items = body.items || [];
    if (items.length === 0 && (body.productId || body.product_id) && (body.quantity)) {
      items.push({
        product_id: body.productId || body.product_id,
        quantity: body.quantity
      });
    }

    if (items.length === 0) {
       return NextResponse.json({ error: 'Missing transfer items or product/quantity.' }, { status: 400 });
    }

    const data = {
      from_branch_id: BigInt(body.fromLocation || body.from_branch_id),
      to_branch_id: BigInt(body.toLocation || body.to_branch_id),
      reference: body.transferNo || body.reference,
      notes: body.notes,
      transfer_date: body.transferDate ? new Date(body.transferDate) : undefined,
      expected_date: body.expectedDate ? new Date(body.expectedDate) : undefined,
      completed_date: body.completedDate ? new Date(body.completedDate) : undefined,
      items: items.map((i: any) => ({
        product_id: BigInt(i.product_id || i.productId),
        batch_id: i.batch_id ? BigInt(i.batch_id) : undefined,
        quantity: Number(i.quantity)
      }))
    };

    let transfer;
    // If any item specifies a batch_id explicitly, use legacy exact-batch transfer.
    // Otherwise, use intelligent FIFO transfer.
    const hasExplicitBatches = data.items.some((i: any) => i.batch_id !== undefined);

    if (hasExplicitBatches) {
      transfer = await StockTransferService.initiateTransfer(BigInt(orgId), data as any, BigInt(adminId));
    } else {
      transfer = await StockTransferService.initiateGeneralTransfer(BigInt(orgId), data, BigInt(adminId));
    }
    
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

    const action = body.action || 'complete'; // default to complete for legacy support

    const transfer = await StockTransferService.updateTransferStatus(
      BigInt(body.transfer_id),
      action as any,
      BigInt(orgId),
      BigInt(adminId)
    );
    
    return NextResponse.json({ message: `Transfer ${action}d successfully`, result: transfer }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
