// @ts-nocheck
import { NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { PurchaseService } from '@/services/purchase.service';
import { resolveContext, toErrorResponse } from '@/lib/agrovet/context';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function GET(req: Request) {
  try {
    const ctx = await resolveContext(req as any);
    const suppliers = await PurchaseService.getSuppliers(ctx.organizationId);
    return NextResponse.json(suppliers, { status: 200 });
  } catch (error: any) {
    const { body, status } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveContext(req as any);
    const body = await req.json();
    const supplier = await PurchaseService.createSupplier(ctx.organizationId, body, ctx.userId);
    return NextResponse.json(supplier, { status: 201 });
  } catch (error: any) {
    const message = error?.message ?? '';
    if (/must be one of|required/i.test(message)) {
      return NextResponse.json({ error: friendlyMessage(error) }, { status: 400 });
    }
    const { body, status } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await resolveContext(req as any);
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing supplier ID' }, { status: 400 });

    const body = await req.json();
    const supplier = await PurchaseService.updateSupplier(BigInt(id), ctx.organizationId, body);
    return NextResponse.json(supplier, { status: 200 });
  } catch (error: any) {
    const message = error?.message ?? '';
    const status = /not found/i.test(message) ? 404 : /must be one of|required/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: friendlyMessage(error) }, { status });
  }
}

export async function DELETE(req: Request) {
  try {
    const ctx = await resolveContext(req as any);
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing supplier ID' }, { status: 400 });

    await PurchaseService.deleteSupplier(BigInt(id), ctx.organizationId, ctx.userId);
    return NextResponse.json({ message: 'Supplier deleted' }, { status: 200 });
  } catch (error: any) {
    const { body, status } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
