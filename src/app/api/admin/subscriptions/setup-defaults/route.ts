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
    throw new Error('Forbidden: Only Super Admin can initialize defaults');
  }
}

export async function POST(req: Request) {
  try {
    const resolved = resolveAdminId(req as any);
    if (!resolved.adminId) {
      return NextResponse.json({ error: resolved.error || 'Unauthorized' }, { status: resolved.status || 401 });
    }
    try {
      await requireSuperAdmin(resolved.adminId);
    } catch (error: any) {
      const status = error.message.startsWith('Unauthorized') ? 401 : 403;
      return NextResponse.json({ error: friendlyMessage(error) }, { status });
    }

    // 1. Setup Plans (Based on Updated Quotation)
    const plans = [
      {
        name: 'Popular Plan',
        price: 35999.00,
        features: { code: 'POPULAR', pos: true, inventory: true, reports: true, branches_limit: 1, users_limit: 3 }
      },
      {
        name: 'Standard Plan',
        price: 59999.00,
        features: { code: 'STANDARD', pos: true, inventory: true, reports: true, branches_limit: 3, users_limit: 10 }
      },
      {
        name: 'Max Plan',
        price: 99999.00,
        features: { code: 'MAX', pos: true, inventory: true, reports: true, branches_limit: 999, users_limit: 999, advanced_analytics: true }
      }
    ];

    const createdPlans = [];
    for (const plan of plans) {
      const p = await prisma.subscriptionPlan.upsert({
        where: { name: plan.name },
        update: { price: plan.price, features: plan.features },
        create: plan
      });
      createdPlans.push(p);
    }

    // 2. Setup Discount Rules (Based on Updated Quotation)
    const discounts = [
      { months: 1, discount_percentage: 0.00 }, 
      { months: 6, discount_percentage: 10.00 }, // 6-month discount auto-applied (10%)
    ];

    const createdDiscounts = [];
    for (const discount of discounts) {
      const d = await prisma.discountRule.upsert({
        where: { months: discount.months },
        update: { discount_percentage: discount.discount_percentage },
        create: discount
      });
      createdDiscounts.push(d);
    }

    // 3. Ensure the MANAGE:SUBSCRIPTION permission exists so org
    // admins/owners can be granted it via /api/roles (UPDATE_PERMISSIONS)
    // to manage their own organization's subscription/payments.
    let subscriptionPermission = await prisma.permission.findFirst({
      where: { action: 'MANAGE', subject: 'SUBSCRIPTION' }
    });
    if (!subscriptionPermission) {
      subscriptionPermission = await prisma.permission.create({
        data: {
          action: 'MANAGE',
          subject: 'SUBSCRIPTION',
          description: 'Manage the organization subscription: view billing status, submit payments, renew plan.'
        }
      });
    }

    return NextResponse.json({
      message: 'System defaults successfully configured at once!',
      plans: createdPlans,
      discountRules: createdDiscounts,
      permission: subscriptionPermission
    }, { status: 201 });

  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
