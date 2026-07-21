import { NextRequest, NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error';
import { SaleService } from '@/services/sale.service';
import { resolveContext, toErrorResponse } from '@/lib/agrovet/context';
import { prisma } from '@/lib/prisma';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await resolveContext(req as any);

    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: `Invalid sale id: "${id}"` }, { status: 400 });
    }

    const body = await req.json().catch(() => ({})); // Handle empty body gracefully
    let rawAmount = body.amount ?? body.amount_paid ?? body.amountPaid;
    let paymentMethod = body.payment_method || body.paymentMethod || 'CASH';

    if (rawAmount === undefined || rawAmount === null || rawAmount === '') {
      // If no amount is provided, default to paying the full remaining balance
      const sale = await prisma.sale.findUnique({
        where: { id: BigInt(id) },
        select: { remaining_balance: true }
      });
      if (!sale) return NextResponse.json({ error: 'Sale not found' }, { status: 404 });
      rawAmount = Number(sale.remaining_balance);
    }

    const amount = Number(rawAmount);
    if (isNaN(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Valid amount is required' }, { status: 400 });
    }

    const sale = await SaleService.payCreditSale(BigInt(id), ctx.organizationId, ctx.userId, amount, paymentMethod);
    return NextResponse.json(sale, { status: 200 });
  } catch (error: any) {
    if (/not found/i.test(error?.message ?? '')) {
      return NextResponse.json({ error: friendlyMessage(error) }, { status: 404 });
    }
    const { body, status } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
