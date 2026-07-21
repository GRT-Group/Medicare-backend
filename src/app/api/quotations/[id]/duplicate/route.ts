import { NextRequest, NextResponse } from 'next/server';
import { QuotationService } from '@/services/quotation.service';
import { apiError } from '@/lib/api-error';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

/**
 * POST /api/quotations/:id/duplicate
 * Clone a quotation with a new number and DRAFT status.
 * Useful for reusing a winning quotation as a template.
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
    const quotation = await QuotationService.duplicateQuotation(
      BigInt(id),
      BigInt(orgId),
      BigInt(adminId)
    );

    return NextResponse.json({ success: true, data: quotation }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
