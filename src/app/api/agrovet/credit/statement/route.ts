// @ts-nocheck
/**
 * GET /api/agrovet/credit/statement?customer_id=<id>
 * Customer credit statement: running ledger of credit charges and payments,
 * plus limit / balance / available credit.
 * RBAC: VIEW:CUSTOMERS. Feature gate: "credit_management". Scope: organization_id.
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveContext, requirePermission, requireFeature, toErrorResponse } from '@/lib/agrovet/context'
import { AgrovetCreditService } from '@/services/agrovet-credit.service'

export async function GET(req: NextRequest) {
  try {
    const ctx = await resolveContext(req)
    await requirePermission(ctx, 'VIEW', 'CUSTOMERS')
    await requireFeature(ctx, 'credit_management')

    const url = new URL(req.url)
    const customerId = url.searchParams.get('customer_id')
    if (!customerId) return NextResponse.json({ success: false, error: 'customer_id is required' }, { status: 400 })

    const data = await AgrovetCreditService.statement(ctx.organizationId, BigInt(customerId))
    return NextResponse.json({ success: true, data }, { status: 200 })
  } catch (error) {
    const { body, status } = toErrorResponse(error)
    return NextResponse.json({ success: false, ...body }, { status })
  }
}
