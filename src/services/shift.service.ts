/**
 * ShiftService — per-cashier POS shift open/close with shift-linked sales totals.
 *
 * Builds on the existing CashSession model (reuses it, does not fork it) but
 * links sales to a shift via the new Sale.cash_session_id column, so a shift's
 * totals are derived from the sales actually rung up under it rather than a
 * loose (user + timestamp) heuristic.
 */
import { prisma } from '@/lib/prisma'
import { CashSessionStatus, Prisma } from '@prisma/client'
import { AuditService } from '@/services/audit.service'

export class ShiftService {
  /** The currently-open shift for a cashier, if any (scoped to org). */
  static async getOpenShift(organizationId: bigint, userId: bigint) {
    return prisma.cashSession.findFirst({
      where: { organization_id: organizationId, user_id: userId, status: 'OPEN', is_deleted: false },
    })
  }

  static async open(
    organizationId: bigint,
    data: { user_id: bigint; branch_id?: bigint | null; opening_balance: number },
  ) {
    const existing = await this.getOpenShift(organizationId, data.user_id)
    if (existing) throw new Error('Cashier already has an open shift. Close it before opening a new one.')

    return prisma.$transaction(async (tx) => {
      const shift = await tx.cashSession.create({
        data: {
          organization_id: organizationId,
          user_id: data.user_id,
          branch_id: data.branch_id ?? undefined,
          opening_balance: data.opening_balance,
          status: 'OPEN',
        },
      })
      await AuditService.log(
        {
          organization_id: organizationId,
          branch_id: data.branch_id ?? null,
          user_id: data.user_id,
          module: 'POS',
          action: 'OPEN_SHIFT',
          table_affected: 'CashSession',
          record_id: shift.id.toString(),
          after: { opening_balance: data.opening_balance },
        },
        tx,
      )
      return shift
    })
  }

  /** Aggregate the sales rung up under a shift, broken down by payment method. */
  static async getShiftTotals(organizationId: bigint, shiftId: bigint) {
    const groups = await prisma.sale.groupBy({
      by: ['payment_method'],
      where: {
        organization_id: organizationId,
        cash_session_id: shiftId,
        status: { not: 'CANCELLED' },
        deleted_at: null,
      },
      _sum: { total_amount: true, amount_paid: true },
      _count: { _all: true },
    })

    const byMethod: Record<string, { total: number; paid: number; count: number }> = {}
    let grandTotal = 0
    let cashTotal = 0
    let salesCount = 0
    for (const g of groups) {
      const total = Number(g._sum.total_amount || 0)
      byMethod[g.payment_method] = {
        total,
        paid: Number(g._sum.amount_paid || 0),
        count: g._count._all,
      }
      grandTotal += total
      salesCount += g._count._all
      if (g.payment_method === 'CASH') cashTotal += total
    }
    return { grandTotal, cashTotal, salesCount, byMethod }
  }

  static async close(
    organizationId: bigint,
    shiftId: bigint,
    data: { closing_balance: number },
    actorId: bigint,
  ) {
    return prisma.$transaction(async (tx) => {
      const shift = await tx.cashSession.findFirst({
        where: { id: shiftId, organization_id: organizationId },
      })
      if (!shift) throw new Error('Shift not found')
      if (shift.status !== 'OPEN') throw new Error('Shift is not open.')

      // Shift-linked cash sales expected in the drawer.
      const cashAgg = await tx.sale.aggregate({
        _sum: { total_amount: true },
        where: {
          organization_id: organizationId,
          cash_session_id: shiftId,
          payment_method: 'CASH',
          status: { not: 'CANCELLED' },
          deleted_at: null,
        },
      })
      const cashSales = Number(cashAgg._sum.total_amount || 0)
      const expected = Number(shift.opening_balance) + cashSales
      const difference = data.closing_balance - expected
      const status: CashSessionStatus = Math.abs(difference) < 0.01 ? 'CLOSED' : 'DISCREPANCY'

      const updated = await tx.cashSession.update({
        where: { id: shiftId },
        data: {
          closing_balance: data.closing_balance,
          expected_balance: expected,
          difference,
          status,
          closed_at: new Date(),
        },
      })

      await AuditService.log(
        {
          organization_id: organizationId,
          branch_id: shift.branch_id,
          user_id: actorId,
          module: 'POS',
          action: 'CLOSE_SHIFT',
          table_affected: 'CashSession',
          record_id: shiftId.toString(),
          after: { closing_balance: data.closing_balance, expected, difference, status, cash_sales: cashSales },
        },
        tx,
      )

      return { ...updated, cash_sales: cashSales, expected_balance: expected, difference }
    })
  }

  static async list(organizationId: bigint, opts: { branchId?: bigint; userId?: bigint; status?: string } = {}) {
    const where: Prisma.CashSessionWhereInput = {
      organization_id: organizationId,
      is_deleted: false,
      ...(opts.branchId && { branch_id: opts.branchId }),
      ...(opts.userId && { user_id: opts.userId }),
      ...(opts.status && { status: opts.status as CashSessionStatus }),
    }
    const sessions = await prisma.cashSession.findMany({
      where,
      orderBy: { opened_at: 'desc' },
      include: {
        User_CashSession_user_idToUser: { select: { first_name: true, last_name: true, email: true } },
      },
    })
    return sessions.map(({ User_CashSession_user_idToUser, ...s }) => ({ ...s, user: User_CashSession_user_idToUser }))
  }
}
