// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { SaleService } from '@/services/sale.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

/**
 * GET /api/sales/:id — single sale with full detail (line items + product,
 * customer, branch). PUT updates status; DELETE voids the sale (reverses
 * stock, customer balance and cashbook). Path forms of the query-string
 * variants on /api/sales.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const orgId = req.headers.get('x-organization-id');
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      // Catches the frontend passing a missing id ("/api/sales/undefined")
      // with a clear message instead of an anonymous route-level 404.
      return NextResponse.json({ error: `Invalid sale id: "${id}"` }, { status: 400 });
    }

    const sale = await SaleService.getSaleById(BigInt(id), BigInt(orgId));
    if (!sale) {
      return NextResponse.json({ error: 'Sale not found' }, { status: 404 });
    }

    return NextResponse.json(sale, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const orgId = req.headers.get('x-organization-id');
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: `Invalid sale id: "${id}"` }, { status: 400 });
    }

    const body = await req.json();
    const sale = await SaleService.updateSale(BigInt(id), BigInt(orgId), body);
    return NextResponse.json(sale, { status: 200 });
  } catch (error: any) {
    const status = /not found/i.test(error?.message ?? '') ? 404 : 500;
    return NextResponse.json({ error: friendlyMessage(error) }, { status });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id') || '1';
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: `Invalid sale id: "${id}"` }, { status: 400 });
    }

    await SaleService.deleteSale(BigInt(id), BigInt(orgId), BigInt(adminId));
    return NextResponse.json({ message: 'Sale voided successfully. Stock and balances have been reversed.' }, { status: 200 });
  } catch (error: any) {
    console.error("DELETE SALE ERROR:", error);
    const status = /not found|already voided/i.test(error?.message ?? '') ? 404 : 500;
    return NextResponse.json({ error: friendlyMessage(error), details: error?.message, stack: error?.stack }, { status });
  }
}
