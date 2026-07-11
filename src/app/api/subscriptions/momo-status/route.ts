import { NextRequest, NextResponse } from 'next/server';
import { verifyBearerToken } from '@/lib/auth-utils';
import { prisma } from '@/lib/prisma';
import { SubscriptionService } from '@/services/subscription.service';
import { toErrorResponse } from '@/lib/agrovet/context';

/**
 * GET /api/subscriptions/momo-status?paymentId=123
 * Polls MTN directly for the outcome of a pending MoMo request-to-pay and
 * applies it (activating the subscription on SUCCESSFUL). This is the
 * authoritative check — the frontend should call this every few seconds
 * while showing "waiting for approval on your phone," rather than relying
 * solely on the webhook (MTN sandbox callbacks are known to be unreliable).
 */
export async function GET(req: NextRequest) {
  try {
    let auth;
    try {
      auth = verifyBearerToken(req.headers);
    } catch {
      return NextResponse.json({ success: false, error: 'Unauthorized: valid bearer token required' }, { status: 401 });
    }

    const paymentIdParam = req.nextUrl.searchParams.get('paymentId');
    if (!paymentIdParam || !/^\d+$/.test(paymentIdParam)) {
      return NextResponse.json({ success: false, error: 'paymentId query parameter is required' }, { status: 400 });
    }
    const paymentId = BigInt(paymentIdParam);

    const payment = await prisma.subscriptionPayment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.organization_id.toString() !== String(auth.organization_id)) {
      return NextResponse.json({ success: false, error: 'Payment not found' }, { status: 404 });
    }

    const result = await SubscriptionService.checkMomoPaymentStatus(paymentId);

    return NextResponse.json({ success: true, data: result }, { status: 200 });
  } catch (error: any) {
    const { body, status } = toErrorResponse(error);
    return NextResponse.json({ success: false, ...body }, { status });
  }
}
