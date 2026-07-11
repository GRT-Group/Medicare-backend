// @ts-nocheck
/**
 * POST /api/agrovet/alerts/scan
 * Recompute low-stock, expiry (30 & 7 day) and overdue-credit alerts for the
 * org and emit any new ones (idempotent). Intended to be called on a schedule
 * or on demand. RBAC: VIEW:BRANCH_DASHBOARD. Returns counts emitted per type.
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveContext, requirePermission, toErrorResponse } from '@/lib/agrovet/context'
import { AlertService } from '@/services/alert.service'

export async function POST(req: NextRequest) {
  try {
    const ctx = await resolveContext(req)
    await requirePermission(ctx, 'VIEW', 'BRANCH_DASHBOARD')

    const result = await AlertService.runScan(ctx.organizationId)
    return NextResponse.json({ success: true, message: 'Alert scan complete', data: result }, { status: 200 })
  } catch (error) {
    const { body, status } = toErrorResponse(error)
    return NextResponse.json({ success: false, ...body }, { status })
  }
}
