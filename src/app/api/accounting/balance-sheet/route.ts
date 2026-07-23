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
    const asOfDateParam = searchParams.get("asOfDate");
    const branchIdParam = searchParams.get("branch_id");

    const asOfDate = asOfDateParam ? new Date(asOfDateParam) : new Date();
    // Include the end of the day for the snapshot date
    asOfDate.setHours(23, 59, 59, 999);

    const organization_id = BigInt(session.organization_id);

    const baseWhere: any = {
      organization_id,
      is_deleted: false,
    };

    if (branchIdParam) {
      baseWhere.branch_id = BigInt(branchIdParam);
    }

    // ==========================================
    // 1. ASSETS
    // ==========================================

    let totalInflows = 0;
    let totalOutflows = 0;

    // A. Cash and Cash Equivalents (Net Cash Flow)
    try {
      const salesInflow = await prisma.sale.aggregate({
        where: { ...baseWhere, status: "COMPLETED", timestamp: { lte: asOfDate } },
        _sum: { amount_paid: true },
      });
      totalInflows += Number(salesInflow._sum.amount_paid || 0);
    } catch (e) { console.error("Sales inflow error", e); }
    
    try {
      const customerPayments = await prisma.customerPayment.aggregate({
        where: { organization_id, created_at: { lte: asOfDate } },
        _sum: { amount: true },
      });
      totalInflows += Number(customerPayments._sum.amount || 0);
    } catch (e) { console.error("Customer payment error", e); }

    try {
      const cashbookIn = await prisma.cashbook.aggregate({
        where: { ...baseWhere, transaction_type: "IN", date: { lte: asOfDate } },
        _sum: { amount: true },
      });
      totalInflows += Number(cashbookIn._sum.amount || 0);
    } catch (e) { console.error("Cashbook in error", e); }

    try {
      const supplierPayments = await prisma.supplierPayment.aggregate({
        where: { organization_id, created_at: { lte: asOfDate } },
        _sum: { amount: true },
      });
      totalOutflows += Number(supplierPayments._sum.amount || 0);
    } catch (e) { console.error("Supplier payment error", e); }

    try {
      const cashbookOut = await prisma.cashbook.aggregate({
        where: { ...baseWhere, transaction_type: "OUT", date: { lte: asOfDate } },
        _sum: { amount: true },
      });
      totalOutflows += Number(cashbookOut._sum.amount || 0);
    } catch (e) { console.error("Cashbook out error", e); }

    try {
      const payrolls = await prisma.payroll.aggregate({
        where: { organization_id, status: "PAID", payment_date: { lte: asOfDate } },
        _sum: { net_salary: true },
      });
      totalOutflows += Number(payrolls._sum.net_salary || 0);
    } catch (e) { console.error("Payroll error", e); }

    const cashBalance = totalInflows - totalOutflows;

    // B. Accounts Receivable
    let accountsReceivable = 0;
    try {
      const receivables = await prisma.sale.aggregate({
        where: { ...baseWhere, status: "COMPLETED", timestamp: { lte: asOfDate } },
        _sum: { remaining_balance: true },
      });
      accountsReceivable = Number(receivables._sum.remaining_balance || 0);
    } catch (e) { console.error("Receivables error", e); }

    // C. Inventory Value
    let inventoryValue = 0;
    try {
      const batches = await prisma.productBatch.findMany({
        where: {
          organization_id,
          is_deleted: false,
          quantity_remaining: { gt: 0 }
        },
        select: {
          quantity_remaining: true,
          unit_cost: true,
        }
      });

      batches.forEach(b => {
        inventoryValue += (b.quantity_remaining * Number(b.unit_cost || 0));
      });
    } catch (e) { console.error("Inventory error", e); }

    const totalAssets = cashBalance + accountsReceivable + inventoryValue;

    // ==========================================
    // 2. LIABILITIES
    // ==========================================
    
    // A. Accounts Payable
    let accountsPayable = 0;
    try {
      const payables = await prisma.purchaseOrder.aggregate({
        where: {
          organization_id,
          is_deleted: false,
          updated_at: { lte: asOfDate },
        },
        _sum: { due_amount: true },
      });
      accountsPayable = Number(payables._sum.due_amount || 0);
    } catch (e) { console.error("Payables error", e); }

    const totalLiabilities = accountsPayable;

    // ==========================================
    // 3. EQUITY
    // ==========================================
    
    const totalEquity = totalAssets - totalLiabilities;

    return NextResponse.json({
      success: true,
      data: {
        asOfDate: asOfDate.toISOString(),
        assets: {
          cashAndEquivalents: cashBalance,
          accountsReceivable,
          inventoryValue,
          total: totalAssets,
        },
        liabilities: {
          accountsPayable,
          total: totalLiabilities,
        },
        equity: {
          retainedEarnings: totalEquity,
          total: totalEquity,
        }
      },
    });
  } catch (error: any) {
    console.error("Balance Sheet API Error:", error);
    return NextResponse.json({ success: false, message: error.message || "Internal server error" }, { status: 500 });
  }
}
