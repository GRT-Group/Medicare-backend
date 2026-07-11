// @ts-nocheck
/**
 * POST /api/agrovet/discounts/review
 * Administrator/Accountant approves or rejects a pending discount request.
 *   body: { request_id, decision: "APPROVED"|"REJECTED", comment? }
 * RBAC: requires APPROVE:DISCOUNTS.
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveContext, requirePermission, toErrorResponse } from '@/lib/agrovet/context'
import { DiscountService } from '@/services/discount.service'

export async function POST(req: NextRequest) {
  try {
    const ctx = await resolveContext(req)
    await requirePermission(ctx, 'APPROVE', 'DISCOUNTS')

    const body = await req.json().catch(() => ({}))
    if (!body.request_id || !body.decision) {
      return NextResponse.json({ success: false, error: 'request_id and decision are required' }, { status: 400 })
    }
    if (!['APPROVED', 'REJECTED'].includes(body.decision)) {
      return NextResponse.json({ success: false, error: 'decision must be APPROVED or REJECTED' }, { status: 400 })
    }

    const row = await DiscountService.review(ctx.organizationId, {
      request_id: BigInt(body.request_id),
      reviewer_id: ctx.userId,
      decision: body.decision,
      comment: body.comment,
    })
    return NextResponse.json({ success: true, message: `Discount ${body.decision.toLowerCase()}`, data: row }, { status: 200 })
  } catch (error) {
    const { body, status } = toErrorResponse(error)
    return NextResponse.json({ success: false, ...body }, { status })
  }
}
