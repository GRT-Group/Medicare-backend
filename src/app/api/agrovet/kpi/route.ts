// @ts-nocheck
/**
 * GET /api/agrovet/kpi?from=&to=&branchId=&view=
 *   view (optional): dashboard (default) | sales-by-cashier | gross-profit |
 *                     top-selling | turnover | cashflow | activity
 *
 * KPI dashboard: daily sales by cashier, gross profit per product, top-selling
 * products, inventory turnover rate, cashflow series, staff activity.
 * RBAC: VIEW:COMPANY_DASHBOARD. Feature gate: "advanced_analytics" for the full
 * dashboard; individual basic views only require the dashboard permission.
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveContext, requirePermission, requireFeature, toErrorResponse } from '@/lib/agrovet/context'
import { AgrovetKpiService } from '@/services/agrovet-kpi.service'

function range(url: URL) {
  const now = new Date()
  const to = url.searchParams.get('to') ? new Date(url.searchParams.get('to')!) : now
  const from = url.searchParams.get('from') ? new Date(url.searchParams.get('from')!) : new Date(now.getTime() - 30 * 86400000)
  to.setHours(23, 59, 59, 999)
  return { from, to }
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await resolveContext(req)
    await requirePermission(ctx, 'VIEW', 'COMPANY_DASHBOARD')

    const url = new URL(req.url)
    const { from, to } = range(url)
    const branchId = url.searchParams.get('branchId') ? BigInt(url.searchParams.get('branchId')!) : undefined
    const view = url.searchParams.get('view') || 'dashboard'
    const org = ctx.organizationId

    let data
    switch (view) {
      case 'sales-by-cashier': data = await AgrovetKpiService.dailySalesByCashier(org, from, to, branchId); break
      case 'gross-profit': data = await AgrovetKpiService.grossProfitPerProduct(org, from, to, branchId); break
      case 'top-selling': data = await AgrovetKpiService.topSelling(org, from, to); break
      case 'turnover': data = await AgrovetKpiService.inventoryTurnover(org, from, to); break
      case 'cashflow': data = await AgrovetKpiService.cashflowSeries(org, from, to); break
      case 'activity': data = await AgrovetKpiService.staffActivity(org); break
      case 'dashboard':
      default:
        // The consolidated analytics dashboard is a premium feature.
        await requireFeature(ctx, 'advanced_analytics')
        data = await AgrovetKpiService.dashboard(org, from, to, branchId)
    }
    return NextResponse.json({ success: true, view, data }, { status: 200 })
  } catch (error) {
    const { body, status } = toErrorResponse(error)
    return NextResponse.json({ success: false, ...body }, { status })
  }
}
