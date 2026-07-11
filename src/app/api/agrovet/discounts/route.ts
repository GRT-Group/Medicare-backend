// @ts-nocheck
/**
 * Discount request workflow.
 *
 *   GET  /api/agrovet/discounts           -> list requests (?status=PENDING&branchId=)
 *   POST /api/agrovet/discounts           -> cashier raises a discount request
 *          body: { amount, sale_total, customer_id?, reason? }
 *
 * RBAC: listing needs REQUEST or APPROVE:DISCOUNTS; creating needs REQUEST:DISCOUNTS.
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveContext, requirePermission, toErrorResponse, ApiError } from '@/lib/agrovet/context'
import { DiscountService } from '@/services/discount.service'
import { PermissionService } from '@/services/permission.service'

export async function GET(req: NextRequest) {
  try {
    const ctx = await resolveContext(req)
    // Either a requester or an approver may view the queue.
    const canApprove = await PermissionService.hasPermission(ctx.userId, 'APPROVE', 'DISCOUNTS', ctx.organizationId)
    const canRequest = await PermissionService.hasPermission(ctx.userId, 'REQUEST', 'DISCOUNTS', ctx.organizationId)
    if (!canApprove && !canRequest && !ctx.isSuperAdmin) {
      throw new ApiError(403, 'Forbidden: missing permission for DISCOUNTS')
    }

    const url = new URL(req.url)
    const rows = await DiscountService.list(ctx.organizationId, {
      status: url.searchParams.get('status') || undefined,
      branchId: url.searchParams.get('branchId') ? BigInt(url.searchParams.get('branchId')!) : undefined,
      requesterId: url.searchParams.get('requesterId') ? BigInt(url.searchParams.get('requesterId')!) : undefined,
    })
    return NextResponse.json({ success: true, data: rows }, { status: 200 })
  } catch (error) {
    const { body, status } = toErrorResponse(error)
    return NextResponse.json({ success: false, ...body }, { status })
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await resolveContext(req)
    await requirePermission(ctx, 'REQUEST', 'DISCOUNTS')

    const body = await req.json().catch(() => ({}))
    if (body.amount === undefined || body.sale_total === undefined) {
      return NextResponse.json({ success: false, error: 'amount and sale_total are required' }, { status: 400 })
    }

    const row = await DiscountService.request(ctx.organizationId, {
      requested_by_id: ctx.userId,
      branch_id: ctx.branchId,
      customer_id: body.customer_id ? BigInt(body.customer_id) : null,
      amount: Number(body.amount),
      sale_total: Number(body.sale_total),
      reason: body.reason,
    })
    return NextResponse.json({ success: true, message: 'Discount requested', data: row }, { status: 201 })
  } catch (error) {
    const { body, status } = toErrorResponse(error)
    return NextResponse.json({ success: false, ...body }, { status })
  }
}
