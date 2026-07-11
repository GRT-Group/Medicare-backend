// @ts-nocheck
import { NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { prisma } from '@/lib/prisma';
import { PermissionService } from '@/services/permission.service';
import { resolveAdminId } from '@/lib/admin-auth';

// JSON serialization for BigInt
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

async function requireSuperAdmin(adminId: string | null) {
  if (!adminId) {
    throw new Error('Unauthorized: Missing Admin ID');
  }

  const admin = await prisma.user.findUnique({
    where: { id: BigInt(adminId) },
    select: { id: true, role_id: true }
  });

  if (!admin || !PermissionService.isSuperAdmin(admin.role_id)) {
    throw new Error('Forbidden: Only Super Admin can view subscription payments');
  }
}

export async function GET(req: Request) {
  try {
    try {
      const resolved = resolveAdminId(req as any);
      if (!resolved.adminId) {
        return NextResponse.json({ error: resolved.error || 'Unauthorized' }, { status: resolved.status || 401 });
      }
      await requireSuperAdmin(resolved.adminId);
    } catch (error: any) {
      const status = error.message.startsWith('Unauthorized') ? 401 : 403;
      return NextResponse.json({ error: friendlyMessage(error) }, { status });
    }

    const url = new URL(req.url);
    const status = url.searchParams.get('status');

    const whereClause = status ? { status: status as any } : {};

    const payments = await prisma.subscriptionPayment.findMany({
      where: whereClause,
      include: {
        Organization: {
          select: { name: true, code: true, email: true, phone: true }
        },
        subscription: {
          select: { plan_name: true, duration_months: true, status: true, start_date: true, end_date: true }
        },
        User_SubscriptionPayment_processed_by_idToUser: {
          select: { id: true, first_name: true, last_name: true, email: true }
        }
      },
      orderBy: { date: 'desc' }
    });

    // Every column the admin payments table needs is guaranteed present:
    // - plan_name/plan_price/months/base_amount/discount_percentage/discount_amount
    //   come from the pricing snapshot taken when the payment was created,
    //   so they stay correct even if the plan/discount rule changes later.
    // - Pre-snapshot rows (created before this column set existed) fall
    //   back to the linked subscription/amount so no cell is ever blank.
    const serialized = payments.map(({ Organization, User_SubscriptionPayment_processed_by_idToUser, subscription, ...payment }) => {
      const planName = payment.plan_name ?? subscription?.plan_name ?? null;
      const months = payment.months ?? subscription?.duration_months ?? null;
      const amount = Number(payment.amount);
      const baseAmount = payment.base_amount != null ? Number(payment.base_amount) : amount;
      const discountAmount = payment.discount_amount != null ? Number(payment.discount_amount) : Math.max(baseAmount - amount, 0);
      const discountPercentage = payment.discount_percentage != null
        ? Number(payment.discount_percentage)
        : (baseAmount > 0 ? Math.round((discountAmount / baseAmount) * 10000) / 100 : 0);

      return {
        ...payment,
        organization: Organization,
        subscription,
        plan_name: planName,
        plan_price: payment.plan_price != null ? Number(payment.plan_price) : null,
        months,
        base_amount: baseAmount,
        discount_percentage: discountPercentage,
        discount_amount: discountAmount,
        amount,
        has_discount: discountAmount > 0,
        processed_by: User_SubscriptionPayment_processed_by_idToUser
          ? {
              id: User_SubscriptionPayment_processed_by_idToUser.id,
              name: `${User_SubscriptionPayment_processed_by_idToUser.first_name} ${User_SubscriptionPayment_processed_by_idToUser.last_name}`.trim(),
              email: User_SubscriptionPayment_processed_by_idToUser.email
            }
          : null
      };
    });

    return NextResponse.json(serialized, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
