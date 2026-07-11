// @ts-nocheck
/**
 * AgrovetAccountingService — financial reporting built on the existing Cashbook,
 * Sale and PurchaseOrder data. All figures are org-scoped and period-bounded.
 *   - daily cash book ledger (running balance)
 *   - profit & loss per period
 *   - VAT report (output VAT collected on sales)
 *   - separate bank + MoMo transaction log
 */
import { prisma } from '@/lib/prisma'

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10)
}

export class AgrovetAccountingService {
  /**
   * Daily cash book ledger: every Cashbook entry in the period with a running
   * balance, plus per-day IN/OUT/net rollups. This is the ledger itself, not a
   * summary-only report.
   */
  static async cashbookLedger(organizationId: bigint, from: Date, to: Date, branchId?: bigint) {
    const entries = await prisma.cashbook.findMany({
      where: {
        organization_id: organizationId,
        status: 'ACTIVE',
        is_deleted: false,
        date: { gte: from, lte: to },
        ...(branchId && { branch_id: branchId }),
      },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      select: { id: true, date: true, transaction_type: true, category: true, amount: true, description: true, reference_id: true, branch_id: true },
    })

    let running = 0
    const ledger = entries.map((e) => {
      const signed = e.transaction_type === 'IN' ? Number(e.amount) : -Number(e.amount)
      running += signed
      return { ...e, signed_amount: signed, running_balance: running }
    })

    const daily: Record<string, { in: number; out: number; net: number }> = {}
    for (const e of entries) {
      const k = dayKey(e.date)
      daily[k] ??= { in: 0, out: 0, net: 0 }
      if (e.transaction_type === 'IN') daily[k].in += Number(e.amount)
      else daily[k].out += Number(e.amount)
      daily[k].net = daily[k].in - daily[k].out
    }

    const totalIn = ledger.reduce((s, e) => s + (e.signed_amount > 0 ? e.signed_amount : 0), 0)
    const totalOut = ledger.reduce((s, e) => s + (e.signed_amount < 0 ? -e.signed_amount : 0), 0)

    return {
      period: { from, to },
      totals: { in: totalIn, out: totalOut, net: totalIn - totalOut, closing_balance: running },
      daily,
      entries: ledger,
    }
  }

  /** Profit & Loss for a period: revenue (net sales) vs COGS vs expenses. */
  static async profitAndLoss(organizationId: bigint, from: Date, to: Date, branchId?: bigint) {
    const saleWhere = {
      organization_id: organizationId,
      deleted_at: null,
      status: { not: 'CANCELLED' as const },
      timestamp: { gte: from, lte: to },
      ...(branchId && { branch_id: branchId }),
    }

    const salesAgg = await prisma.sale.aggregate({
      where: saleWhere,
      _sum: { total_amount: true, discount_amount: true, vat_amount: true },
      _count: { _all: true },
    })
    const revenue = Number(salesAgg._sum.total_amount || 0)
    const vat = Number(salesAgg._sum.vat_amount || 0)
    const discounts = Number(salesAgg._sum.discount_amount || 0)

    // COGS = sum over sale items (qty * batch unit_cost).
    const items = await prisma.saleItem.findMany({
      where: { Sale: saleWhere },
      select: { quantity: true, ProductBatch: { select: { unit_cost: true } } },
    })
    const cogs = items.reduce((s, it) => s + it.quantity * Number(it.ProductBatch?.unit_cost || 0), 0)

    // Operating expenses recorded in the cash book as OUT (excluding supplier
    // payments and payouts that are balance-sheet, not P&L; here we count the
    // EXPENSE category family).
    const expenseAgg = await prisma.cashbook.aggregate({
      where: {
        organization_id: organizationId,
        status: 'ACTIVE',
        transaction_type: 'OUT',
        category: { startsWith: 'EXPENSE' },
        date: { gte: from, lte: to },
        ...(branchId && { branch_id: branchId }),
      },
      _sum: { amount: true },
    })
    const expenses = Number(expenseAgg._sum.amount || 0)

    const grossProfit = revenue - vat - cogs
    const netProfit = grossProfit - expenses

    return {
      period: { from, to },
      revenue_gross: revenue,
      vat_output: vat,
      discounts,
      revenue_net_of_vat: revenue - vat,
      cogs,
      gross_profit: grossProfit,
      operating_expenses: expenses,
      net_profit: netProfit,
      sales_count: salesAgg._count._all,
    }
  }

  /** VAT report: output VAT collected, per day and total, for the period. */
  static async vatReport(organizationId: bigint, from: Date, to: Date, branchId?: bigint) {
    const sales = await prisma.sale.findMany({
      where: {
        organization_id: organizationId,
        deleted_at: null,
        status: { not: 'CANCELLED' },
        timestamp: { gte: from, lte: to },
        ...(branchId && { branch_id: branchId }),
      },
      select: { timestamp: true, total_amount: true, vat_amount: true },
    })
    const daily: Record<string, { taxable: number; vat: number }> = {}
    let totalVat = 0
    let totalTaxable = 0
    for (const s of sales) {
      const k = dayKey(s.timestamp)
      const vat = Number(s.vat_amount)
      const taxable = Number(s.total_amount) - vat
      daily[k] ??= { taxable: 0, vat: 0 }
      daily[k].taxable += taxable
      daily[k].vat += vat
      totalVat += vat
      totalTaxable += taxable
    }
    return { period: { from, to }, total_taxable: totalTaxable, total_output_vat: totalVat, daily }
  }

  /**
   * Separate bank + MoMo transaction log. Cashbook rows whose category names a
   * MOMO or BANK_TRANSFER channel, split into two logs with running balances.
   */
  static async channelLog(organizationId: bigint, from: Date, to: Date) {
    const rows = await prisma.cashbook.findMany({
      where: {
        organization_id: organizationId,
        status: 'ACTIVE',
        date: { gte: from, lte: to },
        OR: [{ category: { contains: 'MOMO' } }, { category: { contains: 'BANK' } }],
      },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      select: { id: true, date: true, transaction_type: true, category: true, amount: true, description: true, reference_id: true },
    })
    const build = (predicate: (c: string) => boolean) => {
      let bal = 0
      return rows.filter((r) => predicate(r.category)).map((r) => {
        const signed = r.transaction_type === 'IN' ? Number(r.amount) : -Number(r.amount)
        bal += signed
        return { ...r, signed_amount: signed, running_balance: bal }
      })
    }
    return {
      period: { from, to },
      momo: build((c) => c.includes('MOMO')),
      bank: build((c) => c.includes('BANK')),
    }
  }
}
