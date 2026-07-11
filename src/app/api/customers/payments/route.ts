import { NextResponse } from 'next/server';
import { apiError, friendlyMessage } from '@/lib/api-error'
import { normalizePaymentMethod, parseOptionalId, PAYMENT_METHODS_HINT } from '@/lib/sale-input'
import { CustomerPaymentService } from '@/services/customer-payment.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function GET(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const url = new URL(req.url);
    const customerId = url.searchParams.get('customerId');

    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const payments = await CustomerPaymentService.getPayments(
      BigInt(orgId),
      customerId ? BigInt(customerId) : undefined
    );
    
    return NextResponse.json(payments, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id') || '1';
    
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const body = await req.json().catch(() => ({}));

    // Accept camelCase and snake_case; every bad input is a readable 400.
    const customerId = parseOptionalId(body.customer_id ?? body.customerId, 'customer_id');
    if (!customerId) {
      return NextResponse.json({ success: false, error: 'customer_id is required' }, { status: 400 });
    }

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ success: false, error: 'amount must be a positive number' }, { status: 400 });
    }

    const methodRaw = body.payment_method ?? body.paymentMethod ?? 'CASH';
    const paymentMethod = normalizePaymentMethod(methodRaw);
    if (!paymentMethod) {
      return NextResponse.json({ success: false, error: `Unknown payment_method "${methodRaw}". Use ${PAYMENT_METHODS_HINT}.` }, { status: 400 });
    }

    const payment = await CustomerPaymentService.makePayment(BigInt(orgId), {
      customer_id: customerId,
      amount,
      payment_method: paymentMethod as any,
      reference: body.reference,
    }, BigInt(adminId));

    return NextResponse.json({ success: true, message: 'Payment recorded', data: payment }, { status: 201 });
  } catch (error: any) {
    return apiError(error);
  }
}
