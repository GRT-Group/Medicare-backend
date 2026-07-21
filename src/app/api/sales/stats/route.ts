import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { friendlyMessage } from '@/lib/api-error';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function GET(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const organizationId = BigInt(orgId);
    
    const sales = await prisma.sale.findMany({
      where: { organization_id: organizationId, is_deleted: false },
      include: {
        items: { select: { line_profit: true } },
        User_Sale_created_by_idToUser: { select: { id: true, first_name: true, last_name: true, email: true } },
        Branch: { select: { id: true, name: true } }
      }
    });

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Week starts on Sunday
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    let todaySales = 0;
    let todayProfit = 0;
    let todayLoss = 0;
    let todayOrdersCount = 0;

    let weekSales = 0;
    let weekProfit = 0;
    let weekLoss = 0;

    let monthSales = 0;
    let monthProfit = 0;
    let monthLoss = 0;

    let outstandingBalance = 0;
    
    let completedCount = 0;
    let refundedCount = 0;
    let cancelledCount = 0;
    let creditSalesCount = 0;
    let totalCreditOwed = 0;

    const ebmStats = {
      fiscalized: 0,
      pending: 0,
      notConfigured: 0,
      failed: 0
    };

    const paymentMix: Record<string, number> = { CASH: 0, MOMO: 0, CARD: 0, BANK_TRANSFER: 0, CREDIT: 0 };
    
    const cashierStats: Record<string, { count: number, total: number, profit: number, name: string }> = {};
    const branchStats: Record<string, { count: number, total: number, profit: number, name: string }> = {};

    let totalLifetimeSales = 0;
    let totalLifetimeProfit = 0;
    let totalLifetimePaid = 0;

    for (const s of sales) {
      const saleTotal = Number(s.total_amount);
      const salePaid = Number(s.amount_paid);
      const saleProfit = s.items.reduce((sum, item) => sum + Number(item.line_profit), 0);
      const remaining = Number(s.remaining_balance);

      totalLifetimeSales += saleTotal;
      totalLifetimePaid += salePaid;
      totalLifetimeProfit += saleProfit;
      
      const sDate = new Date(s.timestamp);
      
      if (s.status === 'COMPLETED') completedCount++;
      if ((s.status as string) === 'REFUNDED' || (s.status as string) === 'PARTIALLY_REFUNDED') refundedCount++;
      if (s.status === 'CANCELLED') cancelledCount++;

      // Outstanding
      if (s.status !== 'CANCELLED' && s.status !== 'REFUNDED') {
        outstandingBalance += remaining;
        if (remaining > 0) {
          creditSalesCount++;
          totalCreditOwed += remaining;
        }
      }

      // EBM Status mapping
      if (s.ebm_invoice_number && s.ebm_status === 'SUCCESS') ebmStats.fiscalized++;
      else if (s.ebm_status === 'PENDING') {
         if (s.ebm_invoice_number) ebmStats.pending++;
         else ebmStats.notConfigured++; // If no invoice number and pending, assume not configured
      }
      else if (s.ebm_status === 'FAILED') ebmStats.failed++;

      // Payment mix tracking
      let pMethod = s.payment_method;
      if ((pMethod as string) === 'MOBILE_MONEY' || (pMethod as string) === 'MOMO') pMethod = 'MOMO' as any;
      if (!paymentMix[pMethod]) paymentMix[pMethod] = 0;
      paymentMix[pMethod]++;

      // Cashier tracking
      const cId = s.created_by_id?.toString() || '0';
      if (!cashierStats[cId]) {
        const u = s.User_Sale_created_by_idToUser;
        const name = u ? (u.email || `${u.first_name} ${u.last_name || ''}`) : 'Unassigned Cashier';
        cashierStats[cId] = { count: 0, total: 0, profit: 0, name };
      }
      cashierStats[cId].count++;
      cashierStats[cId].total += saleTotal;
      cashierStats[cId].profit += saleProfit;

      // Branch tracking
      const bId = s.branch_id?.toString() || '0';
      if (!branchStats[bId]) {
        branchStats[bId] = { count: 0, total: 0, profit: 0, name: s.Branch?.name || 'Main Store' };
      }
      branchStats[bId].count++;
      branchStats[bId].total += saleTotal;
      branchStats[bId].profit += saleProfit;

      // Date buckets (only count completed sales for revenue periods)
      if (s.status === 'COMPLETED') {
        if (sDate >= startOfMonth) {
          monthSales += saleTotal;
          if (saleProfit > 0) monthProfit += saleProfit;
          else monthLoss += Math.abs(saleProfit);
        }
        
        if (sDate >= startOfWeek) {
          weekSales += saleTotal;
          if (saleProfit > 0) weekProfit += saleProfit;
          else weekLoss += Math.abs(saleProfit);
        }

        if (sDate >= startOfToday) {
          todaySales += saleTotal;
          todayOrdersCount++;
          if (saleProfit > 0) todayProfit += saleProfit;
          else todayLoss += Math.abs(saleProfit);
        }
      }
    }

    // Averages and percentages
    const avgOrder = completedCount > 0 ? Math.round(totalLifetimeSales / completedCount) : 0;
    const margin = totalLifetimeSales > 0 ? ((totalLifetimeProfit / totalLifetimeSales) * 100).toFixed(1) : 0;
    const collectionPercentage = totalLifetimeSales > 0 ? Math.round((totalLifetimePaid / totalLifetimeSales) * 100) : 0;
    const fiscalReady = sales.length > 0 ? Math.round((ebmStats.fiscalized / sales.length) * 100) : 0;

    const pmixTotal = Object.values(paymentMix).reduce((sum, v) => sum + v, 0);
    const paymentMixPercents: Record<string, number> = {};
    for (const [k, v] of Object.entries(paymentMix)) {
      paymentMixPercents[k] = pmixTotal > 0 ? Math.round((v / pmixTotal) * 100) : 0;
    }

    const cashierArray = Object.values(cashierStats).sort((a, b) => b.total - a.total);
    const branchArray = Object.values(branchStats).sort((a, b) => b.total - a.total);

    const responseData = {
      header: {
        todaySales,
        weekSales,
        monthSales,
        outstanding: -outstandingBalance
      },
      periodPerformance: {
        today: { sales: todaySales, profit: todayProfit, loss: todayLoss },
        week: { sales: weekSales, profit: weekProfit, loss: weekLoss },
        month: { sales: monthSales, profit: monthProfit, loss: monthLoss }
      },
      summary: {
        completed: completedCount,
        refunded: refundedCount,
        cancelled: cancelledCount,
        collectionRisk: outstandingBalance > 0 ? `RF ${outstandingBalance} outstanding` : 'No outstanding balance'
      },
      ebmOverview: {
        fiscalized: ebmStats.fiscalized,
        pending: ebmStats.pending,
        notConfigured: ebmStats.notConfigured,
        failed: ebmStats.failed
      },
      commandBoard: {
        todayOrders: todayOrdersCount,
        collection: `${collectionPercentage}%`,
        avgOrder,
        offlinePending: 0
      },
      paymentMix: {
        cash: `${paymentMixPercents['CASH'] || 0}%`,
        momo: `${paymentMixPercents['MOMO'] || 0}%`,
        card: `${paymentMixPercents['CARD'] || 0}%`,
        bank: `${paymentMixPercents['BANK_TRANSFER'] || 0}%`,
        credit: `${paymentMixPercents['CREDIT'] || 0}%`
      },
      exceptions: {
        creditSales: creditSalesCount,
        ebmFailed: ebmStats.failed,
        refunded: refundedCount,
        expired: 0
      },
      intelligence: {
        avgOrder,
        margin: `${margin}%`,
        collection: `${collectionPercentage}%`,
        fiscalReady: `${fiscalReady}%`
      },
      lists: {
        cashiers: cashierArray,
        branches: branchArray
      }
    };

    return NextResponse.json(responseData);
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
