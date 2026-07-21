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
      productTypeName: p.Category?.ProductType?.name || '',
      categoryId: p.category_id,
      categoryName: p.Category?.name || '',
      name: p.name,
      barcode: p.barcode,
      unitOfMeasure: p.UnitOfMeasure?.name || p.unit_of_measure,
      unit_of_measure_id: p.unit_of_measure_id,
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
    const adminId = req.headers.get('x-user-id');
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const body = await req.json();
    
    // Extract nested or flat properties robustly
    const payload = {
      ...body,
      sku: body.sku || body.SKU,
      description: body.description || body.Description,
      unit_of_measure_id: body.unit_of_measure_id ? BigInt(body.unit_of_measure_id) : undefined,
      stockQuantity: body.stockQuantity !== undefined ? Number(body.stockQuantity) : 
                     (body.stock?.currentStock !== undefined ? Number(body.stock?.currentStock) : 0),
      base_cost: body.base_cost !== undefined ? Number(body.base_cost) : 
                 (body.pricing?.purchasePrice !== undefined ? Number(body.pricing?.purchasePrice) : 0),
      base_price: body.base_price !== undefined ? Number(body.base_price) : 
                  (body.pricing?.sellingPrice !== undefined ? Number(body.pricing?.sellingPrice) : 0),
      reorder_level: body.reorder_level !== undefined ? Number(body.reorder_level) : 
                     (body.stock?.reorderLevel !== undefined ? Number(body.stock?.reorderLevel) : 0)
    };

    const product = await ProductService.createProduct(BigInt(orgId), payload, adminId ? BigInt(adminId) : undefined);
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
    if (body.unit_of_measure_id) {
      body.unit_of_measure_id = BigInt(body.unit_of_measure_id);
    }
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
