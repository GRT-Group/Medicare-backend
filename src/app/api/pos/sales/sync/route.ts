import { NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error';
import { prisma } from '@/lib/prisma';
import { PosCheckoutService } from '@/services/pos-checkout.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function POST(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id') || '1';
    if (!orgId) return NextResponse.json({ error: 'Missing organization' }, { status: 400 });

    const body = await req.json();
    const sales = body.sales || [];
    
    const results = [];

    for (const offlineSale of sales) {
      const localId = offlineSale.localId;
      if (!localId) continue;

      // 1. Idempotency Check
      const existing = await prisma.sale.findUnique({
        where: { local_id: localId }
      });

      if (existing) {
        results.push({ localId, status: 'ALREADY_SYNCED', serverId: existing.id });
        continue;
      }

      let newSaleId: bigint | undefined;

      try {
        // Create the draft sale
        const draft = await prisma.sale.create({
          data: {
            organization_id: BigInt(orgId),
            created_by_id: BigInt(adminId),
            status: 'PENDING',
            total_amount: 0,
            invoice_number: `DRAFT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            cash_session_id: offlineSale.registerId ? BigInt(offlineSale.registerId) : undefined,
            local_id: localId,
            sync_status: 'PENDING'
          }
        });
        
        newSaleId = draft.id;

        // Insert items (simplified for sync: assuming they provide batch mapping, 
        // or we auto-resolve it just like the add-to-cart logic)
        for (const item of offlineSale.items) {
          const activeBatches = await prisma.productBatch.findMany({
            where: { product_id: BigInt(item.productId), organization_id: BigInt(orgId), is_deleted: false, quantity_remaining: { gt: 0 } },
            orderBy: { expiry_date: 'asc' }
          });

          if (activeBatches.length === 0) {
            throw new Error(`Out of stock for product ${item.productId}`);
          }

          let remaining = Number(item.quantity);
          for (const batch of activeBatches) {
            if (remaining <= 0) break;
            const take = Math.min(batch.quantity_remaining, remaining);
            
            await prisma.saleItem.create({
              data: {
                sale_id: draft.id,
                product_id: BigInt(item.productId),
                batch_id: batch.id,
                quantity: take,
                unit_price: batch.selling_price,
                unit_cost: batch.unit_cost,
                line_discount: Number(item.lineDiscount || 0),
                subtotal: 0
              }
            });
            remaining -= take;
          }

          if (remaining > 0) {
            throw new Error(`Insufficient stock for product ${item.productId} (short by ${remaining})`);
          }
        }

        // Now attempt standard checkout
        const completedSale = await PosCheckoutService.checkout(
          draft.id,
          BigInt(orgId),
          BigInt(adminId),
          Number(offlineSale.amountPaid || 0),
          offlineSale.paymentMethod || 'CASH'
        );

        // Update to sync success
        await prisma.sale.update({
          where: { id: completedSale.id },
          data: {
            sync_status: 'SYNCED',
            invoice_number: `REC-${Date.now()}-${completedSale.id}`
          }
        });

        results.push({ localId, status: 'SYNCED', serverId: completedSale.id });

      } catch (err: any) {
        // Conflict! e.g. oversold while offline.
        // We flag it as FAILED / Needs Review so the manager can manually inspect it.
        if (newSaleId) {
          await prisma.sale.update({
            where: { id: newSaleId },
            data: { sync_status: 'FAILED', status: 'PENDING' } // Leave in pending so it doesn't skew revenue
          });
        }
        results.push({ localId, status: 'FAILED', error: err.message, serverId: newSaleId });
      }
    }

    return NextResponse.json({ processed: sales.length, results }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
