import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { friendlyMessage } from '@/lib/api-error';
import { PricingEngine } from '@/services/pricing.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id') || '1';
    
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const saleId = BigInt(id);
    const body = await req.json();

    const productId = BigInt(body.productId);
    const quantity = Number(body.quantity);
    
    // Inventory validation before adding to cart
    const activeBatches = await prisma.productBatch.findMany({
      where: { product_id: productId, organization_id: BigInt(orgId), is_deleted: false, quantity_remaining: { gt: 0 } },
      orderBy: { expiry_date: 'asc' } // Simplified for cart preview, we lock specific batches here.
    });

    const totalAvailable = activeBatches.reduce((acc, b) => acc + b.quantity_remaining, 0);
    if (quantity > totalAvailable) {
      return NextResponse.json({ error: `Requested qty ${quantity} exceeds stock ${totalAvailable}.` }, { status: 400 });
    }

    // Pick a batch to satisfy (we just take the first active one for cart purposes, 
    // or strictly split items if required, but for simplicity of cart, we pin to a batch).
    let remaining = quantity;
    const itemsCreated = [];

    for (const batch of activeBatches) {
      if (remaining <= 0) break;
      const take = Math.min(batch.quantity_remaining, remaining);
      
      const saleItem = await prisma.saleItem.create({
        data: {
          sale_id: saleId,
          product_id: productId,
          batch_id: batch.id,
          quantity: take,
          unit_price: batch.selling_price,
          unit_cost: batch.unit_cost,
          line_discount: Number(body.lineDiscount || 0),
          subtotal: 0 // Will be recalculated immediately
        }
      });
      itemsCreated.push(saleItem);
      remaining -= take;
    }

    // Recompute totals for the entire sale
    const sale = await prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: true }
    });

    if (!sale) throw new Error('Sale not found');

    const pricingItems = sale.items.map(i => ({
      quantity: i.quantity,
      unit_price: Number(i.unit_price),
      unit_cost: Number(i.unit_cost),
      line_discount: Number(i.line_discount)
    }));

    const totals = PricingEngine.recalculateTotals(pricingItems);

    await prisma.sale.update({
      where: { id: saleId },
      data: {
        subtotal: totals.subtotal,
        vat_amount: totals.tax_total,
        profit_total: totals.profit_total,
        margin_percent: totals.margin_percent,
        total_amount: totals.grand_total
      }
    });

    return NextResponse.json(itemsCreated, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
