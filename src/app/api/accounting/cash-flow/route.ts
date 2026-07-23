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
    endDate.setHours(23, 59, 59, 999);

    const organization_id = BigInt(session.organization_id);

    const baseWhere: any = {
      organization_id,
      is_deleted: false,
    };

    if (branchIdParam) {
      baseWhere.branch_id = BigInt(branchIdParam);
    }

    // ==========================================
    // 1. INFLOWS
    // ==========================================
    let salesInflow = 0;
    try {
      const sales = await prisma.sale.aggregate({
        where: { ...baseWhere, status: "COMPLETED", timestamp: { lte: endDate, gte: startDate } },
        _sum: { amount_paid: true },
      });
      salesInflow = Number(sales._sum.amount_paid || 0);
    } catch (e) { console.error("CashFlow Sales Inflow Error:", e); }

    let customerInflow = 0;
    try {
      const customerPayments = await prisma.customerPayment.aggregate({
        where: { organization_id, created_at: { lte: endDate, gte: startDate } },
        _sum: { amount: true },
      });
      customerInflow = Number(customerPayments._sum.amount || 0);
    } catch (e) { console.error("CashFlow Customer Inflow Error:", e); }

    let cashbookIn = 0;
    try {
      const cbIn = await prisma.cashbook.aggregate({
        where: { ...baseWhere, transaction_type: "IN", date: { lte: endDate, gte: startDate } },
        _sum: { amount: true },
      });
      cashbookIn = Number(cbIn._sum.amount || 0);
    } catch (e) { console.error("CashFlow Cashbook Inflow Error:", e); }

    const totalInflows = salesInflow + customerInflow + cashbookIn;

    // ==========================================
    // 2. OUTFLOWS
    // ==========================================
    let supplierOutflow = 0;
    try {
      const supplierPayments = await prisma.supplierPayment.aggregate({
        where: { organization_id, created_at: { lte: endDate, gte: startDate } },
        _sum: { amount: true },
      });
      supplierOutflow = Number(supplierPayments._sum.amount || 0);
    } catch (e) { console.error("CashFlow Supplier Outflow Error:", e); }

    let cashbookOut = 0;
    try {
      const cbOut = await prisma.cashbook.aggregate({
        where: { ...baseWhere, transaction_type: "OUT", date: { lte: endDate, gte: startDate } },
        _sum: { amount: true },
      });
      cashbookOut = Number(cbOut._sum.amount || 0);
    } catch (e) { console.error("CashFlow Cashbook Outflow Error:", e); }

    let payrollOutflow = 0;
    try {
      const payrolls = await prisma.payroll.aggregate({
        where: { organization_id, status: "PAID", payment_date: { lte: endDate, gte: startDate } },
        _sum: { net_salary: true },
      });
      payrollOutflow = Number(payrolls._sum.net_salary || 0);
    } catch (e) { console.error("CashFlow Payroll Outflow Error:", e); }

    const totalOutflows = supplierOutflow + cashbookOut + payrollOutflow;

    // ==========================================
    // 3. NET CASH FLOW
    // ==========================================
    const netCashFlow = totalInflows - totalOutflows;

    return NextResponse.json({
      success: true,
      data: {
        inflows: {
          sales: salesInflow,
          customerPayments: customerInflow,
          otherIn: cashbookIn,
          total: totalInflows,
        },
        outflows: {
          supplierPayments: supplierOutflow,
          expenses: cashbookOut,
          payroll: payrollOutflow,
          total: totalOutflows,
        },
        netCashFlow,
      },
    });
  } catch (error: any) {
    console.error("Cash Flow API Error:", error);
    return NextResponse.json({ success: false, message: error.message || "Internal server error" }, { status: 500 });
  }
}
