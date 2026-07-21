import { NextRequest, NextResponse } from 'next/server';
import { QuotationService } from '@/services/quotation.service';
import { apiError } from '@/lib/api-error';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

/**
 * PUT /api/quotations/:id/status
 * Update quotation status with validation of allowed transitions.
 *
 * Body: { "status": "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "DRAFT" }
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const orgId = req.headers.get('x-organization-id');
    if (!orgId || !/^\d+$/.test(orgId)) {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid x-organization-id header' },
        { status: 400 }
      );
    }

    const body = await req.json();

    if (!body.status) {
      return NextResponse.json(
        { success: false, error: 'status is required in the request body.' },
        { status: 400 }
      );
    }

    const validStatuses = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED'];
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json(
        { success: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }

    const { id } = await params;
    const quotation = await QuotationService.updateQuotationStatus(
      BigInt(id),
      BigInt(orgId),
      body.status
    );

    return NextResponse.json({ success: true, data: quotation });
  } catch (error) {
    return apiError(error);
  }
}
