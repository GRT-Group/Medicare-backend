import { NextRequest, NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { SubscriptionPlanService } from '@/services/subscription-plan.service';
import { prisma } from '@/lib/prisma';
import { PermissionService } from '@/services/permission.service';
import { resolveAdminId } from '@/lib/admin-auth';
import { verifyBearerToken } from '@/lib/auth-utils';

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
    throw new Error('Forbidden: Only Super Admin can manage discount rules');
  }
}

export async function GET(req: NextRequest) {
  try {
    try {
      verifyBearerToken(req.headers)
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const discounts = await SubscriptionPlanService.getAllDiscountRules();
    return NextResponse.json(discounts, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
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

    const body = await req.json();
    const rule = await SubscriptionPlanService.createDiscountRule(body);
    return NextResponse.json(rule, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
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

    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing discount rule ID in query parameters' }, { status: 400 });

    const body = await req.json();
    const rule = await SubscriptionPlanService.updateDiscountRule(BigInt(id), body);
    return NextResponse.json(rule, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
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

    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing discount rule ID in query parameters' }, { status: 400 });

    await SubscriptionPlanService.deleteDiscountRule(BigInt(id), BigInt(resolved.adminId));
    return NextResponse.json({ message: 'Discount rule deleted successfully' }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
