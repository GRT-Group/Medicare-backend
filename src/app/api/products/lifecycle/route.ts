import { NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { ProductService } from '@/services/product.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function PUT(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id');
    
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });
    if (!adminId) return NextResponse.json({ error: 'Missing x-user-id header' }, { status: 400 });

    const body = await req.json();
    const { lifecycle_status } = body;

    if (!lifecycle_status) {
      return NextResponse.json({ error: 'lifecycle_status is required' }, { status: 400 });
    }

    const product = await ProductService.updateLifecycleStatus(BigInt(id), BigInt(orgId), lifecycle_status, BigInt(adminId));
    return NextResponse.json(product, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
