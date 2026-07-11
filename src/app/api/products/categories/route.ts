import { NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { ProductService } from '@/services/product.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function GET(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const url = new URL(req.url);
    const productTypeId = url.searchParams.get('productTypeId');

    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const categories = await ProductService.getCategories(BigInt(orgId), productTypeId ? BigInt(productTypeId) : undefined);
    return NextResponse.json(categories, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const body = await req.json();
    const category = await ProductService.createCategory(BigInt(orgId), body);
    return NextResponse.json(category, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    
    if (!orgId || !id) return NextResponse.json({ error: 'Missing organization ID or category ID' }, { status: 400 });

    const body = await req.json();
    const category = await ProductService.updateCategory(BigInt(id), BigInt(orgId), body);
    return NextResponse.json(category, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id');
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    
    if (!orgId || !id) return NextResponse.json({ error: 'Missing organization ID or category ID' }, { status: 400 });

    await ProductService.deleteCategory(BigInt(id), BigInt(orgId), adminId ? BigInt(adminId) : BigInt(0));
    return NextResponse.json({ message: 'Category deleted' }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
