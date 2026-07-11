import { NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { ProductService } from '@/services/product.service';

export const dynamic = 'force-dynamic';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function GET(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const url = new URL(req.url);
    const categoryId = url.searchParams.get('categoryId');

    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const products = await ProductService.getProducts(BigInt(orgId), categoryId ? BigInt(categoryId) : undefined);
    
    // Transform output to match exactly what the frontend master logic expects
    const formattedProducts = products.map((p: any) => ({
      id: p.id,
      productTypeId: p.Category?.product_type_id,
      categoryId: p.category_id,
      name: p.name,
      barcode: p.barcode,
      unitOfMeasure: p.unit_of_measure,
      pricing: {
        purchasePrice: p.base_cost,
        sellingPrice: p.base_price,
        currency: "RWF"
      },
      stock: {
        currentStock: p.ProductBatch.reduce((sum: number, b: any) => sum + b.quantity_remaining, 0),
        reorderLevel: p.reorder_level
      },
      status: p.status
    }));

    return NextResponse.json(formattedProducts, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const body = await req.json();
    const product = await ProductService.createProduct(BigInt(orgId), body);
    return NextResponse.json(product, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id') || '1';
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    
    if (!orgId || !id) return NextResponse.json({ error: 'Missing organization ID or product ID' }, { status: 400 });

    const body = await req.json();
    const product = await ProductService.updateProduct(BigInt(id), BigInt(orgId), body, BigInt(adminId));
    return NextResponse.json(product, { status: 200 });
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
    
    if (!orgId || !id) return NextResponse.json({ error: 'Missing organization ID or product ID' }, { status: 400 });

    await ProductService.deleteProduct(BigInt(id), BigInt(orgId), adminId ? BigInt(adminId) : BigInt(0));
    return NextResponse.json({ message: 'Product deleted' }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
