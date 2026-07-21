import { NextResponse } from 'next/server';
import { QuotationService } from '@/services/quotation.service';
import { apiError } from '@/lib/api-error';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export const dynamic = 'force-dynamic';

/**
 * GET /api/quotations/stats
 * Returns dashboard statistics for quotations:
 * - total count & value
 * - accepted value
 * - conversion rate (%)
 * - pipeline count & value (DRAFT + SENT)
 * - counts by status
 */
export async function GET(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    if (!orgId || !/^\d+$/.test(orgId)) {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid x-organization-id header' },
        { status: 400 }
      );
    }

    const stats = await QuotationService.getQuotationStats(BigInt(orgId));
    return NextResponse.json({ success: true, data: stats });
  } catch (error) {
    return apiError(error);
  }
}
