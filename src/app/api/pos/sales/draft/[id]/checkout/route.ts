import { NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error';
import { PosCheckoutService } from '@/services/pos-checkout.service';
import { prisma } from '@/lib/prisma';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id') || '1';
    
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const saleId = BigInt(id);
    const body = await req.json();

    const paymentAmount = Number(body.amountPaid || 0);
    const paymentMethod = body.paymentMethod || 'CASH';

    const completedSale = await PosCheckoutService.checkout(
      saleId, 
      BigInt(orgId), 
      BigInt(adminId), 
      paymentAmount, 
      paymentMethod
    );
    
    // Once completed, we generate a formal receipt number 
    // so abandoned drafts don't burn sequence numbers.
    const receiptNumber = `REC-${Date.now()}-${completedSale.id}`;
    
    const finalSale = await prisma.sale.update({
      where: { id: completedSale.id },
      data: { invoice_number: receiptNumber }
    });

    return NextResponse.json(finalSale, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
