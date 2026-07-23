import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getBearerToken, verifyBearerToken } from "@/lib/auth-utils";

export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req.headers);
    if (!token) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    let session: any;
    try {
      session = verifyBearerToken(req.headers);
    } catch (e) {
      return NextResponse.json({ success: false, message: "Unauthorized: Invalid token" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const startDateParam = searchParams.get("startDate");
    const endDateParam = searchParams.get("endDate");
    const branchIdParam = searchParams.get("branch_id");

    const startDate = startDateParam ? new Date(startDateParam) : new Date(new Date().getFullYear(), 0, 1);
    const endDate = endDateParam ? new Date(endDateParam) : new Date();
    
    // Include the end of the day for the end date
    endDate.setHours(23, 59, 59, 999);

    const organization_id = BigInt(session.organization_id);

    // Build the common where clause
    const saleWhere: any = {
      organization_id,
      status: "COMPLETED",
      is_deleted: false,
      timestamp: {
        gte: startDate,
        lte: endDate,
      },
    };

    if (branchIdParam) {
      saleWhere.branch_id = BigInt(branchIdParam);
    }

    // 1. Calculate Revenue and COGS from Sales
    let revenue = 0;
    let cogs = 0;

    try {
      const sales = await prisma.sale.findMany({
        where: saleWhere,
        select: {
          subtotal: true,
          profit_total: true,
        },
      });

      sales.forEach((sale) => {
        const subtotal = Number(sale.subtotal || 0);
        const profit = Number(sale.profit_total || 0);
        revenue += subtotal;
        cogs += (subtotal - profit);
      });
    } catch (e) { console.error("ProfitLoss Sales Error:", e); }

    const grossProfit = revenue - cogs;

    // 2. Calculate Operating Expenses from Cashbook
    let operatingExpenses = 0;
    let cashbookExpenses = 0;

    try {
      const expenseWhere: any = {
        organization_id,
        transaction_type: "OUT",
        is_deleted: false,
        date: {
          gte: startDate,
          lte: endDate,
        },
      };

      if (branchIdParam) {
        expenseWhere.branch_id = BigInt(branchIdParam);
      }

      const expenses = await prisma.cashbook.findMany({
        where: expenseWhere,
        select: {
          amount: true,
        },
      });

      expenses.forEach((expense) => {
        cashbookExpenses += Number(expense.amount || 0);
      });
      operatingExpenses += cashbookExpenses;
    } catch (e) { console.error("ProfitLoss Cashbook Error:", e); }

    // 3. Include Payroll if they use it.
    let payrollExpenses = 0;
    try {
      const payrollWhere: any = {
        organization_id,
        status: "PAID",
        payment_date: {
          gte: startDate,
          lte: endDate,
        },
      };

      if (branchIdParam) {
        payrollWhere.branch_id = BigInt(branchIdParam);
      }

      const payrolls = await prisma.payroll.findMany({
        where: payrollWhere,
        select: {
          net_salary: true,
        },
      });

      payrolls.forEach((payroll) => {
        payrollExpenses += Number(payroll.net_salary || 0);
      });
      operatingExpenses += payrollExpenses;
    } catch (e) { console.error("ProfitLoss Payroll Error:", e); }

    const netProfit = grossProfit - operatingExpenses;

    return NextResponse.json({
      success: true,
      data: {
        revenue,
        cogs,
        grossProfit,
        operatingExpenses,
        netProfit,
        breakdown: {
          salesRevenue: revenue,
          costOfGoodsSold: cogs,
          cashbookExpenses,
          payrollExpenses,
        },
      },
    });
  } catch (error: any) {
    console.error("ProfitLoss API Error:", error);
    return NextResponse.json({ success: false, message: error.message || "Internal server error" }, { status: 500 });
  }
}
