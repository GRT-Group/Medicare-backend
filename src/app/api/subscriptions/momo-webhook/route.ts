import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { SubscriptionService } from '@/services/subscription.service';
import { normalizeLmbtechStatus } from '@/services/lmbtech.service';

/**
 * POST /api/subscriptions/momo-webhook
 * LMBTech's payment callback — this is the callback_url passed on every
 * initiateCollection call (see subscription.service.ts). Called for both
 * Mobile Money and Card payments once the transaction resolves.
 *
 * Per LMBTech's "PAYMENT API Documentation guide", the JSON body is:
 *   { reference_id, transaction_id, status, amount, payment_method, payer_phone }
 * and the expected response shape is:
 *   { status: true/false, message, site_url }
 *
 * Not authenticated by LMBTech with any signature we can verify — this
 * route can't be tricked into resolving an arbitrary payment though: it can
 * only ever affect a reference_id that already exists as one of our own
 * PENDING SubscriptionPayment rows (an unrecognized reference is a no-op).
 * checkMomoPaymentStatus (poll) remains available as a fallback if this
 * callback is ever delayed or dropped.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ status: false, message: 'Invalid callback data' }, { status: 400 });
    }

    const referenceId: string | undefined = body.reference_id;
    const status: string | undefined = body.status;

    if (!referenceId || !status) {
      return NextResponse.json({ status: false, message: 'Missing reference_id/status in callback' }, { status: 400 });
    }

    const payment = await prisma.subscriptionPayment.findUnique({ where: { gateway_reference: referenceId } });
    if (!payment) {
      // Unknown reference — acknowledge so LMBTech doesn't keep retrying,
      // but don't touch any data.
      return NextResponse.json({ status: true, message: 'Callback received and processed', site_url: process.env.NEXT_PUBLIC_APP_URL || '' }, { status: 200 });
    }

    const gatewayStatus = normalizeLmbtechStatus(status);
    await SubscriptionService.applyMomoStatus(payment.id, gatewayStatus);

    return NextResponse.json({ status: true, message: 'Callback received and processed', site_url: process.env.NEXT_PUBLIC_APP_URL || '' }, { status: 200 });
  } catch (error: any) {
    console.error('[LMBTECH WEBHOOK ERROR]', error);
    // Always 200 for a webhook so the provider doesn't hammer retries on our
    // own bug — the poll endpoint remains the authoritative recovery path.
    return NextResponse.json({ status: false, message: 'Internal error processing callback' }, { status: 200 });
  }
}
