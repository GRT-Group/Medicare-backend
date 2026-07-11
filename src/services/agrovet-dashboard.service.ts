// @ts-nocheck
/**
 * AgrovetDashboardService — role-aware dashboards for the agrovet tenant.
 *
 * One entry point returns a payload shaped for the caller's role:
 *   - Administrator : full business view (finance, KPIs, alerts, approvals)
 *   - Accountant    : finance-focused (cashbook, payables, receivables, VAT)
 *   - Cashier-Agro  : own AGRO-department shift & sales
 *   - Cashier-Vet   : own VET-department shift & sales
 * Super Admin uses the existing platform dashboard (DashboardService); this
 * service is for the in-tenant roles.
 *
 * The "Owner" role (id 13) was merged into Administrator (id 2) — this is
 * now the single full-access, in-tenant admin role for agrovet orgs.
 *
 * Subscription "remaining/expiry countdown" is deliberately NOT included in any
 * dashboard — subscription details live under Organization/Subscription
 * management, per the product decision.
 */
import { prisma } from '@/lib/prisma'
import { AlertService } from '@/services/alert.service'
import { AgrovetKpiService } from '@/services/agrovet-kpi.service'

function n(v: unknown) { return Number(v || 0) }
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x }

const ROLE_NAMES: Record<number, string> = { 2: 'Administrator', 14: 'Accountant', 15: 'Cashier-Agro', 16: 'Cashier-Vet' }

export class AgrovetDashboardService {
  /** Route to the right dashboard for the caller's role. */
  static async forRole(organizationId: bigint, userId: bigint, roleId: bigint, branchId?: bigint | null) {
    const rid = Number(roleId)
    switch (rid) {
      case 15: return this.cashierDashboard(organizationId, userId, 'AGRO', branchId)
      case 16: return this.cashierDashboard(organizationId, userId, 'VET', branchId)
      case 14: return this.accountantDashboard(organizationId, branchId)
      case 2:
      default: return this.ownerDashboard(organizationId, branchId, rid)
    }
  }

  // ---------- ADMINISTRATOR (full business view) ----------
  static async ownerDashboard(organizationId: bigint, branchId?: bigint | null, callerRoleId: number = 2) {
    const now = new Date()
    const from = new Date(now.getTime() - 30 * 86400000)
    const dayStart = startOfDay(now), dayEnd = endOfDay(now)
    const branchFilter = branchId ? { branch_id: branchId } : {}

    const [salesToday, monthSales, pnl, topSelling, turnover, lowStockCount, expiryCount, pendingDiscounts, overdue, alerts, staff] = await Promise.all([
      prisma.sale.aggregate({ _sum: { total_amount: true }, _count: { _all: true }, where: { organization_id: organizationId, status: { not: 'CANCELLED' }, deleted_at: null, timestamp: { gte: dayStart, lte: dayEnd }, ...branchFilter } }),
      prisma.sale.aggregate({ _sum: { total_amount: true }, where: { organization_id: organizationId, status: { not: 'CANCELLED' }, deleted_at: null, timestamp: { gte: from }, ...branchFilter } }),
      AgrovetKpiService.grossProfitPerProduct(organizationId, from, now, branchId ?? undefined),
      AgrovetKpiService.topSelling(organizationId, from, now, 5),
      AgrovetKpiService.inventoryTurnover(organizationId, from, now),
      prisma.notificationEvent.count({ where: { organization_id: organizationId, type: 'LOW_STOCK', is_read: false } }),
      prisma.notificationEvent.count({ where: { organization_id: organizationId, type: { in: ['EXPIRY_30', 'EXPIRY_7'] }, is_read: false } }),
      prisma.discountRequest.count({ where: { organization_id: organizationId, status: 'PENDING' } }),
      prisma.sale.aggregate({ _sum: { remaining_balance: true }, _count: { _all: true }, where: { organization_id: organizationId, remaining_balance: { gt: 0 }, due_date: { lt: now }, deleted_at: null, status: { not: 'CANCELLED' } } }),
      AlertService.list(organizationId, { unreadOnly: true, limit: 10 }),
      AgrovetKpiService.dailySalesByCashier(organizationId, from, now, branchId ?? undefined),
    ])

    const grossProfit = pnl.reduce((s, p) => s + p.gross_profit, 0)

    return {
      role: { id: String(callerRoleId), name: ROLE_NAMES[callerRoleId] ?? 'Administrator' },
      scope: { organization_id: organizationId.toString(), branch_id: branchId?.toString() ?? null },
      cards: {
        sales_today: n(salesToday._sum.total_amount),
        sales_count_today: salesToday._count._all,
        sales_last_30d: n(monthSales._sum.total_amount),
        gross_profit_30d: grossProfit,
        inventory_turnover: turnover.turnover_rate,
        inventory_value: turnover.inventory_value,
        low_stock_alerts: lowStockCount,
        expiry_alerts: expiryCount,
        pending_discount_approvals: pendingDiscounts,
        overdue_credit_count: overdue._count._all,
        overdue_credit_total: n(overdue._sum.remaining_balance),
      },
      top_selling_products: topSelling,
      gross_profit_per_product: pnl.slice(0, 8),
      sales_by_cashier: staff,
      recent_alerts: alerts.items,
    }
  }

