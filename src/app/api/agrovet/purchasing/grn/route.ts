// @ts-nocheck
/**
 * POST /api/agrovet/purchasing/grn
 * Confirm a Goods-Received Note against a purchase order. Creates batches with
 * captured expiry + real selling price, updates stock, and increases the
 * supplier's outstanding payable.
 *
 *   body: {
 *     purchase_order_id, branch_id?,
 *     lines: [{ po_item_id, received_quantity, batch_number?, expiry_date?, selling_price }]
 *   }
 * RBAC: MANAGE:INVENTORY. Feature gate: "inventory".
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveContext, requirePermission, requireFeature, toErrorResponse } from '@/lib/agrovet/context'
import { AgrovetPurchaseService } from '@/services/agrovet-purchase.service'

export async function POST(req: NextRequest) {
  try {
    const ctx = await resolveContext(req)
    await requirePermission(ctx, 'MANAGE', 'INVENTORY')
    await requireFeature(ctx, 'inventory')

    const body = await req.json().catch(() => ({}))
    if (!body.purchase_order_id) return NextResponse.json({ success: false, error: 'purchase_order_id is required' }, { status: 400 })
    if (!body.lines?.length) return NextResponse.json({ success: false, error: 'lines are required' }, { status: 400 })

    const branchId = body.branch_id ? BigInt(body.branch_id) : ctx.branchId
    if (!branchId) return NextResponse.json({ success: false, error: 'branch_id is required' }, { status: 400 })

    const result = await AgrovetPurchaseService.receiveGRN(
      ctx.organizationId,
      {
        purchase_order_id: BigInt(body.purchase_order_id),
        branch_id: branchId,
        lines: body.lines.map((l: any) => ({
          po_item_id: BigInt(l.po_item_id),
          received_quantity: Number(l.received_quantity),
          batch_number: l.batch_number,
          expiry_date: l.expiry_date ? new Date(l.expiry_date) : undefined,
          selling_price: Number(l.selling_price),
        })),
      },
      ctx.userId,
    )
    return NextResponse.json({ success: true, message: 'GRN received', data: result }, { status: 201 })
  } catch (error) {
    const { body, status } = toErrorResponse(error)
    return NextResponse.json({ success: false, ...body }, { status })
  }
}
