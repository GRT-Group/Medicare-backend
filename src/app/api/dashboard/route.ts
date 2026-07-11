import { NextRequest, NextResponse } from 'next/server'
import { DashboardService } from '@/services/dashboard.service'
import { PermissionService } from '@/services/permission.service'
import { verifyBearerToken } from '@/lib/auth-utils'

export async function GET(req: NextRequest) {
  try {
    const decoded = verifyBearerToken(req.headers)
    const roleId = Number(decoded.role_id)
    const requestedOrganizationId = req.nextUrl.searchParams.get('organizationId')

    if (PermissionService.isSuperAdmin(roleId)) {
      if (requestedOrganizationId) {
        let organizationId: bigint
        try {
          organizationId = BigInt(requestedOrganizationId)
        } catch {
          return NextResponse.json(
            { success: false, error: 'Invalid organizationId query parameter' },
            { status: 400 }
          )
        }
        const dashboard = await DashboardService.getOrganizationDashboard(organizationId, roleId)
        return NextResponse.json({ success: true, data: dashboard }, { status: 200 })
      }

      const dashboard = await DashboardService.getSuperAdminDashboard()
      return NextResponse.json({ success: true, data: dashboard }, { status: 200 })
    }

    if (!decoded.organization_id) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Organization context is required' },
        { status: 403 }
      )
    }

    const dashboard = await DashboardService.getOrganizationDashboard(
      BigInt(decoded.organization_id),
      roleId
    )

    return NextResponse.json({ success: true, data: dashboard }, { status: 200 })
  } catch (error: any) {
    const message = typeof error?.message === 'string' ? error.message : 'Unauthorized'
    const status = /Unauthorized/i.test(message) ? 401 : 500
    return NextResponse.json({ success: false, error: message }, { status })
  }
}
