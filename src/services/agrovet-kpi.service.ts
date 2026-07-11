// @ts-nocheck
/**
 * AgrovetKpiService — KPI dashboard metrics: daily sales by cashier, gross
 * profit per product, top-selling products, inventory turnover rate, cashflow
 * series, and staff activity. All org-scoped and period-bounded.
 */
import { prisma } from '@/lib/prisma'

export class AgrovetKpiService {
  static async dailySalesByCashier(organizationId: bigint, from: Date, to: Date, branchId?: bigint) {
    const groups = await prisma.sale.groupBy({
      by: ['created_by_id'],
      where: { organization_id: organizationId, deleted_at: null, status: { not: 'CANCELLED' }, timestamp: { gte: from, lte: to }, ...(branchId && { branch_id: branchId }) },
      _sum: { total_amount: true },
      _count: { _all: true },
    })
    const users = await prisma.user.findMany({ where: { id: { in: groups.map((g) => g.created_by_id) } }, select: { id: true, first_name: true, last_name: true } })
    const nameById = new Map(users.map((u) => [u.id.toString(), `${u.first_name} ${u.last_name}`]))
    return groups
      .map((g) => ({ cashier_id: g.created_by_id, cashier_name: nameById.get(g.created_by_id.toString()), sales_count: g._count._all, total: Number(g._sum.total_amount || 0) }))
      .sort((a, b) => b.total - a.total)
  }

  /** Gross profit per product = revenue − COGS over sold items in the period. */
  static async grossProfitPerProduct(organizationId: bigint, from: Date, to: Date, branchId?: bigint) {
    const items = await prisma.saleItem.findMany({
      where: { Sale: { organization_id: organizationId, deleted_at: null, status: { not: 'CANCELLED' }, timestamp: { gte: from, lte: to }, ...(branchId && { branch_id: branchId }) } },
      select: { product_id: true, quantity: true, subtotal: true, ProductBatch: { select: { unit_cost: true } }, Product: { select: { name: true } } },
    })
    const map = new Map<string, { product_id: bigint; name: string; qty: number; revenue: number; cogs: number }>()
    for (const it of items) {
      const key = it.product_id.toString()
      const cur = map.get(key) ?? { product_id: it.product_id, name: it.Product?.name ?? '', qty: 0, revenue: 0, cogs: 0 }
      cur.qty += it.quantity
      cur.revenue += Number(it.subtotal)
      cur.cogs += it.quantity * Number(it.ProductBatch?.unit_cost || 0)
      map.set(key, cur)
    }
    return [...map.values()]
      .map((p) => ({ ...p, gross_profit: p.revenue - p.cogs, margin_pct: p.revenue ? Number((((p.revenue - p.cogs) / p.revenue) * 100).toFixed(1)) : 0 }))
      .sort((a, b) => b.gross_profit - a.gross_profit)
  }

  static async topSelling(organizationId: bigint, from: Date, to: Date, limit = 10) {
    const items = await prisma.saleItem.groupBy({
      by: ['product_id'],
      where: { Sale: { organization_id: organizationId, deleted_at: null, status: { not: 'CANCELLED' }, timestamp: { gte: from, lte: to } } },
      _sum: { quantity: true, subtotal: true },
    })
    const products = await prisma.product.findMany({ where: { id: { in: items.map((i) => i.product_id) } }, select: { id: true, name: true } })
    const nameById = new Map(products.map((p) => [p.id.toString(), p.name]))
    return items
      .map((i) => ({ product_id: i.product_id, name: nameById.get(i.product_id.toString()), units_sold: Number(i._sum.quantity || 0), revenue: Number(i._sum.subtotal || 0) }))
      .sort((a, b) => b.units_sold - a.units_sold)
      .slice(0, limit)
  }

  /**
   * Inventory turnover rate = COGS in period / average inventory value.
   * (A real turnover metric, not just stock valuation.)
   */
  static async inventoryTurnover(organizationId: bigint, from: Date, to: Date) {
    const items = await prisma.saleItem.findMany({
      where: { Sale: { organization_id: organizationId, deleted_at: null, status: { not: 'CANCELLED' }, timestamp: { gte: from, lte: to } } },
      select: { quantity: true, ProductBatch: { select: { unit_cost: true } } },
    })
    const cogs = items.reduce((s, it) => s + it.quantity * Number(it.ProductBatch?.unit_cost || 0), 0)

    // Current inventory value as the average-inventory proxy (single snapshot).
    const batches = await prisma.productBatch.findMany({
      where: { organization_id: organizationId, deleted_at: null, quantity_remaining: { gt: 0 } },
      select: { quantity_remaining: true, unit_cost: true },
    })
    const inventoryValue = batches.reduce((s, b) => s + b.quantity_remaining * Number(b.unit_cost), 0)
    const turnover = inventoryValue > 0 ? Number((cogs / inventoryValue).toFixed(2)) : 0
    return { period: { from, to }, cogs, inventory_value: inventoryValue, turnover_rate: turnover }
  }

  static async cashflowSeries(organizationId: bigint, from: Date, to: Date) {
    const rows = await prisma.cashbook.findMany({
      where: { organization_id: organizationId, status: 'ACTIVE', date: { gte: from, lte: to } },
      select: { date: true, transaction_type: true, amount: true },
      orderBy: { date: 'asc' },
    })
    const daily: Record<string, { in: number; out: number; net: number }> = {}
    for (const r of rows) {
      const k = r.date.toISOString().slice(0, 10)
      daily[k] ??= { in: 0, out: 0, net: 0 }
      if (r.transaction_type === 'IN') daily[k].in += Number(r.amount)
      else daily[k].out += Number(r.amount)
      daily[k].net = daily[k].in - daily[k].out
    }
    return daily
  }

  static async staffActivity(organizationId: bigint, limit = 100) {
    const logs = await prisma.activityLog.findMany({
      where: { organization_id: organizationId },
      orderBy: { timestamp: 'desc' },
      take: limit,
      include: { user: { select: { id: true, first_name: true, last_name: true } } },
    })
    return logs.map(({ user, ...l }) => ({ ...l, user }))
  }

  /** Assemble the full KPI dashboard for the period. */
  static async dashboard(organizationId: bigint, from: Date, to: Date, branchId?: bigint) {
    const [salesByCashier, grossProfit, top, turnover, cashflow] = await Promise.all([
      this.dailySalesByCashier(organizationId, from, to, branchId),
      this.grossProfitPerProduct(organizationId, from, to, branchId),
      this.topSelling(organizationId, from, to),
      this.inventoryTurnover(organizationId, from, to),
      this.cashflowSeries(organizationId, from, to),
    ])
    return {
      period: { from, to },
      daily_sales_by_cashier: salesByCashier,
      gross_profit_per_product: grossProfit,
      top_selling_products: top,
      inventory_turnover: turnover,
      cashflow: cashflow,
    }
  }
}
