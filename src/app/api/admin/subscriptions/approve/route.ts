import { NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { SubscriptionService } from '@/services/subscription.service';
import { prisma } from '@/lib/prisma';
import { PermissionService } from '@/services/permission.service';
import { resolveAdminId } from '@/lib/admin-auth';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

async function requireApprover(adminId: string | null) {
  if (!adminId) {
    throw new Error('Unauthorized: Missing adminId');
  }

  const admin = await prisma.user.findUnique({
    where: { id: BigInt(adminId) },
    select: { id: true, role_id: true }
  });

  if (!admin || !PermissionService.isAdminOrHigher(admin.role_id)) {
    throw new Error('Forbidden: Only Admin or Super Admin can approve subscriptions');
  }
}

export async function POST(req: Request) {
  try {
    const resolved = resolveAdminId(req as any);
    if (!resolved.adminId) {
      return NextResponse.json({ error: resolved.error || 'Unauthorized' }, { status: resolved.status || 401 });
    }
    // The acting admin is always the verified bearer token's own identity —
    // never a client-supplied id — otherwise anyone who knows an admin's
    // user id could approve/reject payments with no authentication at all.
    const adminId = resolved.adminId;

    const body = await req.json();
    const { paymentId, action } = body;

    if (!paymentId || !action) {
      return NextResponse.json({ error: 'Missing paymentId or action' }, { status: 400 });
    }

    try {
      await requireApprover(adminId);
    } catch (error: any) {
      const status = error.message.startsWith('Unauthorized') ? 401 : 403;
      return NextResponse.json({ error: friendlyMessage(error) }, { status });
    }

    if (action === 'APPROVE') {
      await SubscriptionService.approveSubscription(BigInt(paymentId), BigInt(adminId));
      return NextResponse.json({ message: 'Subscription approved successfully' }, { status: 200 });
    } else if (action === 'REJECT') {
      await SubscriptionService.rejectSubscription(BigInt(paymentId), BigInt(adminId));
      return NextResponse.json({ message: 'Subscription rejected' }, { status: 200 });
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
