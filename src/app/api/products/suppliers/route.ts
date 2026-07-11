import { NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { ProductService } from '@/services/product.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function POST(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
  try {
    const orgId = req.headers.get('x-organization-id');
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const body = await req.json();
    const { supplier_id } = body;

    if (!supplier_id) {
      return NextResponse.json({ error: 'supplier_id is required' }, { status: 400 });
    }

    const mapping = await ProductService.addProductSupplier(BigInt(id), BigInt(supplier_id), BigInt(orgId));
    return NextResponse.json(mapping, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
  try {
    const orgId = req.headers.get('x-organization-id');
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const url = new URL(req.url);
    const supplier_id = url.searchParams.get('supplierId');

    if (!supplier_id) {
      return NextResponse.json({ error: 'supplierId query param is required' }, { status: 400 });
    }

    await ProductService.removeProductSupplier(BigInt(id), BigInt(supplier_id), BigInt(orgId));
    return NextResponse.json({ message: 'Supplier removed from product' }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
