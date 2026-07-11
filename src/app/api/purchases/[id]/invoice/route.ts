// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { PurchaseService } from '@/services/purchase.service';
import { resolveContext, toErrorResponse } from '@/lib/agrovet/context';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

/**
 * GET /api/purchases/:id/invoice
 * Structured invoice data for a purchase order — the same fields the
 * supplier was emailed on creation (see PurchaseService.getPurchaseOrderInvoice),
 * so it can be re-fetched/re-rendered/printed at any time without depending
 * on the original email.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await resolveContext(req as any);

    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ success: false, error: 'Invalid purchase order id' }, { status: 400 });
    }

    const invoice = await PurchaseService.getPurchaseOrderInvoice(BigInt(id), ctx.organizationId);
    return NextResponse.json({ success: true, data: invoice }, { status: 200 });
  } catch (error: any) {
    const { body, status } = toErrorResponse(error);
    return NextResponse.json({ success: false, ...body }, { status: error.message === 'Purchase order not found' ? 404 : status });
  }
}
