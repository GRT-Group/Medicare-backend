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
    throw new Error('Forbidden: Only Super Admin can manage subscription plans');
  }
}

export async function GET(req: NextRequest) {
  try {
    // This route's own POST/PUT/DELETE all require Super Admin auth, but
    // GET had none, exposing every plan's full pricing/limits/features to
    // any unauthenticated caller. Its only real caller (SubscriptionsPage,
    // the admin plan-management UI) is already behind SuperAdminRoute, so a
    // session token is always available there - this doesn't affect the
    // separate, intentionally-public /api/subscriptions/plans used by the
    // org-facing pricing/subscribe page.
    try {
      verifyBearerToken(req.headers)
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const plans = await SubscriptionPlanService.getAllPlans();
    return NextResponse.json(plans, { status: 200 });
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
    const plan = await SubscriptionPlanService.createPlan(body);
    return NextResponse.json(plan, { status: 201 });
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
    if (!id) return NextResponse.json({ error: 'Missing plan ID in query parameters' }, { status: 400 });

    const body = await req.json();
    const plan = await SubscriptionPlanService.updatePlan(BigInt(id), body);
    return NextResponse.json(plan, { status: 200 });
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
    if (!id) return NextResponse.json({ error: 'Missing plan ID in query parameters' }, { status: 400 });

    await SubscriptionPlanService.deletePlan(BigInt(id), BigInt(resolved.adminId));
    return NextResponse.json({ message: 'Plan deleted successfully' }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
