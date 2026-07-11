import { NextRequest, NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { SaleService } from '@/services/sale.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const orgId = req.headers.get('x-organization-id');
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: 'Invalid customer id' }, { status: 400 });
    }

    const sales = await SaleService.getCustomerUnpaidSales(BigInt(id), BigInt(orgId));
    
    return NextResponse.json(sales, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
