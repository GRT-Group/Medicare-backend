// @ts-nocheck
/**
 * GET /api/agrovet/shifts/current
 * Returns the current cashier's open shift with live shift-linked sales totals,
 * or { data: null } if none is open. Used by the POS to know which shift a sale
 * belongs to.
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveContext, requirePermission, toErrorResponse } from '@/lib/agrovet/context'
import { ShiftService } from '@/services/shift.service'

export async function GET(req: NextRequest) {
  try {
    const ctx = await resolveContext(req)
    await requirePermission(ctx, 'CREATE', 'SALES')

    const url = new URL(req.url)
    const userId = url.searchParams.get('userId') ? BigInt(url.searchParams.get('userId')!) : ctx.userId

    const shift = await ShiftService.getOpenShift(ctx.organizationId, userId)
    if (!shift) return NextResponse.json({ success: true, data: null }, { status: 200 })

    const totals = await ShiftService.getShiftTotals(ctx.organizationId, shift.id)
    return NextResponse.json({ success: true, data: { ...shift, totals } }, { status: 200 })
  } catch (error) {
    const { body, status } = toErrorResponse(error)
    return NextResponse.json({ success: false, ...body }, { status })
  }
}
