// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { PurchaseService } from '@/services/purchase.service';
import { resolveContext, toErrorResponse } from '@/lib/agrovet/context';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

/**
 * GET /api/purchases/invoices?date=YYYY-MM-DD&supplier_id=7
 * Every purchase order invoice for a given calendar date (optionally scoped
 * to one supplier), full structured invoice data per order (same shape as
 * GET /api/purchases/:id/invoice) — for "show me the invoice(s) for this
 * date" without knowing the PO id upfront.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await resolveContext(req as any);

    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get('date');
    const supplierIdParam = searchParams.get('supplier_id');

    if (!dateParam) {
      return NextResponse.json({ success: false, error: 'date query parameter is required (YYYY-MM-DD)' }, { status: 400 });
    }
    const date = new Date(dateParam);
    if (isNaN(date.getTime())) {
      return NextResponse.json({ success: false, error: 'Invalid date' }, { status: 400 });
    }

    const invoices = await PurchaseService.getInvoicesByDate(
      ctx.organizationId,
      date,
      supplierIdParam ? BigInt(supplierIdParam) : undefined
    );

    return NextResponse.json({ success: true, data: invoices }, { status: 200 });
  } catch (error: any) {
    const { body, status } = toErrorResponse(error);
    return NextResponse.json({ success: false, ...body }, { status });
  }
}
