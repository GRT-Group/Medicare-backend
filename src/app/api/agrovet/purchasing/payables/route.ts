// @ts-nocheck
/**
 * GET  /api/agrovet/purchasing/payables   -> per-supplier outstanding payables + total
 * POST /api/agrovet/purchasing/payables   -> record a payment to a supplier
 *        body: { supplier_id, amount, payment_method?, reference?, note? }
 *
 * RBAC: viewing needs VIEW:SUPPLIERS; paying needs MANAGE:SUPPLIERS.
 * Feature gate: "accounting".
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveContext, requirePermission, requireFeature, toErrorResponse } from '@/lib/agrovet/context'
import { AgrovetPurchaseService } from '@/services/agrovet-purchase.service'

export async function GET(req: NextRequest) {
  try {
    const ctx = await resolveContext(req)
    await requirePermission(ctx, 'VIEW', 'SUPPLIERS')
    await requireFeature(ctx, 'accounting')

    const data = await AgrovetPurchaseService.getPayables(ctx.organizationId)
    return NextResponse.json({ success: true, data }, { status: 200 })
  } catch (error) {
    const { body, status } = toErrorResponse(error)
    return NextResponse.json({ success: false, ...body }, { status })
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await resolveContext(req)
    await requirePermission(ctx, 'MANAGE', 'SUPPLIERS')
    await requireFeature(ctx, 'accounting')

    const body = await req.json().catch(() => ({}))
    if (!body.supplier_id || body.amount === undefined) {
      return NextResponse.json({ success: false, error: 'supplier_id and amount are required' }, { status: 400 })
    }

    const data = await AgrovetPurchaseService.paySupplier(
      ctx.organizationId,
      {
        supplier_id: BigInt(body.supplier_id),
        amount: Number(body.amount),
        payment_method: body.payment_method,
        reference: body.reference,
        note: body.note,
      },
      ctx.userId,
    )
    return NextResponse.json({ success: true, message: 'Supplier payment recorded', data }, { status: 201 })
  } catch (error) {
    const { body, status } = toErrorResponse(error)
    return NextResponse.json({ success: false, ...body }, { status })
  }
}
