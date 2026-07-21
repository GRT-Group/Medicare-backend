import { NextRequest, NextResponse } from 'next/server';
import { QuotationService } from '@/services/quotation.service';
import { apiError } from '@/lib/api-error';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

/**
 * POST /api/quotations/:id/send
 * Mark a quotation as SENT and email it to the customer.
 *
 * The customer_email on the quotation is used as the recipient.
 * If no email is set, the status is still updated but no email is sent.
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

    const { id } = await params;
    const quotation = await QuotationService.sendQuotation(
      BigInt(id),
      BigInt(orgId),
      BigInt(adminId)
    );

    return NextResponse.json({
      success: true,
      data: quotation,
      message: 'Quotation sent successfully.',
    });
  } catch (error) {
    return apiError(error);
  }
}
