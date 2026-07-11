import { prisma } from '@/lib/prisma'
import { PermissionService, ROLES } from './permission.service'

type DashboardRole = {
  id: string
  name: string
  is_super_admin: boolean
}

type DashboardScope =
  | { type: 'GLOBAL' }
  | { type: 'ORGANIZATION'; organization_id: string }

function toNumber(value: unknown) {
  return Number(value || 0)
}

function toStringId(value: bigint | number | string | null | undefined) {
  return value === null || value === undefined ? null : String(value)
}

function startOfDay(date: Date) {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  return result
}

function endOfDay(date: Date) {
  const result = new Date(date)
  result.setHours(23, 59, 59, 999)
  return result
}

export class DashboardService {
  static async getDashboardSummary(organizationId: bigint) {
    const sales = await prisma.sale.aggregate({
      _sum: { total_amount: true },
      where: { organization_id: organizationId, status: 'COMPLETED', deleted_at: null }
    })
    const totalRevenue = toNumber(sales._sum.total_amount)

    const expenses = await prisma.cashbook.aggregate({
      _sum: { amount: true },
      where: { organization_id: organizationId, transaction_type: 'OUT', deleted_at: null }
    })
    const totalExpenses = toNumber(expenses._sum.amount)

    const purchases = await prisma.purchaseOrder.aggregate({
      _sum: { total_amount: true },
      where: { organization_id: organizationId, status: 'RECEIVED', deleted_at: null }
    })
    const totalPurchases = toNumber(purchases._sum.total_amount)

    const customers = await prisma.customer.aggregate({
      _sum: { current_balance: true },
      where: { organization_id: organizationId, deleted_at: null }
    })
    const totalCreditExposure = toNumber(customers._sum.current_balance)

    const batches = await prisma.productBatch.findMany({
      where: { organization_id: organizationId, quantity_remaining: { gt: 0 }, deleted_at: null },
      select: { quantity_remaining: true, unit_cost: true }
    })

    let totalStockValue = 0
    for (const batch of batches) {
      totalStockValue += batch.quantity_remaining * toNumber(batch.unit_cost)
    }

    const netCashFlow = totalRevenue - totalExpenses - totalPurchases

    return {
      revenue: totalRevenue,
      expenses: totalExpenses,
      purchases: totalPurchases,
      creditExposure: totalCreditExposure,
      stockValue: totalStockValue,
      netCashFlow
    }
  }

