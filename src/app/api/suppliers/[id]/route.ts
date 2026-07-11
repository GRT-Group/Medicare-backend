// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { PurchaseService } from '@/services/purchase.service';
import { resolveContext, toErrorResponse } from '@/lib/agrovet/context';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

/** GET /api/suppliers/:id — single supplier detail. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await resolveContext(req as any);

    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ success: false, error: 'Invalid supplier id' }, { status: 400 });
    }

    const supplier = await PurchaseService.getSupplierById(BigInt(id), ctx.organizationId);
    return NextResponse.json({ success: true, data: supplier }, { status: 200 });
  } catch (error: any) {
    const { body, status } = toErrorResponse(error);
    return NextResponse.json({ success: false, ...body }, { status: error.message === 'Supplier not found' ? 404 : status });
  }
}

/** PUT /api/suppliers/:id — update supplier fields. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await resolveContext(req as any);

    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ success: false, error: 'Invalid supplier id' }, { status: 400 });
    }

    const body = await req.json();
    const supplier = await PurchaseService.updateSupplier(BigInt(id), ctx.organizationId, body);
    return NextResponse.json({ success: true, data: supplier }, { status: 200 });
  } catch (error: any) {
    const message = error?.message ?? '';
    const status = /not found/i.test(message) ? 404 : /must be one of|required/i.test(message) ? 400 : 500;
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status });
  }
}

/** DELETE /api/suppliers/:id — soft delete a supplier. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await resolveContext(req as any);

    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ success: false, error: 'Invalid supplier id' }, { status: 400 });
    }

    await PurchaseService.deleteSupplier(BigInt(id), ctx.organizationId, ctx.userId);
    return NextResponse.json({ success: true, message: 'Supplier deleted' }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 });
  }
}
