import { NextRequest, NextResponse } from 'next/server';
import { QuotationService } from '@/services/quotation.service';
import { apiError } from '@/lib/api-error';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

/**
 * GET /api/quotations/:id
 * Get a single quotation by ID.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const orgId = req.headers.get('x-organization-id');
    if (!orgId || !/^\d+$/.test(orgId)) {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid x-organization-id header' },
        { status: 400 }
      );
    }

    const { id } = await params;
    const quotation = await QuotationService.getQuotationById(BigInt(id), BigInt(orgId));
    return NextResponse.json({ success: true, data: quotation });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * PUT /api/quotations/:id
 * Update a quotation (customer info, items, notes, validity).
 * Only DRAFT and SENT quotations can be edited.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    // Coerce IDs
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

    const { id } = await params;
    const quotation = await QuotationService.updateQuotation(
      BigInt(id),
      BigInt(orgId),
      body,
      BigInt(adminId)
    );

    return NextResponse.json({ success: true, data: quotation });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * DELETE /api/quotations/:id
 * Soft-delete a quotation.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    await QuotationService.deleteQuotation(BigInt(id), BigInt(orgId), BigInt(adminId));

    return NextResponse.json({ success: true, message: 'Quotation deleted successfully.' });
  } catch (error) {
    return apiError(error);
  }
}
