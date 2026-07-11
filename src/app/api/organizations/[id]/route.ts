import { NextRequest, NextResponse } from 'next/server'
import { friendlyMessage } from '@/lib/api-error'
import { OrganizationService } from '@/services/organization.service'
import { verifyBearerToken } from '@/lib/auth-utils'

function serializeOrganization(org: any) {
  return {
    ...org,
    id: org.id.toString(),
    organization_type_id: org.organization_type_id?.toString(),
    type: org.type ? { ...org.type, id: org.type.id.toString() } : null,
    subscription: org.subscription
      ? {
          ...org.subscription,
          id: org.subscription.id.toString(),
          plan: org.subscription.plan
            ? { ...org.subscription.plan, id: org.subscription.plan.id?.toString() }
            : org.subscription.plan,
        }
      : null,
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    try {
      verifyBearerToken(req.headers)
    } catch {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ success: false, error: 'Invalid organization id' }, { status: 400 })
    }

    const organization = await OrganizationService.getOrganizationById(id)
    if (!organization) {
      return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: serializeOrganization(organization) }, { status: 200 })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 })
  }
}
