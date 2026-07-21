import { NextResponse } from 'next/server';
import { QuotationService } from '@/services/quotation.service';
import { apiError } from '@/lib/api-error';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export const dynamic = 'force-dynamic';

/**
 * GET /api/quotations
 * List all quotations for the organization.
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

    const quotations = await QuotationService.getQuotations(BigInt(orgId));
    return NextResponse.json({ success: true, data: quotations });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * POST /api/quotations
 * Create a new quotation.
 */
export async function POST(req: Request) {
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

    // Coerce IDs to BigInt where needed
    if (body.customer_id) body.customer_id = BigInt(body.customer_id);
    if (body.supplier_id) body.supplier_id = BigInt(body.supplier_id);
    if (body.branch_id) body.branch_id = BigInt(body.branch_id);
    if (body.items) {
      body.items = body.items.map((item: any) => ({
        ...item,
        product_id: BigInt(item.product_id),
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
        line_discount: item.line_discount ? Number(item.line_discount) : 0,
        tax_rate: item.tax_rate !== undefined ? Number(item.tax_rate) : 0,
      }));
    }

    const quotation = await QuotationService.createQuotation(
      BigInt(orgId),
      body,
      BigInt(adminId)
    );

    return NextResponse.json({ success: true, data: quotation }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
