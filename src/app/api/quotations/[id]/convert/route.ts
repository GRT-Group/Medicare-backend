import { NextRequest, NextResponse } from 'next/server';
import { QuotationService } from '@/services/quotation.service';
import { apiError } from '@/lib/api-error';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

/**
 * POST /api/quotations/:id/convert
 * Convert an accepted/open quotation into a sale.
 *
 * Body: { "payment_method": "CASH" | "MOBILE_MONEY" | ..., "amount_paid": 5000 }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id');

    if (!orgId || !/^\d+$/.test(orgId)) {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid x-organization-id header' },
        { status: 400 }
      );
    }
    if (!adminId || !/^\d+$/.test(adminId)) {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid x-user-id header' },
        { status: 400 }
      );
    }

    const body = await req.json();

    if (!body.payment_method) {
      return NextResponse.json(
        { success: false, error: 'payment_method is required.' },
        { status: 400 }
      );
    }

    const { id } = await params;
    const sale = await QuotationService.convertToSale(
      BigInt(id),
      BigInt(orgId),
      BigInt(adminId),
      body.payment_method,
      body.amount_paid ? Number(body.amount_paid) : undefined
    );

    return NextResponse.json({ success: true, data: sale }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
