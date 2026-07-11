// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { PurchaseService } from '@/services/purchase.service';
import { resolveContext, toErrorResponse } from '@/lib/agrovet/context';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

/**
 * GET /api/suppliers/:id/purchases
 * Every purchase order ever raised with this supplier (newest first), plus
 * a rollup summary (order counts by status, lifetime spend, last order
 * date) — what a supplier detail page needs in one call.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await resolveContext(req as any);

    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ success: false, error: 'Invalid supplier id' }, { status: 400 });
    }

    const history = await PurchaseService.getSupplierPurchaseHistory(BigInt(id), ctx.organizationId);
    return NextResponse.json({ success: true, data: history }, { status: 200 });
  } catch (error: any) {
    const { body, status } = toErrorResponse(error);
    return NextResponse.json({ success: false, ...body }, { status: error.message === 'Supplier not found' ? 404 : status });
  }
}