  // ---------- ACCOUNTANT ----------
  static async accountantDashboard(organizationId: bigint, branchId?: bigint | null) {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const branchFilter = branchId ? { branch_id: branchId } : {}

    const [revenue, vat, expenses, payables, receivables, momoIn, bankIn, overdue] = await Promise.all([
      prisma.sale.aggregate({ _sum: { total_amount: true, vat_amount: true }, where: { organization_id: organizationId, status: { not: 'CANCELLED' }, deleted_at: null, timestamp: { gte: monthStart }, ...branchFilter } }),
      prisma.sale.aggregate({ _sum: { vat_amount: true }, where: { organization_id: organizationId, deleted_at: null, timestamp: { gte: monthStart } } }),
      prisma.cashbook.aggregate({ _sum: { amount: true }, where: { organization_id: organizationId, transaction_type: 'OUT', category: { startsWith: 'EXPENSE' }, date: { gte: monthStart } } }),
      prisma.supplier.aggregate({ _sum: { outstanding_balance: true }, where: { organization_id: organizationId, deleted_at: null } }),
      prisma.customer.aggregate({ _sum: { current_balance: true }, where: { organization_id: organizationId, deleted_at: null } }),
      prisma.cashbook.aggregate({ _sum: { amount: true }, where: { organization_id: organizationId, transaction_type: 'IN', category: { contains: 'MOMO' }, date: { gte: monthStart } } }),
      prisma.cashbook.aggregate({ _sum: { amount: true }, where: { organization_id: organizationId, transaction_type: 'IN', category: { contains: 'BANK' }, date: { gte: monthStart } } }),
      prisma.sale.aggregate({ _sum: { remaining_balance: true }, _count: { _all: true }, where: { organization_id: organizationId, remaining_balance: { gt: 0 }, due_date: { lt: now }, deleted_at: null, status: { not: 'CANCELLED' } } }),
    ])

    return {
      role: { id: '14', name: 'Accountant' },
      scope: { organization_id: organizationId.toString(), branch_id: branchId?.toString() ?? null },
      period: { from: monthStart, to: now },
      cards: {
        revenue_mtd: n(revenue._sum.total_amount),
        vat_output_mtd: n(vat._sum.vat_amount),
        expenses_mtd: n(expenses._sum.amount),
        accounts_payable: n(payables._sum.outstanding_balance),
        accounts_receivable: n(receivables._sum.current_balance),
        momo_received_mtd: n(momoIn._sum.amount),
        bank_received_mtd: n(bankIn._sum.amount),
        overdue_credit_count: overdue._count._all,
        overdue_credit_total: n(overdue._sum.remaining_balance),
      },
    }
  }

  // ---------- CASHIER (AGRO / VET) ----------
  static async cashierDashboard(organizationId: bigint, userId: bigint, department: 'AGRO' | 'VET', branchId?: bigint | null) {
    const now = new Date()
    const dayStart = startOfDay(now), dayEnd = endOfDay(now)

    const openShift = await prisma.cashSession.findFirst({
      where: { organization_id: organizationId, user_id: userId, status: 'OPEN', is_deleted: false },
    })

    let shiftTotals = null
    if (openShift) {
      const g = await prisma.sale.groupBy({
        by: ['payment_method'],
        where: { organization_id: organizationId, cash_session_id: openShift.id, status: { not: 'CANCELLED' }, deleted_at: null },
        _sum: { total_amount: true }, _count: { _all: true },
      })
      let grand = 0, cash = 0, count = 0
      const byMethod = {}
      for (const x of g) { const t = n(x._sum.total_amount); byMethod[x.payment_method] = { total: t, count: x._count._all }; grand += t; count += x._count._all; if (x.payment_method === 'CASH') cash += t }
      shiftTotals = { grandTotal: grand, cashTotal: cash, salesCount: count, byMethod }
    }

    const myToday = await prisma.sale.aggregate({
      _sum: { total_amount: true }, _count: { _all: true },
      where: { organization_id: organizationId, created_by_id: userId, status: { not: 'CANCELLED' }, deleted_at: null, timestamp: { gte: dayStart, lte: dayEnd } },
    })

    // Department low-stock (products in this cashier's department).
    const deptProducts = await prisma.product.findMany({
      where: { organization_id: organizationId, department, deleted_at: null },
      select: { id: true, name: true, reorder_level: true, ProductBatch: { where: { deleted_at: null }, select: { quantity_remaining: true } } },
    })
    const lowStock = deptProducts
      .map((p) => ({ name: p.name, stock: p.ProductBatch.reduce((s, b) => s + b.quantity_remaining, 0), reorder_level: p.reorder_level }))
      .filter((p) => p.reorder_level > 0 && p.stock <= p.reorder_level)
      .slice(0, 10)

    const myDiscounts = await prisma.discountRequest.findMany({
      where: { organization_id: organizationId, requested_by_id: userId },
      orderBy: { created_at: 'desc' }, take: 5,
      select: { id: true, amount: true, status: true, created_at: true },
    })

    return {
      role: { id: department === 'AGRO' ? '15' : '16', name: department === 'AGRO' ? 'Cashier-Agro' : 'Cashier-Vet' },
      department,
      scope: { organization_id: organizationId.toString(), branch_id: (branchId ?? openShift?.branch_id)?.toString() ?? null },
      shift: openShift ? { id: openShift.id.toString(), opened_at: openShift.opened_at, opening_balance: openShift.opening_balance, totals: shiftTotals } : null,
      cards: {
        my_sales_today: n(myToday._sum.total_amount),
        my_sales_count_today: myToday._count._all,
        shift_open: !!openShift,
        department_low_stock_count: lowStock.length,
      },
      department_low_stock: lowStock,
      my_recent_discount_requests: myDiscounts,
    }
  }
}
