import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { friendlyMessage } from '@/lib/api-error';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function POST(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id') || '1';
    
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const body = await req.json();

    // In a draft sale, we don't generate an invoice number yet, we generate it on complete.
    // We can use a temporary draft identifier.
    const tempInvoice = `DRAFT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const sale = await prisma.sale.create({
      data: {
        organization_id: BigInt(orgId),
        created_by_id: BigInt(adminId),
        status: 'PENDING',
        total_amount: 0,
        invoice_number: tempInvoice,
        cash_session_id: body.registerId ? BigInt(body.registerId) : undefined,
        local_id: body.localId,
        sync_status: body.localId ? 'PENDING' : 'SYNCED'
      }
    });
    
    return NextResponse.json(sale, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
