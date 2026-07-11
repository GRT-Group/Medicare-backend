// @ts-nocheck
/**
 * AgrovetCreditService — customer credit ledger and overdue tracking. Builds an
 * immutable-style running statement from credit sales (charges) and
 * CustomerPayment rows (credits), plus the current live balance.
 */
import { prisma } from '@/lib/prisma'
import { AlertService } from '@/services/alert.service'

export class AgrovetCreditService {
  /**
   * A customer's credit statement: chronological charges (credit sales) and
   * payments with a running balance, plus limit / current balance / available.
   */
  static async statement(organizationId: bigint, customerId: bigint) {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, organization_id: organizationId },
      select: { id: true, name: true, credit_limit: true, current_balance: true },
    })
    if (!customer) throw new Error('Customer not found in this organization')

    const [sales, payments] = await Promise.all([
      prisma.sale.findMany({
        where: { organization_id: organizationId, customer_id: customerId, remaining_balance: { gt: 0 }, deleted_at: null, status: { not: 'CANCELLED' } },
        select: { id: true, timestamp: true, invoice_number: true, remaining_balance: true, total_amount: true, due_date: true },
      }),
      prisma.customerPayment.findMany({
        where: { organization_id: organizationId, customer_id: customerId, status: 'ACTIVE', is_deleted: false },
        select: { id: true, timestamp: true, amount: true, payment_method: true, reference: true },
      }),
    ])

    const rows = [
      ...sales.map((s) => ({ kind: 'CHARGE', at: s.timestamp, ref: s.invoice_number, amount: Number(s.remaining_balance), due_date: s.due_date, sale_id: s.id })),
      ...payments.map((p) => ({ kind: 'PAYMENT', at: p.timestamp, ref: p.reference || `PAY-${p.id}`, amount: -Number(p.amount), method: p.payment_method, payment_id: p.id })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime())

    let running = 0
    const ledger = rows.map((r) => { running += r.amount; return { ...r, running_balance: running } })

    const limit = Number(customer.credit_limit)
    const balance = Number(customer.current_balance)
    return {
      customer: { id: customer.id, name: customer.name },
      credit_limit: limit,
      current_balance: balance,
      available_credit: Math.max(0, limit - balance),
      ledger,
    }
  }

  /** Customers currently over-limit or with overdue balances; emits Owner alerts. */
  static async overdue(organizationId: bigint) {
    const now = new Date()
    const overdueSales = await prisma.sale.findMany({
      where: {
        organization_id: organizationId,
        remaining_balance: { gt: 0 },
        due_date: { not: null, lt: now },
        deleted_at: null,
        status: { not: 'CANCELLED' },
      },
      select: { id: true, customer_id: true, remaining_balance: true, due_date: true, invoice_number: true, Customer: { select: { name: true } } },
      orderBy: { due_date: 'asc' },
    })

    // Emit/refresh overdue alerts (deduped) for the Administrator.
    for (const s of overdueSales) {
      await AlertService.emit({
        organization_id: organizationId,
        type: 'OVERDUE_CREDIT',
        severity: 'WARNING',
        title: `Overdue credit: ${s.Customer?.name ?? 'Customer'}`,
        message: `${s.Customer?.name ?? 'Customer'} owes ${s.remaining_balance} on invoice ${s.invoice_number}, due ${s.due_date.toISOString().slice(0, 10)}.`,
        target_role: 'Administrator',
        data: { sale_id: s.id.toString(), customer_id: s.customer_id?.toString(), balance: Number(s.remaining_balance) },
        dedupeKey: `overdue:${s.id}`,
      })
    }

    return {
      count: overdueSales.length,
      total_overdue: overdueSales.reduce((sum, s) => sum + Number(s.remaining_balance), 0),
      items: overdueSales.map((s) => ({
        sale_id: s.id,
        invoice_number: s.invoice_number,
        customer_id: s.customer_id,
        customer_name: s.Customer?.name,
        balance: s.remaining_balance,
        due_date: s.due_date,
        days_overdue: Math.floor((now.getTime() - s.due_date.getTime()) / 86400000),
      })),
    }
  }
}
