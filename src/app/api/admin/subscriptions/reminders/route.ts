import { NextRequest, NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { SubscriptionService } from '@/services/subscription.service';
import { EmailService } from '@/services/email.service';
import { smsSend } from '@/services/sms.service';
import { prisma } from '@/lib/prisma';
import { PermissionService } from '@/services/permission.service';
import { resolveAdminId } from '@/lib/admin-auth';

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
    throw new Error('Forbidden: Only Super Admin can manage subscription reminders');
  }
}

function serializeTarget(t: Awaited<ReturnType<typeof SubscriptionService.getRenewalReminderTargets>>[number]) {
  return {
    organizationId: t.organization.id.toString(),
    organizationName: t.organization.name,
    organizationEmail: t.organization.email,
    organizationPhone: t.organization.phone,
    subscriptionId: t.subscription.id.toString(),
    planName: t.subscription.plan_name,
    status: t.subscription.status,
    endDate: t.subscription.end_date,
    daysUntilExpiry: t.daysUntilExpiry,
    isExpired: t.isExpired,
  }
}

/**
 * GET — preview who would receive a renewal reminder right now, without
 * sending anything. Lets the Super Admin review the list in the UI first.
 * Query: ?daysAhead=7 (default 7)
 */
export async function GET(req: NextRequest) {
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

    const { searchParams } = new URL(req.url);
    const daysAhead = Number(searchParams.get('daysAhead')) || 7;

    const targets = await SubscriptionService.getRenewalReminderTargets(daysAhead);

    return NextResponse.json({
      count: targets.length,
      daysAhead,
      targets: targets.map(serializeTarget)
    }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}

/**
 * POST — actually send renewal reminders (email + SMS) to every organization
 * whose subscription is expiring within `daysAhead` days or already expired.
 * Body: { daysAhead?: number, organizationIds?: string[], channels?: ('EMAIL'|'SMS')[] }
 * - organizationIds: optional allowlist to target specific orgs only (e.g. a
 *   "remind this one now" button), instead of the full expiring set.
 * - channels: which channels to use; defaults to both.
 */
export async function POST(req: NextRequest) {
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

    const body = await req.json().catch(() => ({}));
    const daysAhead = Number(body.daysAhead) || 7;
    const organizationIds: string[] | undefined = Array.isArray(body.organizationIds) ? body.organizationIds : undefined;
    const channels: string[] = Array.isArray(body.channels) && body.channels.length > 0 ? body.channels : ['EMAIL', 'SMS'];
    const renewalLink: string | undefined = body.renewalLink;

    let targets = await SubscriptionService.getRenewalReminderTargets(daysAhead);
    if (organizationIds && organizationIds.length > 0) {
      const allowlist = new Set(organizationIds.map(String));
      targets = targets.filter(t => allowlist.has(t.organization.id.toString()));
    }

    const results = await Promise.all(targets.map(async (t) => {
      const { organization: org, subscription: sub, daysUntilExpiry } = t;
      let emailSent = false;
      let smsSent = false;

      if (channels.includes('EMAIL') && org.email) {
        emailSent = await EmailService.sendSubscriptionReminder(
          org.email,
          org.name,
          sub.plan_name,
          sub.end_date,
          daysUntilExpiry,
          renewalLink
        ).catch(() => false);
      }

      if (channels.includes('SMS') && org.phone) {
        const message = daysUntilExpiry < 0
          ? `MediCare ONE: Your ${sub.plan_name} subscription expired on ${sub.end_date.toLocaleDateString('en-GB')}. Please renew to restore full access.`
          : `MediCare ONE: Your ${sub.plan_name} subscription expires in ${daysUntilExpiry} day(s) on ${sub.end_date.toLocaleDateString('en-GB')}. Please renew soon.`;
        const smsResult = await smsSend({ phone: org.phone, message }).catch(() => ({ success: false }));
        smsSent = !!smsResult?.success;
      }

      return {
        organizationId: org.id.toString(),
        organizationName: org.name,
        daysUntilExpiry,
        emailSent,
        smsSent,
      };
    }));

    return NextResponse.json({
      message: `Reminders processed for ${results.length} organization(s)`,
      sentCount: results.filter(r => r.emailSent || r.smsSent).length,
      results
    }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
