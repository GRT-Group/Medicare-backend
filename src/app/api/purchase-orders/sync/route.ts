import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { PurchaseOrderService } from '@/services/purchase-order.service';
import { friendlyMessage } from '@/lib/api-error';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function POST(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id') || '1';
    if (!orgId) return NextResponse.json({ error: 'Missing organization' }, { status: 400 });

    const body = await req.json();
    const purchaseOrders = body.purchaseOrders || [];
    
    const results = [];

    for (const offlinePo of purchaseOrders) {
      const localId = offlinePo.local_id;
      if (!localId) continue;

      // 1. Idempotency Check
      const existing = await prisma.purchaseOrder.findUnique({
        where: { local_id: localId }
      });

      if (existing) {
        results.push({ localId, status: 'ALREADY_SYNCED', serverId: existing.id });
        continue;
      }

      try {
        // We run the exact same logic. ProcessPurchaseOrder automatically generates batches if status === 'RECEIVED'
        const completedPo = await PurchaseOrderService.processPurchaseOrder(offlinePo, BigInt(orgId), BigInt(adminId));
        if (!completedPo) throw new Error('Failed to create purchase order');

        // Update to sync success
        await prisma.purchaseOrder.update({
          where: { id: completedPo.id },
          data: { sync_status: 'SYNCED' }
        });

        results.push({ localId, status: 'SYNCED', serverId: completedPo.id });

      } catch (err: any) {
        // Conflict or data issue
        results.push({ localId, status: 'FAILED', error: err.message });
      }
    }

    return NextResponse.json({ processed: purchaseOrders.length, results }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
