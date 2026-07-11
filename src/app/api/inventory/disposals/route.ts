import { NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { InventoryService } from '@/services/inventory.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function POST(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id') || '1';
    
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const body = await req.json();
    
    if (!body.batch_id || !body.disposal_status) {
      return NextResponse.json({ error: 'Missing batch_id or disposal_status' }, { status: 400 });
    }

    const data = {
      batch_id: BigInt(body.batch_id),
      disposal_status: body.disposal_status, // 'DISPOSED' | 'EXPIRED' | 'DAMAGED'
      disposal_reason: body.disposal_reason,
      branch_id: body.branch_id ? BigInt(body.branch_id) : undefined
    };

    const batch = await InventoryService.disposeBatch(BigInt(orgId), data as any, BigInt(adminId));
    
    return NextResponse.json(batch, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