  static async getAdvancedAnalytics(organizationId: bigint) {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const recentSales = await prisma.sale.findMany({
      where: {
        organization_id: organizationId,
        status: 'COMPLETED',
        deleted_at: null,
        timestamp: { gte: thirtyDaysAgo }
      },
      include: {
        Branch: { select: { name: true } },
        User_Sale_created_by_idToUser: { select: { first_name: true, last_name: true } },
        items: {
          include: {
            ProductBatch: { select: { unit_cost: true } },
            Product: { select: { name: true } }
          }
        }
      },
      orderBy: { timestamp: 'desc' }
    })

    const salesTrendMap = new Map<string, number>()
    const profitTrendMap = new Map<string, number>()
    const branchPerformanceMap = new Map<string, { revenue: number; profit: number }>()
    const productSalesMap = new Map<string, { quantity_sold: number; revenue: number }>()
    const staffPerformanceMap = new Map<string, { revenue: number; salesCount: number }>()

    let totalRevenueLast30 = 0

    for (const sale of recentSales) {
      const dayKey = sale.timestamp.toISOString().split('T')[0]
      const branchName = sale.Branch?.name || 'Main Organization'
      const staffName = sale.User_Sale_created_by_idToUser
        ? `${sale.User_Sale_created_by_idToUser.first_name} ${sale.User_Sale_created_by_idToUser.last_name}`
        : 'Unknown Staff'

      let saleRevenue = toNumber(sale.total_amount)
      let saleCost = 0

      for (const item of sale.items) {
        if (item.ProductBatch && item.ProductBatch.unit_cost) {
          saleCost += toNumber(item.ProductBatch.unit_cost) * item.quantity
        }

        if (item.Product) {
          const prodStats = productSalesMap.get(item.Product.name) || {
            quantity_sold: 0,
            revenue: 0
          }
          prodStats.quantity_sold += item.quantity
          prodStats.revenue += toNumber(item.subtotal)
          productSalesMap.set(item.Product.name, prodStats)
        }
      }

      const saleProfit = saleRevenue - saleCost
      totalRevenueLast30 += saleRevenue

      salesTrendMap.set(dayKey, (salesTrendMap.get(dayKey) || 0) + saleRevenue)
      profitTrendMap.set(dayKey, (profitTrendMap.get(dayKey) || 0) + saleProfit)

      const branchStats = branchPerformanceMap.get(branchName) || { revenue: 0, profit: 0 }
      branchStats.revenue += saleRevenue
      branchStats.profit += saleProfit
      branchPerformanceMap.set(branchName, branchStats)

      const staffStats = staffPerformanceMap.get(staffName) || { revenue: 0, salesCount: 0 }
      staffStats.revenue += saleRevenue
      staffStats.salesCount += 1
      staffPerformanceMap.set(staffName, staffStats)
    }

    const salesTrend = Array.from(salesTrendMap, ([date, amount]) => ({ date, amount }))
    const profitTrend = Array.from(profitTrendMap, ([date, amount]) => ({ date, amount }))
    const branchPerformance = Array.from(branchPerformanceMap, ([branch, stats]) => ({
      branch,
      revenue: stats.revenue,
      profit: stats.profit
    }))

    const topSellingProducts = Array.from(productSalesMap, ([product_name, stats]) => ({
      product_name,
      ...stats
    }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)

    const staffPerformance = Array.from(staffPerformanceMap, ([staff, stats]) => ({
      staff,
      ...stats
    })).sort((a, b) => b.revenue - a.revenue)

    const activeProducts = await prisma.product.findMany({
      where: { organization_id: organizationId, deleted_at: null },
      include: {
        ProductBatch: {
          where: { quantity_remaining: { gt: 0 } },
          select: { quantity_remaining: true }
        }
      }
    })

    const lowStockAlerts: Array<{
      productName: string
      currentStock: number
      reorderLevel: number
    }> = []
    const expiredProductIds = new Set<string>()

    // One query for expired batches across every product instead of one
    // query per product inside the loop below (that N+1 added a full round
    // trip per product in the catalog).
    const expiredBatches = await prisma.productBatch.findMany({
      where: {
        organization_id: organizationId,
        deleted_at: null,
        quantity_remaining: { gt: 0 },
        expiry_date: { lt: new Date() }
      },
      select: { product_id: true }
    })
    const productIdsWithExpiredBatches = new Set(expiredBatches.map(b => b.product_id.toString()))

    for (const prod of activeProducts) {
      let totalStock = 0
      for (const batch of prod.ProductBatch) {
        totalStock += batch.quantity_remaining
      }

      if (totalStock <= prod.reorder_level) {
        lowStockAlerts.push({
          productName: prod.name,
          currentStock: totalStock,
          reorderLevel: prod.reorder_level
        })
      }

      if (productIdsWithExpiredBatches.has(prod.id.toString())) {
        expiredProductIds.add(prod.id.toString())
      }
    }

    lowStockAlerts.sort((a, b) => a.currentStock - b.currentStock)

    const averageDailyRevenue = totalRevenueLast30 / 30
    const forecastNextMonth = averageDailyRevenue * 30

    return {
      analytics: {
        salesTrend,
        profitTrend,
        forecastNextMonth,
        branchPerformance,
        topSellingProducts,
        staffPerformance,
        lowStockAlerts
      },
      lowStockCount: lowStockAlerts.length,
      expiredProductCount: expiredProductIds.size
    }
  }

  static async getOrganizationDashboard(
    organizationId: bigint,
    roleId: bigint | number | string = ROLES.ADMIN
  ) {
    const now = new Date()
    const dayStart = startOfDay(now)
    const dayEnd = endOfDay(now)

    const [summary, analytics, salesToday, purchasesToday, expensesToday, recentSales, productTotals] =
      await Promise.all([
        this.getDashboardSummary(organizationId),
        this.getAdvancedAnalytics(organizationId),
        prisma.sale.aggregate({
          _sum: { total_amount: true },
          where: {
            organization_id: organizationId,
            status: 'COMPLETED',
            deleted_at: null,
            timestamp: { gte: dayStart, lte: dayEnd }
          }
        }),
        prisma.purchaseOrder.aggregate({
          _sum: { total_amount: true },
          where: {
            organization_id: organizationId,
            status: 'RECEIVED',
            deleted_at: null,
            updated_at: { gte: dayStart, lte: dayEnd }
          }
        }),
        prisma.cashbook.aggregate({
          _sum: { amount: true },
          where: {
            organization_id: organizationId,
            transaction_type: 'OUT',
            deleted_at: null,
            date: { gte: dayStart, lte: dayEnd }
          }
        }),
        prisma.sale.findMany({
          where: {
            organization_id: organizationId,
            status: 'COMPLETED',
            deleted_at: null
          },
          orderBy: { timestamp: 'desc' },
          take: 10,
          include: {
            Branch: { select: { name: true } }
          }
        }),
        prisma.product.findMany({
          where: { organization_id: organizationId, deleted_at: null },
          include: {
            ProductBatch: {
              where: { quantity_remaining: { gt: 0 } },
              select: { quantity_remaining: true, expiry_date: true }
            }
          }
        })
      ])

    let totalProducts = 0
    let lowStockProducts = 0
    let totalStockUnits = 0
    const expiredProductIds = new Set<string>()
    const expiringSoonProductIds = new Set<string>()
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

    for (const product of productTotals) {
      totalProducts += 1

      let stock = 0
      let hasExpiredBatch = false
      let hasExpiringSoonBatch = false
      for (const batch of product.ProductBatch) {
        stock += batch.quantity_remaining
        if (batch.expiry_date && batch.expiry_date < now) {
          hasExpiredBatch = true
        } else if (batch.expiry_date && batch.expiry_date <= thirtyDaysFromNow) {
          hasExpiringSoonBatch = true
        }
      }

      totalStockUnits += stock

      if (stock <= product.reorder_level) {
        lowStockProducts += 1
      }

      if (hasExpiredBatch) {
        expiredProductIds.add(product.id.toString())
      }

      if (hasExpiringSoonBatch) {
        expiringSoonProductIds.add(product.id.toString())
      }
    }

    const salesTodayTotal = toNumber(salesToday._sum.total_amount)
    const purchasesTodayTotal = toNumber(purchasesToday._sum.total_amount)
    const expensesTodayTotal = toNumber(expensesToday._sum.amount)

    const topSellingProducts = analytics.analytics.topSellingProducts
    const recentSalesPayload = recentSales.map((sale) => ({
      id: sale.id.toString(),
      invoice_number: sale.invoice_number,
      total_amount: toNumber(sale.total_amount),
      created_at: sale.timestamp.toISOString(),
      branch_name: sale.Branch?.name || null
    }))

    return {
      role: {
        id: toStringId(roleId) || String(ROLES.ADMIN),
        name: Number(roleId) === ROLES.SUPER_ADMIN ? 'Super Admin' : 'Administrator',
        is_super_admin: PermissionService.isSuperAdmin(roleId)
      } satisfies DashboardRole,
      scope: {
        type: 'ORGANIZATION' as const,
        organization_id: organizationId.toString()
      } satisfies DashboardScope,
      sales_today: salesTodayTotal,
      purchases_today: purchasesTodayTotal,
      profit_today: salesTodayTotal - purchasesTodayTotal - expensesTodayTotal,
      total_products: totalProducts,
      total_stock_units: totalStockUnits,
      low_stock_products: lowStockProducts,
      expired_products: expiredProductIds.size,
      expiring_soon_products: expiringSoonProductIds.size,
      top_selling_products: topSellingProducts,
      recent_sales: recentSalesPayload,
      ...summary,
      analytics: analytics.analytics,
      low_stock_alert_count: analytics.lowStockCount,
      expired_product_alert_count: analytics.expiredProductCount
    }
  }

  static async getSuperAdminDashboard() {
    const now = new Date()
    const dayStart = startOfDay(now)
    const dayEnd = endOfDay(now)

    const [
      organizationsTotal,
      activeOrganizations,
      pendingOrganizationApprovals,
      totalBranches,
      totalUsers,
      activeSubscriptions,
      pendingSubscriptionApprovals,
      openSupportTickets,
      pendingPayments,
      summary,
      salesToday,
      purchasesToday,
      expensesToday,
      productTotals,
      recentOrganizations,
      recentBranches,
      recentUsers,
      recentTickets,
      recentPayments,
      recentAuditLogs,
      recentSales,
      topOrganizationsByRevenue
    ] = await Promise.all([
      prisma.organization.count({ where: { deleted_at: null } }),
      prisma.organization.count({ where: { deleted_at: null, is_approved: true } }),
      prisma.organization.count({ where: { deleted_at: null, is_approved: false } }),
      prisma.branch.count({ where: { deleted_at: null } }),
      prisma.user.count({ where: { deleted_at: null } }),
      prisma.subscription.count({ where: { deleted_at: null, status: 'ACTIVE' } }),
      prisma.subscription.count({ where: { deleted_at: null, status: 'PENDING_APPROVAL' } }),
      prisma.supportTicket.count({ where: { deleted_at: null, status: 'OPEN' } }),
      prisma.subscriptionPayment.count({ where: { deleted_at: null, status: 'PENDING' } }),
      this.getPlatformSummary(),
      prisma.sale.aggregate({
        _sum: { total_amount: true },
        where: { status: 'COMPLETED', deleted_at: null, timestamp: { gte: dayStart, lte: dayEnd } }
      }),
      prisma.purchaseOrder.aggregate({
        _sum: { total_amount: true },
        where: { status: 'RECEIVED', deleted_at: null, updated_at: { gte: dayStart, lte: dayEnd } }
      }),
      prisma.cashbook.aggregate({
        _sum: { amount: true },
        where: { transaction_type: 'OUT', deleted_at: null, date: { gte: dayStart, lte: dayEnd } }
      }),
      prisma.product.count({ where: { deleted_at: null } }),
      prisma.organization.findMany({
        where: { deleted_at: null },
        orderBy: { created_at: 'desc' },
        take: 10,
        select: { id: true, name: true, status: true, is_approved: true, created_at: true, updated_at: true, lifecycle_status: true }
      }),
      prisma.branch.findMany({
        where: { deleted_at: null },
        orderBy: { created_at: 'desc' },
        take: 10,
        select: { id: true, name: true, organization_id: true, status: true, created_at: true }
      }),
      prisma.user.findMany({
        where: { deleted_at: null },
        orderBy: { created_at: 'desc' },
        take: 10,
        select: { id: true, first_name: true, last_name: true, email: true, organization_id: true, role_id: true, created_at: true }
      }),
      prisma.supportTicket.findMany({
        where: { deleted_at: null },
        orderBy: { created_at: 'desc' },
        take: 10,
        select: { id: true, organization_id: true, subject: true, status: true, priority: true, created_at: true }
      }),
      prisma.subscriptionPayment.findMany({
        where: { deleted_at: null },
        orderBy: { date: 'desc' },
        take: 10,
        select: { id: true, organization_id: true, amount: true, status: true, date: true, payment_method: true }
      }),
      prisma.auditLog.findMany({
        where: { deleted_at: null },
        orderBy: { timestamp: 'desc' },
        take: 10,
        select: { id: true, organization_id: true, user_id: true, action: true, table_affected: true, timestamp: true }
      }),
      prisma.sale.findMany({
        where: { status: 'COMPLETED', deleted_at: null },
        orderBy: { timestamp: 'desc' },
        take: 10,
        select: {
          id: true,
          invoice_number: true,
          total_amount: true,
          timestamp: true,
          organization_id: true,
          branch_id: true
        }
      }),
      prisma.sale.groupBy({
        by: ['organization_id'],
        where: { status: 'COMPLETED', deleted_at: null },
        _sum: { total_amount: true },
        orderBy: { _sum: { total_amount: 'desc' } },
        take: 10
      })
    ])

    const topOrganizationIds = Array.from(
      new Set(topOrganizationsByRevenue.map((entry) => entry.organization_id.toString()))
    )
    const topOrganizationRecords = topOrganizationIds.length
      ? await prisma.organization.findMany({
          where: { id: { in: topOrganizationIds.map((id) => BigInt(id)) } },
          select: { id: true, name: true }
        })
      : []
    const topOrganizationMap = new Map(
      topOrganizationRecords.map((org) => [org.id.toString(), org.name])
    )

    const totalProducts = typeof productTotals === 'number' ? productTotals : 0
    const lowStockProducts = 0
    const expiredProductIds = new Set<string>()

    const topOrganizations = topOrganizationsByRevenue.map((entry) => {
      const organizationName = topOrganizationMap.get(entry.organization_id.toString())
      return {
        organization_id: entry.organization_id.toString(),
        organization_name: organizationName || 'Unknown Organization',
        revenue: toNumber(entry._sum.total_amount)
      }
    })

    return {
      role: {
        id: String(ROLES.SUPER_ADMIN),
        name: 'Super Admin',
        is_super_admin: true
      } satisfies DashboardRole,
      scope: {
        type: 'GLOBAL' as const
      } satisfies DashboardScope,
      sales_today: toNumber(salesToday._sum.total_amount),
      purchases_today: toNumber(purchasesToday._sum.total_amount),
      profit_today: toNumber(salesToday._sum.total_amount) - toNumber(purchasesToday._sum.total_amount) - toNumber(expensesToday._sum.amount),
      total_products: totalProducts,
      low_stock_products: lowStockProducts,
      expired_products: expiredProductIds.size,
      top_selling_products: [],
      recent_sales: recentSales.map((sale) => ({
        id: sale.id.toString(),
        invoice_number: sale.invoice_number,
        total_amount: toNumber(sale.total_amount),
        created_at: sale.timestamp.toISOString(),
        organization_id: sale.organization_id.toString(),
        branch_id: sale.branch_id?.toString() || null
      })),
      ...summary,
      organizations_total: organizationsTotal,
      active_organizations: activeOrganizations,
      pending_organization_approvals: pendingOrganizationApprovals,
      total_branches: totalBranches,
      total_users: totalUsers,
      active_subscriptions: activeSubscriptions,
      pending_subscription_approvals: pendingSubscriptionApprovals,
      open_support_tickets: openSupportTickets,
      pending_payments: pendingPayments,
      recent_organizations: recentOrganizations.map((org) => ({
        ...org,
        id: org.id.toString(),
        created_at: org.created_at.toISOString(),
        updated_at: org.updated_at.toISOString()
      })),
      recent_branches: recentBranches.map((branch) => ({
        ...branch,
        id: branch.id.toString(),
        organization_id: branch.organization_id.toString(),
        created_at: branch.created_at.toISOString()
      })),
      recent_users: recentUsers.map((user) => ({
        ...user,
        id: user.id.toString(),
        organization_id: user.organization_id?.toString() || null,
        role_id: user.role_id.toString(),
        created_at: user.created_at.toISOString()
      })),
      recent_tickets: recentTickets.map((ticket) => ({
        ...ticket,
        id: ticket.id.toString(),
        organization_id: ticket.organization_id.toString(),
        created_at: ticket.created_at.toISOString()
      })),
      recent_payments: recentPayments.map((payment) => ({
        ...payment,
        id: payment.id.toString(),
        organization_id: payment.organization_id.toString(),
        amount: toNumber(payment.amount),
        date: payment.date.toISOString()
      })),
      recent_audit_logs: recentAuditLogs.map((log) => ({
        ...log,
        id: log.id.toString(),
        organization_id: log.organization_id.toString(),
        user_id: log.user_id.toString(),
        timestamp: log.timestamp.toISOString()
      })),
      top_organizations_by_revenue: topOrganizations,
    }
  }

  private static async getPlatformSummary() {
    const sales = await prisma.sale.aggregate({
      _sum: { total_amount: true },
      where: { status: 'COMPLETED', deleted_at: null }
    })

    const expenses = await prisma.cashbook.aggregate({
      _sum: { amount: true },
      where: { transaction_type: 'OUT', deleted_at: null }
    })

    const purchases = await prisma.purchaseOrder.aggregate({
      _sum: { total_amount: true },
      where: { status: 'RECEIVED', deleted_at: null }
    })

    const customers = await prisma.customer.aggregate({
      _sum: { current_balance: true },
      where: { deleted_at: null }
    })

    const batches = await prisma.productBatch.findMany({
      where: { quantity_remaining: { gt: 0 }, deleted_at: null },
      select: { quantity_remaining: true, unit_cost: true }
    })

    let totalStockValue = 0
    for (const batch of batches) {
      totalStockValue += batch.quantity_remaining * toNumber(batch.unit_cost)
    }

    return {
      revenue: toNumber(sales._sum.total_amount),
      expenses: toNumber(expenses._sum.amount),
      purchases: toNumber(purchases._sum.total_amount),
      creditExposure: toNumber(customers._sum.current_balance),
      stockValue: totalStockValue,
      netCashFlow:
        toNumber(sales._sum.total_amount) -
        toNumber(expenses._sum.amount) -
        toNumber(purchases._sum.total_amount)
    }
  }
}
