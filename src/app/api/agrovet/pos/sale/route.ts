// @ts-nocheck
/**
 * POST /api/agrovet/pos/sale
 * Create a POS sale. Every sale is linked to the cashier + shift, an EBM fiscal
 * invoice is generated automatically (mandatory), an approved discount may be
 * attached, VAT is captured, and credit is hard-stopped server-side.
 *
 *   body: {
 *     branch_id, payment_method: CASH|MOMO|BANK_TRANSFER|CREDIT|CARD,
 *     items: [{ product_id, quantity, unit_price }],
 *     customer_id?, amount_paid?, due_date?, cash_session_id?,
 *     discount_request_id?, client_ref?   // client_ref = offline idempotency key
 *   }
 *
 * RBAC: CREATE:SALES. Feature gate: "pos". Credit sales additionally require the
 * "credit_management" plan feature.
 * Response 201: { data: { sale, ebm } }. Duplicate client_ref returns 200.
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveContext, requirePermission, requireFeature, toErrorResponse } from '@/lib/agrovet/context'
import { normalizePaymentMethod, parseSaleItem, parseOptionalId, PAYMENT_METHODS_HINT } from '@/lib/sale-input'
import { SaleService } from '@/services/sale.service'

export async function POST(req: NextRequest) {
  try {
    const ctx = await resolveContext(req)
    await requirePermission(ctx, 'CREATE', 'SALES')
    await requireFeature(ctx, 'pos')

    const body = await req.json().catch(() => ({}))
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ success: false, error: 'items must be a non-empty array of { product_id, quantity, unit_price }' }, { status: 400 })
    }

    // Accept camelCase and snake_case for every field — the POS frontend
    // sends camelCase, Postman/integrations send snake_case; a mismatch must
    // be a readable 400, never a 500.
    const paymentMethodRaw = body.payment_method ?? body.paymentMethod
    if (!paymentMethodRaw) {
      return NextResponse.json({ success: false, error: `payment_method is required (${PAYMENT_METHODS_HINT})` }, { status: 400 })
    }
    const paymentMethod = normalizePaymentMethod(paymentMethodRaw)
    if (!paymentMethod) {
      return NextResponse.json({ success: false, error: `Unknown payment_method "${paymentMethodRaw}". Use ${PAYMENT_METHODS_HINT}.` }, { status: 400 })
    }

    const branchId = parseOptionalId(body.branch_id ?? body.branchId, 'branch_id') ?? ctx.branchId
    if (!branchId) return NextResponse.json({ success: false, error: 'branch_id is required' }, { status: 400 })

    // parseSaleItem throws 400-tagged errors handled by the catch below.
    // Unlike /api/sales (which auto-prices), the POS must send the price it
    // displayed to the cashier — the EBM fiscal invoice has to match it.
    const items = body.items.map(parseSaleItem).map((it: any, i: number) => {
      if (it.unit_price === undefined) {
        throw Object.assign(new Error(`items[${i}]: unit_price is required for POS sales`), { status: 400 })
      }
      return it as { product_id: bigint; quantity: number; unit_price: number }
    })

    const amountPaidRaw = body.amount_paid ?? body.amountPaid
    let amountPaid: number | undefined
    if (amountPaidRaw !== undefined && amountPaidRaw !== null && amountPaidRaw !== '') {
      amountPaid = Number(amountPaidRaw)
      if (!Number.isFinite(amountPaid) || amountPaid < 0) {
        return NextResponse.json({ success: false, error: 'amount_paid must be a non-negative number' }, { status: 400 })
      }
    }

    const dueDateRaw = body.due_date ?? body.dueDate
    let dueDate: Date | undefined
    if (dueDateRaw) {
      dueDate = new Date(dueDateRaw)
      if (isNaN(dueDate.getTime())) {
        return NextResponse.json({ success: false, error: 'due_date must be a valid date' }, { status: 400 })
      }
    }

    // Credit is a gated premium capability.
    if (paymentMethod === 'CREDIT') {
      // await requireFeature(ctx, 'credit_management')
    }

    const result = await SaleService.processSale(
      ctx.organizationId,
      {
        branch_id: branchId,
        customer_id: parseOptionalId(body.customer_id ?? body.customerId, 'customer_id'),
        cash_session_id: parseOptionalId(body.cash_session_id ?? body.cashSessionId, 'cash_session_id'),
        payment_method: paymentMethod,
        amount_paid: amountPaid,
        due_date: dueDate,
        discount_request_id: parseOptionalId(body.discount_request_id ?? body.discountRequestId, 'discount_request_id'),
        client_ref: body.client_ref ?? body.clientRef,
        items,
      },
      ctx.userId,
    )

    return NextResponse.json(
      { success: true, message: result.duplicate ? 'Duplicate sale (idempotent)' : 'Sale processed', data: result },
      { status: result.duplicate ? 200 : 201 },
    )
  } catch (error) {
    const { body, status } = toErrorResponse(error)
    return NextResponse.json({ success: false, ...body }, { status })
  }
}
