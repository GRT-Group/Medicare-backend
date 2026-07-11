// @ts-nocheck
/**
 * GET /api/agrovet/accounting/{report}?from=YYYY-MM-DD&to=YYYY-MM-DD&branchId=
 *   report ∈ cashbook | pnl | vat | channels
 *     cashbook -> daily cash book ledger with running balance
 *     pnl      -> profit & loss for the period
 *     vat      -> output VAT report
 *     channels -> separate bank + MoMo transaction logs
 *
 * RBAC: VIEW:FINANCIAL_REPORTS (cashbook also accepts VIEW:CASHBOOK).
 * Feature gate: "accounting". Scope: organization_id (+ optional branch).
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveContext, requirePermission, requireFeature, toErrorResponse, ApiError } from '@/lib/agrovet/context'
import { AgrovetAccountingService } from '@/services/agrovet-accounting.service'
import { PermissionService } from '@/services/permission.service'

function parseRange(url: URL) {
  const now = new Date()
  const to = url.searchParams.get('to') ? new Date(url.searchParams.get('to')!) : now
  const from = url.searchParams.get('from')
    ? new Date(url.searchParams.get('from')!)
    : new Date(now.getFullYear(), now.getMonth(), 1)
  to.setHours(23, 59, 59, 999)
  return { from, to }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ report: string }> }) {
  try {
    const ctx = await resolveContext(req)
    await requireFeature(ctx, 'accounting')

    const { report } = await params
    const url = new URL(req.url)
    const { from, to } = parseRange(url)
    const branchId = url.searchParams.get('branchId') ? BigInt(url.searchParams.get('branchId')!) : undefined

    // Permission: cashbook can be viewed by cashbook viewers; the rest need FIN reports.
    if (report === 'cashbook') {
      const okCash = await PermissionService.hasPermission(ctx.userId, 'VIEW', 'CASHBOOK', ctx.organizationId)
      const okFin = await PermissionService.hasPermission(ctx.userId, 'VIEW', 'FINANCIAL_REPORTS', ctx.organizationId)
      if (!okCash && !okFin && !ctx.isSuperAdmin) throw new ApiError(403, 'Forbidden: missing CASHBOOK/FINANCIAL_REPORTS permission')
    } else {
      await requirePermission(ctx, 'VIEW', 'FINANCIAL_REPORTS')
    }

    let data
    switch (report) {
      case 'cashbook': data = await AgrovetAccountingService.cashbookLedger(ctx.organizationId, from, to, branchId); break
      case 'pnl': data = await AgrovetAccountingService.profitAndLoss(ctx.organizationId, from, to, branchId); break
      case 'vat': data = await AgrovetAccountingService.vatReport(ctx.organizationId, from, to, branchId); break
      case 'channels': data = await AgrovetAccountingService.channelLog(ctx.organizationId, from, to); break
      default:
        return NextResponse.json({ success: false, error: 'Unknown report. Use cashbook|pnl|vat|channels' }, { status: 404 })
    }
    return NextResponse.json({ success: true, report, data }, { status: 200 })
  } catch (error) {
    const { body, status } = toErrorResponse(error)
    return NextResponse.json({ success: false, ...body }, { status })
  }
}
