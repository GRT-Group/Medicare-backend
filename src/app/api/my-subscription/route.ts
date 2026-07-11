import { NextRequest, NextResponse } from "next/server";
import { verifyBearerToken } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { SubscriptionStatus, PaymentMethod } from "@prisma/client";
import { resolveContext, requirePermission, toErrorResponse } from "@/lib/agrovet/context";
import { SubscriptionService } from "@/services/subscription.service";

export const dynamic = 'force-dynamic';

function serialize(obj: any) {
  return JSON.parse(JSON.stringify(obj, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  ));
}

export async function GET(req: NextRequest) {
  try {
    let auth;
    try {
      auth = verifyBearerToken(req.headers);
    } catch {
      return NextResponse.json({ success: false, error: "Unauthorized: valid bearer token required" }, { status: 401 });
    }

    let orgId = auth.organization_id || auth.organizationId;
    if (!orgId && req.headers.get('x-organization-id')) {
      orgId = req.headers.get('x-organization-id');
    }

    if (!orgId) {
      return NextResponse.json({ success: false, error: "No organization associated with this user" }, { status: 400 });
    }

    const subscription = await prisma.subscription.findUnique({
      where: { organization_id: BigInt(orgId) },
      include: {
        subscription_plan: true,
        SubscriptionPayment: {
          orderBy: { date: 'desc' },
          take: 1
        }
      }
    });

    if (!subscription) {
      return NextResponse.json({ success: true, subscription: null }, { status: 200 });
    }

    const now = new Date();
    const endDate = subscription.end_date;
    const remainingDays = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    const isActive = subscription.status === SubscriptionStatus.ACTIVE && endDate > now;

    const latestPayment = subscription.SubscriptionPayment?.[0];

    const mappedSubscription = {
      id: subscription.id.toString(),
      organizationId: subscription.organization_id.toString(),
      plan: subscription.plan_name || subscription.subscription_plan?.name || "Professional",
      status: subscription.status,
      startDate: subscription.start_date.toISOString(),
      endDate: subscription.end_date.toISOString(),
      remainingDays,
      paymentStatus: latestPayment?.status || null,
      paymentMethod: latestPayment?.payment_method || null,
      isActive,
      // Present only for MOMO payments awaiting the payer's approval — lets
      // the frontend poll GET /api/subscriptions/momo-status?paymentId=... .
      pendingMomoPaymentId: latestPayment?.payment_method === 'MOMO' && latestPayment.status === 'PENDING'
        ? latestPayment.id.toString()
        : null,
      // Pricing breakdown from the most recent payment's snapshot, so the UI
      // can show "amount after discount" without recomputing plan pricing.
      billing: latestPayment ? {
        months: latestPayment.months,
        planPrice: latestPayment.plan_price?.toString() ?? null,
        baseAmount: latestPayment.base_amount?.toString() ?? null,
        discountPercentage: latestPayment.discount_percentage?.toString() ?? "0",
        discountAmount: latestPayment.discount_amount?.toString() ?? "0",
        amountDue: latestPayment.amount.toString(),
      } : null,
    };

    return NextResponse.json({ success: true, subscription: mappedSubscription }, { status: 200 });
  } catch (error: any) {
    console.error("GET /api/my-subscription error:", error);
    const { body, status } = toErrorResponse(error);
    return NextResponse.json({ success: false, ...body }, { status });
  }
}

/**
 * Renew/activate the caller's own organization subscription. Gated to org
 * admins/owners (MANAGE:SUBSCRIPTION) or Super Admin, and routed through the
 * same paid-request flow as /api/subscriptions/subscribe (pricing snapshot +
 * PENDING_APPROVAL for manual invoices) rather than forcing ACTIVE directly.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await resolveContext(req);
    await requirePermission(ctx, 'MANAGE', 'SUBSCRIPTION');

    const body = await req.json().catch(() => ({}));
    const { planId, months, paymentMethod, receiptUrl, phone } = body;

    if (!planId || !months || !paymentMethod) {
      return NextResponse.json({ success: false, error: 'planId, months, and paymentMethod are required' }, { status: 400 });
    }
    if (paymentMethod === PaymentMethod.MANUAL_INVOICE && !receiptUrl) {
      return NextResponse.json({ success: false, error: 'A receipt image or PDF URL must be uploaded for manual invoice payments.' }, { status: 400 });
    }
    if (paymentMethod === PaymentMethod.MOMO && !phone) {
      return NextResponse.json({ success: false, error: 'A phone number is required for Mobile Money payments.' }, { status: 400 });
    }

    // MOMO initiates a real MTN request-to-pay and stays PENDING until the
    // payer approves it on their phone — never auto-approved like the other
    // methods below.
    if (paymentMethod === PaymentMethod.MOMO) {
      const result = await SubscriptionService.initiateMomoSubscriptionPayment(
        ctx.organizationId,
        BigInt(planId),
        Number(months),
        phone
      );
      return NextResponse.json({
        success: true,
        message: 'Mobile Money payment request sent. Please approve it on your phone.',
        subscription: serialize(result.subscription),
        payment: serialize(result.payment),
        referenceId: result.referenceId,
      }, { status: 200 });
    }

    const result = await SubscriptionService.createSubscriptionRequest(
      ctx.organizationId,
      BigInt(planId),
      Number(months),
      paymentMethod as PaymentMethod,
      receiptUrl
    );

    // Online payments activate immediately; manual invoices stay
    // PENDING_APPROVAL until an admin reviews them via
    // /api/admin/subscriptions/approve.
    if (paymentMethod !== PaymentMethod.MANUAL_INVOICE) {
      await SubscriptionService.approveSubscription(result.payment.id, ctx.userId);
    }

    const subscription = await prisma.subscription.findUnique({ where: { id: result.subscription.id } });
    const payment = await prisma.subscriptionPayment.findUnique({ where: { id: result.payment.id } });

    return NextResponse.json({
      success: true,
      message: paymentMethod === PaymentMethod.MANUAL_INVOICE
        ? 'Payment submitted and is pending admin approval.'
        : 'Subscription renewed successfully.',
      subscription: serialize(subscription),
      payment: serialize(payment),
    }, { status: 200 });
  } catch (error: any) {
    console.error("POST /api/my-subscription error:", error);
    const { body, status } = toErrorResponse(error);
    return NextResponse.json({ success: false, ...body }, { status });
  }
}
