// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { SaleService } from '@/services/sale.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

/**
 * GET /api/customers/:id/statement?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Customer statement/ledger: every sale (debit) and payment (credit) merged
 * into one chronological list with a running balance, plus opening/closing
 * balance and totals for the period — what an accountant needs to
 * reconcile an account, instead of two separate sales/payments lists.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const orgId = req.headers.get('x-organization-id');
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: 'Invalid customer id' }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');
    const from = fromParam ? new Date(fromParam) : undefined;
    const to = toParam ? new Date(toParam) : undefined;

    if (fromParam && isNaN(from!.getTime())) {
      return NextResponse.json({ error: 'Invalid "from" date' }, { status: 400 });
    }
    if (toParam && isNaN(to!.getTime())) {
      return NextResponse.json({ error: 'Invalid "to" date' }, { status: 400 });
    }

    const statement = await SaleService.getCustomerStatement(BigInt(id), BigInt(orgId), from, to);
    if (!statement) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    return NextResponse.json(statement, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
