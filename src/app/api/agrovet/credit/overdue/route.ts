// @ts-nocheck
/**
 * GET /api/agrovet/credit/overdue
 * Lists overdue credit balances (past due_date with a remaining balance) and
 * (re)emits Administrator-routed overdue alerts. RBAC: VIEW:CUSTOMERS.
 * Feature gate: "credit_management".
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveContext, requirePermission, requireFeature, toErrorResponse } from '@/lib/agrovet/context'
import { AgrovetCreditService } from '@/services/agrovet-credit.service'

export async function GET(req: NextRequest) {
  try {
    const ctx = await resolveContext(req)
    await requirePermission(ctx, 'VIEW', 'CUSTOMERS')
    await requireFeature(ctx, 'credit_management')

    const data = await AgrovetCreditService.overdue(ctx.organizationId)
    return NextResponse.json({ success: true, data }, { status: 200 })
  } catch (error) {
    const { body, status } = toErrorResponse(error)
    return NextResponse.json({ success: false, ...body }, { status })
  }
}
