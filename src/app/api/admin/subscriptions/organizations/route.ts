import { NextRequest, NextResponse } from 'next/server'
import { verifyBearerToken, isRoleId } from '@/lib/auth-utils'
import { prisma } from '@/lib/prisma'
import { friendlyMessage } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/subscriptions/organizations
 * Super Admin only — returns every organization with its subscription status,
 * plan, dates, remaining days, and latest payment info.
 */
export async function GET(req: NextRequest) {
  try {
    let auth
    try {
      auth = verifyBearerToken(req.headers)
    } catch {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    if (!isRoleId(auth.role_id, 9)) {
      return NextResponse.json({ success: false, error: 'Forbidden: Super Admin only' }, { status: 403 })
    }

    const organizations = await prisma.organization.findMany({
      where: { is_deleted: false },
      include: {
        Subscription: {
          include: {
            subscription_plan: true,
            SubscriptionPayment: {
              orderBy: { date: 'desc' },
              take: 1,
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    })

    const now = new Date()

    const results = organizations.map((org) => {
      const sub = org.Subscription
      const latestPayment = sub?.SubscriptionPayment?.[0]

      const endDate = sub?.end_date
      const remainingDays = endDate
        ? Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
        : 0
      const isActive = sub?.status === 'ACTIVE' && endDate ? endDate > now : false

      return {
        organizationId: org.id.toString(),
        organizationName: org.name,
        plan: sub?.plan_name || sub?.subscription_plan?.name || 'None',
        status: sub?.status || 'INACTIVE',
        startDate: sub?.start_date?.toISOString() || null,
        endDate: sub?.end_date?.toISOString() || null,
        remainingDays,
        isActive,
        paymentStatus: latestPayment?.status || null,
        paymentMethod: latestPayment?.payment_method || null,
      }
    })

    return NextResponse.json({ success: true, data: results }, { status: 200 })
  } catch (error: any) {
    console.error('GET /api/admin/subscriptions/organizations error:', error)
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 })
  }
}
