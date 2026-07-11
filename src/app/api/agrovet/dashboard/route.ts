// @ts-nocheck
/**
 * GET /api/agrovet/dashboard
 * Role-aware dashboard for the agrovet tenant. The payload is shaped for the
 * caller's role (Administrator / Accountant / Cashier-Agro / Cashier-Vet).
 * Super Admin is redirected to the platform dashboard.
 *
 * Auth: bearer token. Scope: organization_id + branch from context.
 * No subscription "remaining/expiry countdown" is included here by design —
 * subscription details live under Organization/Subscription management.
 *
 * Query: ?branchId=  (optional, Administrator/Accountant may scope to a branch)
 * Response: { success:true, data:{ role, scope, cards, ... } }
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveContext, toErrorResponse } from '@/lib/agrovet/context'
import { AgrovetDashboardService } from '@/services/agrovet-dashboard.service'
import { DashboardService } from '@/services/dashboard.service'
import { PermissionService } from '@/services/permission.service'
import { verifyBearerToken } from '@/lib/auth-utils'

export async function GET(req: NextRequest) {
  try {
    // Super Admin gets the global platform dashboard and does NOT need an
    // organization context, so resolve them from the token before the stricter
    // org-scoped context resolution (which would otherwise 400 without an org).
    let decoded
    try {
      decoded = verifyBearerToken(req.headers)
    } catch {
      return NextResponse.json({ success: false, error: 'Unauthorized: valid bearer token required' }, { status: 401 })
    }
    if (PermissionService.isSuperAdmin(decoded.role_id)) {
      // Platform dashboard: subscription COUNTS only (active/pending), no per-org
      // remaining/expiry countdown. Per-org subscription lives in Org Management.
      const data = await DashboardService.getSuperAdminDashboard()
      return NextResponse.json({ success: true, data }, { status: 200 })
    }

    const ctx = await resolveContext(req)
    const url = new URL(req.url)
    const branchId = url.searchParams.get('branchId')
      ? BigInt(url.searchParams.get('branchId')!)
      : ctx.branchId

    const data = await AgrovetDashboardService.forRole(ctx.organizationId, ctx.userId, ctx.roleId, branchId)
    return NextResponse.json({ success: true, data }, { status: 200 })
  } catch (error) {
    const { body, status } = toErrorResponse(error)
    return NextResponse.json({ success: false, ...body }, { status })
  }
}
