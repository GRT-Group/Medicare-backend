// @ts-nocheck
/**
 * CustomerNotifyService — customer-facing SMS/email messages for the credit
 * lifecycle: sale recorded, payment received, and "please pay" reminders.
 *
 * Design rules:
 *  - notifySale/notifyPayment NEVER throw: they run fire-and-forget after a
 *    sale/payment commits, and a messaging-provider outage must not fail the
 *    transaction the cashier just completed.
 *  - sendCreditReminder DOES throw readable 400s (no balance, no contact
 *    details) because it backs an explicit "send reminder" button whose user
 *    needs to know why nothing was sent.
 *  - SMS goes to customer.phone, email to customer.email — whichever exists;
 *    both when both exist. Amounts are whole RWF.
 */
import { prisma } from '@/lib/prisma'
import { badRequest } from '@/lib/api-error'
import { smsSend } from '@/services/sms.service'
import { EmailService } from '@/services/email.service'

const fmtRwf = (n: number | string | bigint) => `${Math.round(Number(n)).toLocaleString('en-US')} RWF`
const fmtDate = (d?: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : null)

async function loadCustomerAndOrg(organizationId: bigint, customerId: bigint) {
  const [customer, org] = await Promise.all([
    prisma.customer.findFirst({
      where: { id: customerId, organization_id: organizationId },
      select: { id: true, name: true, phone: true, email: true, current_balance: true, credit_limit: true },
    }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
  ])
  return { customer, orgName: org?.name ?? 'our shop' }
}

/** Send to whichever channels the customer has. Returns which ones were attempted. */
async function deliver(customer: { phone?: string | null; email?: string | null }, subject: string, message: string) {
  const channels: string[] = []
  if (customer.phone) {
    channels.push('sms')
    smsSend({ phone: customer.phone, message }).catch((e) => console.error('[CUSTOMER SMS FAILED]', e))
  }
  if (customer.email) {
    channels.push('email')
    EmailService.sendEmail(
      customer.email,
      subject,
      `<p>${message.replace(/\n/g, '<br/>')}</p>`,
      message,
    ).catch((e) => console.error('[CUSTOMER EMAIL FAILED]', e))
  }
  return channels
}

export class CustomerNotifyService {
  /**
   * "Your purchase is recorded" message — fire-and-forget after any sale
   * linked to a customer. Mentions total, paid, and the balance still due.
   */
  static async notifySale(organizationId: bigint, customerId: bigint, sale: {
    invoice_number: string
    total_amount: number | string
    amount_paid: number | string
    remaining_balance: number | string
    due_date?: Date | null
  }) {
    try {
      const { customer, orgName } = await loadCustomerAndOrg(organizationId, customerId)
      if (!customer) return

      const remaining = Number(sale.remaining_balance)
      const due = fmtDate(sale.due_date)
      const limit = Number(customer.credit_limit || 0)
      const currentBalance = Number(customer.current_balance)
      const remainingLimitText = limit > 0 ? ` Remaining Credit Limit: ${fmtRwf(limit - currentBalance)}.` : ''

      const message = remaining > 0
        ? `Dear ${customer.name},\nYour new credit purchase at ${orgName} (Invoice ${sale.invoice_number}) has been recorded.\nTotal Amount: ${fmtRwf(sale.total_amount)}\nAmount Paid: ${fmtRwf(sale.amount_paid)}\nCredit Added: ${fmtRwf(remaining)}${due ? ` (Due by ${due})` : ''}.\nYour Total Outstanding Balance is now: ${fmtRwf(currentBalance)}.${remainingLimitText}\nThank you!`
        : `Dear ${customer.name},\nThank you for your purchase at ${orgName} (Invoice ${sale.invoice_number}) of ${fmtRwf(sale.total_amount)}, fully paid. We appreciate your business!`

      await deliver(customer, `Your purchase at ${orgName} — ${sale.invoice_number}`, message)
    } catch (e) {
      console.error('[CUSTOMER SALE NOTIFY FAILED]', e)
    }
  }

  /**
   * "Payment received" message — fire-and-forget after a customer payment.
   * States the amount paid and the remaining balance.
   */
  static async notifyPayment(organizationId: bigint, customerId: bigint, info: {
    amount: number
    new_balance: number
    reference?: string | null
  }) {
    try {
      const { customer, orgName } = await loadCustomerAndOrg(organizationId, customerId)
      if (!customer) return

      const limit = Number(customer.credit_limit || 0)
      const remaining = Math.max(info.new_balance, 0)
      const remainingLimitText = limit > 0 ? ` Remaining Credit Limit: ${fmtRwf(limit - remaining)}.` : ''

      const message = `Dear ${customer.name},\n${orgName} has successfully received your payment of ${fmtRwf(info.amount)}${info.reference ? ` (Ref: ${info.reference})` : ''}.\n${remaining > 0 ? `Your New Outstanding Balance is: ${fmtRwf(remaining)}.` : 'Your account is now fully settled.'}${remainingLimitText}\nThank you for your business!`

      await deliver(customer, `Payment received — ${orgName}`, message)
    } catch (e) {
      console.error('[CUSTOMER PAYMENT NOTIFY FAILED]', e)
    }
  }

  /**
   * Explicit "please pay your credit" reminder for one customer. Throws
   * readable 400s so the reminder button can tell the user what went wrong.
   * Returns what was sent for the UI to confirm.
   */
  static async sendCreditReminder(organizationId: bigint, customerId: bigint, customTemplate?: string) {
    const { customer, orgName } = await loadCustomerAndOrg(organizationId, customerId)
    if (!customer) throw badRequest('Customer not found in this organization')

    const balance = Number(customer.current_balance)
    if (balance <= 0) throw badRequest(`${customer.name} has no outstanding balance — nothing to remind about`)
    if (!customer.phone && !customer.email) {
      throw badRequest(`${customer.name} has no phone or email on file — add contact details first`)
    }

    // The customer's most overdue unpaid sale gives the reminder its "since" date.
    const oldestDue = await prisma.sale.findFirst({
      where: {
        organization_id: organizationId,
        customer_id: customerId,
        deleted_at: null,
        status: { not: 'CANCELLED' },
        remaining_balance: { gt: 0 },
        due_date: { not: null },
      },
      orderBy: { due_date: 'asc' },
      select: { due_date: true },
    })
    const dueSince = oldestDue?.due_date && oldestDue.due_date < new Date() ? fmtDate(oldestDue.due_date) : null

    let message = `Dear ${customer.name}, this is a friendly reminder from ${orgName}: your outstanding balance is ${fmtRwf(balance)}${dueSince ? ` (due since ${dueSince})` : ''}. Please visit us or contact us to arrange payment. Thank you.`
    if (customTemplate) {
      message = customTemplate
        .replace(/{name}/g, customer.name)
        .replace(/{balance}/g, fmtRwf(balance))
        .replace(/{orgName}/g, orgName)
        .replace(/{dueSince}/g, dueSince ? dueSince : '');
    }

    const channels = await deliver(customer, `Payment reminder — ${orgName}`, message)

    return {
      customer_id: customer.id.toString(),
      customer_name: customer.name,
      balance,
      due_since: dueSince,
      channels,
      message,
    }
  }

  /**
   * Bulk reminders: every customer with an outstanding balance (optionally
   * only those already past a due date, or explicitly selected customerIds). Returns a per-customer result list.
   */
  static async sendCreditReminders(organizationId: bigint, onlyOverdue = false, customerIds?: string[], customTemplate?: string) {
    const whereClause: any = { organization_id: organizationId, deleted_at: null, current_balance: { gt: 0 } };
    if (customerIds && customerIds.length > 0) {
      whereClause.id = { in: customerIds.map(id => BigInt(id)) };
    }
    
    const customers = await prisma.customer.findMany({
      where: whereClause,
      select: { id: true, name: true, phone: true, email: true, current_balance: true },
      orderBy: { current_balance: 'desc' },
    })

    let targets = customers
    if (onlyOverdue) {
      const overdueSales = await prisma.sale.findMany({
        where: {
          organization_id: organizationId,
          deleted_at: null,
          status: { not: 'CANCELLED' },
          remaining_balance: { gt: 0 },
          due_date: { lt: new Date() },
          customer_id: { not: null },
        },
        select: { customer_id: true },
        distinct: ['customer_id'],
      })
      const overdueIds = new Set(overdueSales.map((s) => s.customer_id!.toString()))
      targets = customers.filter((c) => overdueIds.has(c.id.toString()))
    }

    const results = []
    for (const c of targets) {
      try {
        results.push({ ...(await this.sendCreditReminder(organizationId, c.id, customTemplate)), status: 'sent' })
      } catch (e: any) {
        results.push({ customer_id: c.id.toString(), customer_name: c.name, balance: Number(c.current_balance), status: 'skipped', reason: e.message })
      }
    }

    return {
      total_with_balance: customers.length,
      reminded: results.filter((r) => r.status === 'sent').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      results,
    }
  }
}
