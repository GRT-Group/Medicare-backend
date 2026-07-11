// @ts-nocheck
/**
 * Agrovet cashier shifts.
 *
 *   GET  /api/agrovet/shifts            -> list shifts (org/branch scoped)
 *          query: ?status=OPEN&userId=&branchId=
 *   POST /api/agrovet/shifts            -> open a shift for the current cashier
 *          body: { opening_balance: number, user_id?, branch_id? }
 *
 * Auth: bearer token. RBAC: caller needs CREATE:SALES (cashiers/owners).
 * Scope: organization_id + branch_id from the request context.
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveContext, requirePermission, toErrorResponse } from '@/lib/agrovet/context'
import { ShiftService } from '@/services/shift.service'

export async function GET(req: NextRequest) {
  try {
    const ctx = await resolveContext(req)
    await requirePermission(ctx, 'VIEW', 'BRANCH_DASHBOARD')

    const url = new URL(req.url)
    const shifts = await ShiftService.list(ctx.organizationId, {
      branchId: url.searchParams.get('branchId')
        ? BigInt(url.searchParams.get('branchId')!)
        : ctx.branchId ?? undefined,
      userId: url.searchParams.get('userId') ? BigInt(url.searchParams.get('userId')!) : undefined,
      status: url.searchParams.get('status') || undefined,
    })
    return NextResponse.json({ success: true, data: shifts }, { status: 200 })
  } catch (error) {
    const { body, status } = toErrorResponse(error)
    return NextResponse.json({ success: false, ...body }, { status })
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await resolveContext(req)
    await requirePermission(ctx, 'CREATE', 'SALES')

    const body = await req.json().catch(() => ({}))
    if (body.opening_balance === undefined || body.opening_balance === null) {
      return NextResponse.json({ success: false, error: 'opening_balance is required' }, { status: 400 })
    }
    const openingBalance = Number(body.opening_balance)
    if (Number.isNaN(openingBalance) || openingBalance < 0) {
      return NextResponse.json({ success: false, error: 'opening_balance must be a non-negative number' }, { status: 400 })
    }

    // A cashier opens their own shift; an Administrator may open one for another user.
    const userId = body.user_id ? BigInt(body.user_id) : ctx.userId
    const branchId = body.branch_id ? BigInt(body.branch_id) : ctx.branchId

    const shift = await ShiftService.open(ctx.organizationId, {
      user_id: userId,
      branch_id: branchId,
      opening_balance: openingBalance,
    })
    return NextResponse.json({ success: true, message: 'Shift opened', data: shift }, { status: 201 })
  } catch (error) {
    const { body, status } = toErrorResponse(error)
    return NextResponse.json({ success: false, ...body }, { status })
  }
}
