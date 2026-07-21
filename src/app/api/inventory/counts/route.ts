import { NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { StockCountService } from '@/services/stock-count.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function GET(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const url = new URL(req.url);
    const status = url.searchParams.get('status');

    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const counts = await StockCountService.getCounts(BigInt(orgId), status || undefined);
    
    const formattedCounts = counts.map((c: any) => {
      const absVar = Math.abs(c.variance);
      let isCritical = false;
      if (absVar > 50 || (c.system_quantity > 0 && absVar > c.system_quantity * 0.2)) {
        isCritical = true;
      }

      let accuracy = 100;
      if (c.system_quantity > 0 || c.counted_quantity > 0) {
        const max = Math.max(c.system_quantity, c.counted_quantity);
        const min = Math.min(c.system_quantity, c.counted_quantity);
        accuracy = max === 0 ? 0 : Math.round((min / max) * 100);
      }

      return {
        id: c.id,
        productName: c.Product?.name || 'Unknown Product',
        countNo: c.count_number,
        date: c.count_date || c.timestamp,
        status: c.status.toLowerCase(),
        systemQty: c.system_quantity,
        countedQty: c.counted_quantity,
        variance: c.variance > 0 ? `+${c.variance}` : c.variance.toString(),
        location: c.Branch?.name || 'No location',
        risk: isCritical ? 'Critical' : 'Normal',
        accuracy: `${accuracy}%`,
        notes: c.notes || 'None',
        user: 'System' // Usually derived from created_by user relation, but simplified here
      };
    });

    return NextResponse.json(formattedCounts, { status: 200 });
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

    if (!body.productId && !body.product_id) {
       return NextResponse.json({ error: 'Missing product' }, { status: 400 });
    }

    const data = {
      product_id: BigInt(body.productId || body.product_id),
      branch_id: (body.location || body.branch_id) ? BigInt(body.location || body.branch_id) : undefined,
      count_number: body.countNo || body.count_number,
      system_quantity: Number(body.systemQuantity || body.system_quantity || 0),
      counted_quantity: Number(body.countedQuantity || body.counted_quantity || 0),
      variance: Number(body.variance || 0),
      notes: body.notes,
      count_date: body.countDate ? new Date(body.countDate) : undefined,
    };

    const count = await StockCountService.initiateCount(BigInt(orgId), data, BigInt(adminId));
    
    return NextResponse.json(count, { status: 201 });
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
    const countId = body.id || body.countId || body.count_id;
    
    if (!countId) {
      return NextResponse.json({ error: 'Missing id for count' }, { status: 400 });
    }

    const count = await StockCountService.completeCount(
      BigInt(countId),
      BigInt(orgId),
      BigInt(adminId)
    );
    
    return NextResponse.json({ message: 'Count completed successfully', result: count }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
