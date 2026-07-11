// @ts-nocheck
/**
 * POST /api/agrovet/shifts/close
 * Close a shift and reconcile the drawer against shift-linked cash sales.
 *   body: { shift_id: number|string, closing_balance: number }
 * Returns the closed session with expected_balance, cash_sales and difference;
 * status becomes DISCREPANCY if the drawer doesn't reconcile.
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveContext, requirePermission, toErrorResponse } from '@/lib/agrovet/context'
import { ShiftService } from '@/services/shift.service'

export async function POST(req: NextRequest) {
  try {
    const ctx = await resolveContext(req)
    await requirePermission(ctx, 'CREATE', 'SALES')

    const body = await req.json().catch(() => ({}))
    if (!body.shift_id) {
      return NextResponse.json({ success: false, error: 'shift_id is required' }, { status: 400 })
    }
    if (body.closing_balance === undefined || body.closing_balance === null) {
      return NextResponse.json({ success: false, error: 'closing_balance is required' }, { status: 400 })
    }

    const closed = await ShiftService.close(
      ctx.organizationId,
      BigInt(body.shift_id),
      { closing_balance: Number(body.closing_balance) },
      ctx.userId,
    )
    return NextResponse.json({ success: true, message: 'Shift closed', data: closed }, { status: 200 })
  } catch (error) {
    const { body, status } = toErrorResponse(error)
    return NextResponse.json({ success: false, ...body }, { status })
  }
}
