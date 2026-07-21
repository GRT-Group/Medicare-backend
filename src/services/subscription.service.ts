import { prisma } from '../lib/prisma';
import { OrganizationStatus, PaymentMethod, PaymentStatus, SubscriptionStatus } from '@prisma/client';
import { initiateCollection, checkStatus, normalizeLmbtechStatus } from './lmbtech.service';
import { EmailService } from './email.service';

/**
 * The public base URL this server is reachable at — required for LMBTech's
 * callback_url (they POST here when a MOMO/card payment resolves). Falls
 * back to localhost for local dev, where LMBTech's callback obviously can't
 * reach us anyway; polling (checkMomoPaymentStatus) is what actually
 * resolves the payment in that case.
 */
function getCallbackUrl() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  return `${appUrl}/api/subscriptions/momo-webhook`;
}

export class SubscriptionService {
  /**
   * Validates if an organization is allowed to access the requested resource
   * based on their subscription lifecycle status.
   * Super Admins automatically bypass this check.
   */
  static async checkAccess(organizationId: bigint | null, resourceType: 'CORE' | 'BILLING' | 'PUBLIC', isSuperAdmin: boolean = false) {
    if (isSuperAdmin) {
      return { allowed: true };
    }

    if (!organizationId) {
      return { allowed: false, reason: 'No organization linked to this user' };
    }

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { lifecycle_status: true }
    });

    if (!org) {
      throw new Error('Organization not found');
    }

    // Public and billing resources are always accessible
    if (resourceType === 'PUBLIC' || resourceType === 'BILLING') {
      return { allowed: true };
    }

    // Core resources (POS, Inventory, Reports) require ACTIVE or TRIAL
    if (resourceType === 'CORE') {
      if (org.lifecycle_status === OrganizationStatus.ACTIVE || org.lifecycle_status === OrganizationStatus.TRIAL) {
        return { allowed: true };
      }
      return { 
        allowed: false, 
        reason: `Access denied: Organization status is ${org.lifecycle_status}` 
      };
    }

    return { allowed: false, reason: 'Unknown resource type' };
  }

  static async createSubscriptionRequest(
    organizationId: bigint,
    planId: bigint,
    months: number,
    paymentMethod: PaymentMethod,
    receiptUrl?: string
  ) {
    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) {
      throw new Error(`Organization with ID ${organizationId} does not exist. Please create an organization first.`);
    }

    if (!Number.isInteger(months) || months < 1) {
      throw new Error('months must be a positive whole number');
    }

    const plan = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { id: planId } });
    // The best discount rule is the one for these exact months. Falls back
    // to no discount rather than erroring, since not every duration needs
    // a matching rule (e.g. a plain 2-month subscription).
    const discount = await prisma.discountRule.findUnique({ where: { months } });

    const planPrice = Number(plan.price);
    const basePrice = planPrice * months;
    const discountPct = discount ? Number(discount.discount_percentage) : 0;
    const discountAmount = Math.round((basePrice * (discountPct / 100)) * 100) / 100;
    const finalPrice = Math.round((basePrice - discountAmount) * 100) / 100;

    return prisma.$transaction(async (tx) => {
      const subscription = await tx.subscription.upsert({
        where: { organization_id: organizationId },
        update: {
          plan_id: planId,
          plan_name: plan.name,
          duration_months: months,
        },
        create: {
          organization_id: organizationId,
          plan_id: planId,
          plan_name: plan.name,
          duration_months: months,
          status: SubscriptionStatus.PENDING_APPROVAL,
          end_date: new Date(),
        }
      });

      const payment = await tx.subscriptionPayment.create({
        data: {
          subscription_id: subscription.id,
          organization_id: organizationId,
          amount: finalPrice,
          payment_method: paymentMethod,
          receipt_document_url: receiptUrl,
          status: PaymentStatus.PENDING,
          // Pricing snapshot: preserved even if the plan price or discount
          // rule is edited/deleted afterwards, so the admin payments table
          // always has a complete, accurate breakdown for this payment.
          plan_name: plan.name,
          plan_price: planPrice,
          months,
          base_amount: basePrice,
          discount_percentage: discountPct,
          discount_amount: discountAmount,
        }
      });

      return { subscription, payment };
    }, {
      maxWait: 10000,
      timeout: 20000
    });
  }

  /**
   * Creates the (PENDING) subscription request/payment row, then initiates a
   * real LMBTech Mobile Money collection ("Request to Pay") against the
   * payer's phone. Unlike other payment methods, MOMO is never auto-approved
   * here — approveSubscription only runs once checkMomoPaymentStatus (poll)
   * or the momo-webhook callback confirms LMBTech reports success.
   */
  static async initiateMomoSubscriptionPayment(
    organizationId: bigint,
    planId: bigint,
    months: number,
    phone: string
  ) {
    const { subscription, payment } = await this.createSubscriptionRequest(
      organizationId,
      planId,
      months,
      PaymentMethod.MOMO
    );

    const plan = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { id: planId } });
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });

    // Reuse our own payment id as the reference — already unique, no need
    // for a second generated id, and it makes reconciling LMBTech's
    // dashboard against our SubscriptionPayment table trivial.
    const referenceId = `SUB-${payment.id}-${Date.now()}`;

    const result = await initiateCollection({
      email: org.email || `org-${org.id}@medicareone.local`,
      name: org.name,
      paymentMethod: 'MTN_MOMO_RWA',
      amount: Number(payment.amount),
      servicePaid: `subscription_${plan.name}_${months}mo`,
      referenceId,
      callbackUrl: getCallbackUrl(),
      payerPhone: phone,
    });

    const gatewayStatus = normalizeLmbtechStatus(result.status);

    const updatedPayment = await prisma.subscriptionPayment.update({
      where: { id: payment.id },
      data: {
        gateway_reference: referenceId,
        gateway_status: gatewayStatus,
        gateway_phone: phone,
      }
    });

    // LMBTech can report success synchronously in some cases — apply it
    // immediately rather than waiting for a poll/callback that may never
    // change the status further.
    if (gatewayStatus !== 'PENDING') {
      await this.applyMomoStatus(payment.id, gatewayStatus);
    }

    return { subscription, payment: updatedPayment, referenceId };
  }

  /**
   * Authoritative status check: queries LMBTech directly by reference_id
   * (rather than trusting only the webhook) and applies the outcome. Safe to
   * call repeatedly; a payment already resolved (not PENDING) is a no-op
   * read of its current state.
   */
  static async checkMomoPaymentStatus(paymentId: bigint) {
    const payment = await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: paymentId } });

    if (payment.status !== PaymentStatus.PENDING || !payment.gateway_reference) {
      return { status: payment.status, gatewayStatus: payment.gateway_status };
    }

    const result = await checkStatus(payment.gateway_reference);
    const gatewayStatus = normalizeLmbtechStatus(result.status);
    await this.applyMomoStatus(payment.id, gatewayStatus);

    return { status: (await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: paymentId } })).status, gatewayStatus };
  }

  /**
   * Applies a MoMo status observation (from either the poll or the webhook)
   * to a payment: SUCCESSFUL activates the subscription, FAILED rejects the
   * payment with the provider's reason, PENDING just records the latest
   * gateway status without changing PaymentStatus.
   */
  static async applyMomoStatus(paymentId: bigint, gatewayStatus: 'PENDING' | 'SUCCESSFUL' | 'FAILED', reason?: string) {
    const payment = await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: paymentId } });
    if (payment.status !== PaymentStatus.PENDING) {
      return; // already resolved — don't reprocess (e.g. a late webhook after we already polled SUCCESSFUL)
    }

    await prisma.subscriptionPayment.update({
      where: { id: paymentId },
      data: { gateway_status: gatewayStatus, gateway_reason: reason, gateway_checked_at: new Date() }
    });

    if (gatewayStatus === 'SUCCESSFUL') {
      await this.approveSubscription(paymentId);
    } else if (gatewayStatus === 'FAILED') {
      await prisma.subscriptionPayment.update({
        where: { id: paymentId },
        data: { status: PaymentStatus.REJECTED }
      });
    }
    // PENDING: nothing further to do yet.
  }

  static async approveSubscription(paymentId: bigint, adminId?: bigint) {
    const invoiceData = await prisma.$transaction(async (tx) => {
      const payment = await tx.subscriptionPayment.findUniqueOrThrow({
        where: { id: paymentId },
        include: { subscription: true }
      });

      if (payment.status !== PaymentStatus.PENDING) {
        throw new Error("Payment is not pending");
      }

      await tx.subscriptionPayment.update({
        where: { id: paymentId },
        data: { status: PaymentStatus.APPROVED, processed_by_id: adminId || null }
      });

      // Every approved payment (new plan, plan change, or renewal) replaces
      // the subscription period outright: start_date = now, end_date = now +
      // this payment's own duration. We never append to whatever end_date the
      // previous plan happened to have — otherwise switching plans, or
      // approving a payment against stale test/demo data, silently stacks
      // months onto an unrelated old period instead of applying the plan
      // the org just paid for.
      const duration = payment.months ?? payment.subscription.duration_months;
      const now = new Date();
      const endDate = new Date(now);
      endDate.setMonth(endDate.getMonth() + duration);

      await tx.subscription.update({
        where: { id: payment.subscription_id },
        data: {
          status: SubscriptionStatus.ACTIVE,
          duration_months: duration,
          start_date: now,
          end_date: endDate,
        }
      });

      const org = await tx.organization.update({
        where: { id: payment.organization_id },
        data: { lifecycle_status: OrganizationStatus.ACTIVE }
      });

      return {
        email: org.email,
        organizationName: org.name,
        planName: payment.plan_name,
        amount: Number(payment.amount),
        startDate: now,
        endDate: endDate,
        referenceId: payment.gateway_reference || ("SUB-" + payment.id.toString())
      };
    }, {
      maxWait: 10000,
      timeout: 20000
    });

    if (invoiceData.email) {
      EmailService.sendInvoice(
        invoiceData.email,
        invoiceData.organizationName || 'Valued Customer',
        invoiceData.planName || 'Subscription',
        invoiceData.amount,
        invoiceData.startDate,
        invoiceData.endDate,
        invoiceData.referenceId
      ).catch(err => console.error("Failed to send invoice email:", err));
    }

    return true;
  }

  static async rejectSubscription(paymentId: bigint, adminId: bigint) {
    return prisma.subscriptionPayment.update({
      where: { id: paymentId },
      data: { status: PaymentStatus.REJECTED, processed_by_id: adminId }
    });
  }

  /**
   * Subscriptions expiring within the next `daysAhead` days (default 7), plus
   * any already expired. Used to decide who gets a renewal reminder — a
   * single query the reminder API and any future cron/scheduled job can share.
   */
  static async getRenewalReminderTargets(daysAhead: number = 7) {
    const now = new Date();
    const horizon = new Date(now);
    horizon.setDate(horizon.getDate() + daysAhead);

    const subscriptions = await prisma.subscription.findMany({
      where: {
        is_deleted: false,
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.EXPIRED] },
        end_date: { lte: horizon }
      },
      include: {
        Organization: {
          select: { id: true, name: true, email: true, phone: true }
        }
      },
      orderBy: { end_date: 'asc' }
    });

    return subscriptions.map(sub => {
      const daysUntilExpiry = Math.ceil((sub.end_date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return {
        subscription: sub,
        organization: sub.Organization,
        daysUntilExpiry,
        isExpired: daysUntilExpiry < 0
      };
    });
  }
}
