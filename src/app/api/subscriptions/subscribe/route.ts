import { NextResponse } from 'next/server';
import { classifyError } from '@/lib/api-error'
import { SubscriptionService } from '@/services/subscription.service';
import { PaymentMethod } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { verifyBearerToken } from '@/lib/auth-utils';
import { getFlowToken, verifyFlowToken, issueFlowToken, FlowTokenError } from '@/lib/flow-token';
import { PermissionService } from '@/services/permission.service';

// JSON serialization for BigInt
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { planId, months, paymentMethod, receiptUrl, phone } = body;

    if (!planId || !months || !paymentMethod) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    // Caller must either be mid-registration (flow token from /api/auth/register,
    // step 'subscribe') or an already-authenticated user changing their own
    // org's plan (session bearer token). Either way, organizationId is
    // derived from that trusted token — never from the request body/URL —
    // so the frontend never needs to know or carry the raw id, and there's
    // no way for a caller to subscribe an arbitrary organizationId.
    let resolvedOrganizationId: string | null = null;
    let flowUserId: string | null = null;
    const flowToken = getFlowToken(req.headers);
    if (flowToken) {
      // Mid-registration: the caller has no session yet, so there's no
      // existing admin/owner to gate against — this is the org's first plan pick.
      const flowPayload = verifyFlowToken(flowToken, 'subscribe');
      resolvedOrganizationId = flowPayload.organizationId ?? null;
      flowUserId = flowPayload.userId;
    } else {
      // Already-authenticated user changing their own org's plan: must hold
      // MANAGE:SUBSCRIPTION (or be admin/higher) so regular staff can't buy/change plans.
      let decoded;
      try {
        decoded = verifyBearerToken(req.headers);
      } catch {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }
      resolvedOrganizationId = decoded.organization_id ?? decoded.organizationId ?? req.headers.get('x-organization-id') ?? null;
      if (!resolvedOrganizationId) {
        return NextResponse.json({ success: false, error: 'No organization associated with this user' }, { status: 400 });
      }
      const canManageSubscription =
        PermissionService.isAdminOrHigher(decoded.role_id) ||
        (await PermissionService.hasPermission(BigInt(decoded.id), 'MANAGE', 'SUBSCRIPTION', BigInt(resolvedOrganizationId)));
      if (!canManageSubscription) {
        return NextResponse.json({ success: false, error: 'Forbidden: only an organization admin/owner can manage the subscription' }, { status: 403 });
      }
    }

    if (!resolvedOrganizationId) {
      return NextResponse.json({ success: false, error: 'You are not authorized to manage this organization\'s subscription.' }, { status: 403 });
    }

    const organizationId = resolvedOrganizationId;

    // Professional Validation for Payment Type
    if (paymentMethod === 'MANUAL_INVOICE' && !receiptUrl) {
      return NextResponse.json({ success: false, error: 'A receipt image or PDF URL must be uploaded for manual invoice payments.' }, { status: 400 });
    }
    if (paymentMethod === 'MOMO' && !phone) {
      return NextResponse.json({ success: false, error: 'A phone number is required for Mobile Money payments.' }, { status: 400 });
    }

    // Only issue a fresh verify-otp flow token for the pre-account
    // (registration) path — an already-logged-in user changing plans
    // doesn't need one.
    const nextFlowToken = flowUserId
      ? issueFlowToken({
          userId: flowUserId,
          organizationId,
          step: 'verify-otp',
        })
      : undefined;

    // MOMO initiates a real MTN request-to-pay and stays PENDING until the
    // payer approves it on their phone (confirmed via poll or webhook) — it
    // is never auto-approved like the other methods below.
    if (paymentMethod === 'MOMO') {
      const result = await SubscriptionService.initiateMomoSubscriptionPayment(
        BigInt(organizationId),
        BigInt(planId),
        Number(months),
        phone
      );
      return NextResponse.json({
        success: true,
        message: 'Mobile Money payment request sent. Please approve it on your phone.',
        subscription: result.subscription,
        payment: result.payment,
        referenceId: result.referenceId,
        flowToken: nextFlowToken,
      }, { status: 201 });
    }

    const result = await SubscriptionService.createSubscriptionRequest(
      BigInt(organizationId),
      BigInt(planId),
      Number(months),
      paymentMethod as PaymentMethod,
      receiptUrl
    );

    if (paymentMethod !== 'MANUAL_INVOICE') {
      await SubscriptionService.approveSubscription(result.payment.id);
    }

    // We must fetch the updated subscription to reflect current status
    const finalSub = await prisma.subscription.findUnique({ where: { id: result.subscription.id } });
    const finalPay = await prisma.subscriptionPayment.findUnique({ where: { id: result.payment.id } });

    return NextResponse.json({
      success: true,
      message: paymentMethod === 'MANUAL_INVOICE' ? 'Payment submitted and is pending approval.' : 'Payment processed successfully. Subscription is now ACTIVE!',
      subscription: finalSub,
      payment: finalPay,
      flowToken: nextFlowToken,
    }, { status: 201 });
  } catch (error: any) {
    if (error instanceof FlowTokenError) {
      const { body } = classifyError(error);
      return NextResponse.json({ success: false, error: body.error }, { status: 401 });
    }
    const { body, status } = classifyError(error);
    return NextResponse.json(body, { status });
  }
}
