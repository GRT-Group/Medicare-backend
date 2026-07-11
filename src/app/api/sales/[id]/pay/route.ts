import { NextRequest, NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error';
import { SaleService } from '@/services/sale.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id');
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });
    if (!adminId) return NextResponse.json({ error: 'Missing x-user-id header' }, { status: 400 });

    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: `Invalid sale id: "${id}"` }, { status: 400 });
    }

    const body = await req.json();
    const amount = Number(body.amount);
    const paymentMethod = body.payment_method || 'CASH';

    if (isNaN(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Valid amount is required' }, { status: 400 });
    }

    const sale = await SaleService.payCreditSale(BigInt(id), BigInt(orgId), BigInt(adminId), amount, paymentMethod);
    return NextResponse.json(sale, { status: 200 });
  } catch (error: any) {
    const status = /not found/i.test(error?.message ?? '') ? 404 : 400;
    return NextResponse.json({ error: friendlyMessage(error) }, { status });
  }
}
