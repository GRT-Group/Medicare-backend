/**
 * DiscountService — cashier-requests-→-Owner/Accountant-approves discount
 * workflow. A cashier cannot self-apply a discount; they raise a request, an
 * authorised approver reviews it, and only an APPROVED, unconsumed request can
 * be attached to a sale (enforced server-side in SaleService).
 */
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { AuditService } from '@/services/audit.service'
import { AlertService } from '@/services/alert.service'

// A discount at/above this fraction of the sale total is flagged as "unusual".
const UNUSUAL_DISCOUNT_FRACTION = 0.2

export class DiscountService {
  static async request(
    organizationId: bigint,
    data: {
      requested_by_id: bigint
      branch_id?: bigint | null
      customer_id?: bigint | null
      amount: number
      sale_total: number
      reason?: string
    },
  ) {
    if (data.amount <= 0) throw new Error('Discount amount must be positive')
    if (data.sale_total <= 0) throw new Error('Sale total must be positive')
    if (data.amount > data.sale_total) throw new Error('Discount cannot exceed the sale total')

    const reqRow = await prisma.discountRequest.create({
      data: {
        organization_id: organizationId,
        branch_id: data.branch_id ?? undefined,
        requested_by_id: data.requested_by_id,
        customer_id: data.customer_id ?? undefined,
        amount: data.amount,
        sale_total: data.sale_total,
        reason: data.reason,
        status: 'PENDING',
      },
    })

    await AuditService.log({
      organization_id: organizationId,
      branch_id: data.branch_id ?? null,
      user_id: data.requested_by_id,
      module: 'POS',
      action: 'REQUEST_DISCOUNT',
      table_affected: 'DiscountRequest',
      record_id: reqRow.id.toString(),
      after: { amount: data.amount, sale_total: data.sale_total, reason: data.reason },
    })

    // Unusual-discount alert, routed to the Administrator for monitoring.
    if (data.amount >= data.sale_total * UNUSUAL_DISCOUNT_FRACTION) {
      await AlertService.emit({
        organization_id: organizationId,
        branch_id: data.branch_id ?? null,
        type: 'UNUSUAL_DISCOUNT',
        severity: 'WARNING',
        title: 'Unusual discount requested',
        message: `A discount of ${data.amount} (${Math.round((data.amount / data.sale_total) * 100)}% of ${data.sale_total}) was requested.`,
        target_role: 'Administrator',
        data: { discount_request_id: reqRow.id.toString(), amount: data.amount, sale_total: data.sale_total },
      })
    }

    return reqRow
  }

  static async review(
    organizationId: bigint,
    data: { request_id: bigint; reviewer_id: bigint; decision: 'APPROVED' | 'REJECTED'; comment?: string },
  ) {
    return prisma.$transaction(async (tx) => {
      const reqRow = await tx.discountRequest.findFirst({
        where: { id: data.request_id, organization_id: organizationId },
      })
      if (!reqRow) throw new Error('Discount request not found')
      if (reqRow.status !== 'PENDING') throw new Error(`Discount request already ${reqRow.status}`)

      const updated = await tx.discountRequest.update({
        where: { id: data.request_id },
        data: {
          status: data.decision,
          reviewed_by_id: data.reviewer_id,
          review_comment: data.comment,
          reviewed_at: new Date(),
        },
      })

      await AuditService.log(
        {
          organization_id: organizationId,
          branch_id: reqRow.branch_id,
          user_id: data.reviewer_id,
          module: 'POS',
          action: data.decision === 'APPROVED' ? 'APPROVE_DISCOUNT' : 'REJECT_DISCOUNT',
          table_affected: 'DiscountRequest',
          record_id: data.request_id.toString(),
          before: { status: 'PENDING' },
          after: { status: data.decision, comment: data.comment },
        },
        tx,
      )

      return updated
    }, { timeout: 20000, maxWait: 10000 })
  }

  static async list(
    organizationId: bigint,
    opts: { status?: string; branchId?: bigint; requesterId?: bigint } = {},
  ) {
    const where: Prisma.DiscountRequestWhereInput = {
      organization_id: organizationId,
      ...(opts.status && { status: opts.status as any }),
      ...(opts.branchId && { branch_id: opts.branchId }),
      ...(opts.requesterId && { requested_by_id: opts.requesterId }),
    }
    return prisma.discountRequest.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        RequestedBy: { select: { id: true, first_name: true, last_name: true } },
        ReviewedBy: { select: { id: true, first_name: true, last_name: true } },
      },
    })
  }

  /**
   * Validate that a discount request is usable for a sale: exists, belongs to
   * the org, is APPROVED, and has not already been consumed by another sale.
   * Returns the approved amount. Called from SaleService inside a transaction.
   */
  static async consumeForSale(
    tx: Prisma.TransactionClient,
    organizationId: bigint,
    requestId: bigint,
    saleId: bigint,
  ): Promise<number> {
    const reqRow = await tx.discountRequest.findFirst({
      where: { id: requestId, organization_id: organizationId },
    })
    if (!reqRow) throw new Error('Discount request not found')
    if (reqRow.status !== 'APPROVED') throw new Error('Discount request is not approved')
    if (reqRow.applied_sale_id) throw new Error('Discount request has already been used')

    await tx.discountRequest.update({
      where: { id: requestId },
      data: { applied_sale_id: saleId },
    })
    return Number(reqRow.amount)
  }
}
