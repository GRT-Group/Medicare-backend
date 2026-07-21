// @ts-nocheck
/**
 * AgrovetSaleService — the agrovet POS sale flow. Kept separate from the generic
 * SaleService so other org types are completely unaffected. Adds, on top of the
 * base flow:
 *   - shift linkage (Sale.cash_session_id)
 *   - MANDATORY EBM fiscalization on every sale via the EbmProvider adapter
 *   - approved-discount application (server-validated, single-use)
 *   - VAT capture (VAT-inclusive) on the sale
 *   - a hardened credit hard-stop (a zero/undefined limit means NO credit)
 *   - explicit FEFO batch selection (earliest expiry first, non-expiring last)
 *   - low-stock / large-sale alerts through the single AlertService
 */
import { prisma } from '@/lib/prisma'
import { badRequest } from '@/lib/api-error'
import { AuditService } from '@/services/audit.service'
import { AlertService } from '@/services/alert.service'
import { DiscountService } from '@/services/discount.service'
import { getEbmProvider } from '@/services/ebm/ebm.provider'
import { ebmConfig } from '@/services/ebm/ebm.config'

// Sales at or above this amount raise a LARGE_SALE alert for the Owner.
const LARGE_SALE_THRESHOLD = Number(process.env.AGROVET_LARGE_SALE_THRESHOLD || 500000)

export type AgrovetSaleInput = {
  customer_id?: bigint
  branch_id: bigint
  cash_session_id?: bigint
  payment_method: 'CASH' | 'CREDIT' | 'MOMO' | 'BANK_TRANSFER' | 'CARD'
  amount_paid?: number
  due_date?: Date
  discount_request_id?: bigint
  /** Optional idempotency key from an offline POS client (see offline-sync). */
  client_ref?: string
  /** batch_id: the batch the cashier picked on screen — deducted first when given. */
  items: { product_id: bigint; batch_id?: bigint; quantity: number; unit_price: number }[]
}

export class AgrovetSaleService {
  static async processSale(organizationId: bigint, data: AgrovetSaleInput, cashierId: bigint) {
    if (!data.items?.length) throw badRequest('A sale must have at least one item')
    if (!data.branch_id) throw badRequest('branch_id is required')

    // Idempotency: if this client_ref was already processed, return that sale
    // instead of creating a duplicate (offline-sync safety). We stash the
    // client_ref in the invoice_number namespace check.
    if (data.client_ref) {
      const existing = await prisma.sale.findFirst({
        where: { organization_id: organizationId, invoice_number: `AGV-${data.client_ref}` },
        include: { items: true },
      })
      if (existing) return { sale: existing, duplicate: true }
    }

    const result = await prisma.$transaction(async (tx) => {
      // --- Gross total ---
      let gross = 0
      for (const it of data.items) {
        if (it.quantity <= 0) throw badRequest('Item quantity must be positive')
        if (it.unit_price < 0) throw badRequest('Item unit_price cannot be negative')
        gross += it.quantity * it.unit_price
      }

      // --- Placeholder sale id via create (we need id for discount consume) ---
      const invoiceNumber = data.client_ref ? `AGV-${data.client_ref}` : `INV-${Date.now()}`

      // --- Apply approved discount (server-validated, single-use) ---
      let discountAmount = 0
      const sale = await tx.sale.create({
        data: {
          organization_id: organizationId,
          branch_id: data.branch_id,
          customer_id: data.customer_id,
          cash_session_id: data.cash_session_id,
          total_amount: gross, // updated below after discount
          amount_paid: 0,
          remaining_balance: 0,
          payment_method: data.payment_method,
          status: 'COMPLETED',
          invoice_number: invoiceNumber,
          created_by_id: cashierId,
        },
      })

      if (data.discount_request_id) {
        discountAmount = await DiscountService.consumeForSale(tx, organizationId, data.discount_request_id, sale.id)
        if (discountAmount > gross) throw badRequest('Approved discount exceeds sale total')
      }

      const netTotal = gross - discountAmount

      // --- Payment / credit hard-stop (server-side, hardened) ---
      const amountPaid = data.amount_paid !== undefined ? data.amount_paid : (data.payment_method === 'CREDIT' ? 0 : netTotal)
      const remaining = netTotal - amountPaid

      if (data.payment_method === 'CREDIT' || remaining > 0) {
        if (!data.customer_id) {
          if (data.payment_method === 'CREDIT') {
            throw badRequest('A registered customer is required for credit sales')
          }
          // For non-CREDIT, Walk-in is allowed to have an unpaid balance (e.g. pay later at the register).
        } else {
          const customer = await tx.customer.findFirst({ where: { id: data.customer_id, organization_id: organizationId } })
          if (!customer) throw badRequest('Customer not found in this organization')

          const newBalance = Number(customer.current_balance) + remaining
          const limit = Number(customer.credit_limit)
          
          if (data.payment_method === 'CREDIT') {
            if (limit <= 0) {
              throw badRequest('Credit denied: customer has no approved credit limit')
            }
            if (newBalance > limit) {
              throw badRequest(`Credit limit exceeded: balance ${newBalance} would exceed limit ${limit}`)
            }
          }
          await tx.customer.update({ where: { id: customer.id }, data: { current_balance: newBalance } })
        }
      }

      // --- VAT (VAT-inclusive) ---
      const vatRate = ebmConfig.defaultVatRate
      const vatAmount = Number(((netTotal * vatRate) / (100 + vatRate)).toFixed(2))

      // --- Deduct stock, FEFO (earliest expiry first, nulls last) ---
      for (const item of data.items) {
        let batches = await tx.productBatch.findMany({
          where: { organization_id: organizationId, product_id: item.product_id, quantity_remaining: { gt: 0 }, deleted_at: null },
          orderBy: [{ expiry_date: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
        })

        // When the POS names a specific batch (the card the cashier tapped),
        // consume it first so the on-screen "N left" actually moves; any
        // overflow beyond it still falls through FEFO to the rest.
        if (item.batch_id !== undefined) {
          const chosen = batches.find((b) => b.id === item.batch_id)
          if (!chosen) {
            const product = await tx.product.findUnique({ where: { id: item.product_id }, select: { name: true } })
            throw badRequest(`Batch ${item.batch_id} of "${product?.name ?? `product ${item.product_id}`}" has no remaining stock (or does not exist). Refresh the product list and pick an available batch.`)
          }
          batches = [chosen, ...batches.filter((b) => b.id !== item.batch_id)]
        }

        let toDeduct = item.quantity
        for (const batch of batches) {
          if (toDeduct <= 0) break
          const take = Math.min(batch.quantity_remaining, toDeduct)
          await tx.productBatch.update({ where: { id: batch.id }, data: { quantity_remaining: batch.quantity_remaining - take } })
          await tx.saleItem.create({
            data: {
              sale_id: sale.id,
              product_id: item.product_id,
              batch_id: batch.id,
              quantity: take,
              unit_price: item.unit_price,
              subtotal: take * item.unit_price,
              updated_at: new Date(),
            },
          })
          await tx.inventoryMovement.create({
            data: {
              organization_id: organizationId,
              branch_id: data.branch_id,
              product_id: item.product_id,
              batch_id: batch.id,
              movement_type_id: 'SALES',
              type: 'SALES',
              quantity: take,
              reference_id: sale.id.toString(),
              created_by_id: cashierId,
            },
          })
          toDeduct -= take
        }
        if (toDeduct > 0) {
          // Name the product in the error — the cashier sees this message.
          const product = await tx.product.findUnique({ where: { id: item.product_id }, select: { name: true } })
          throw badRequest(`Insufficient stock for "${product?.name ?? `product ${item.product_id}`}": short by ${toDeduct} (requested ${item.quantity})`)
        }
      }

      // --- Persist totals ---
      await tx.sale.update({
        where: { id: sale.id },
        data: { total_amount: netTotal, amount_paid: amountPaid, remaining_balance: remaining, discount_amount: discountAmount, vat_amount: vatAmount, due_date: data.due_date },
      })

      // --- Cashbook entry for the paid portion (not credit) ---
      if (amountPaid > 0) {
        await tx.cashbook.create({
          data: {
            organization_id: organizationId,
            branch_id: data.branch_id,
            transaction_type: 'IN',
            category: data.payment_method === 'CASH' ? 'SALES_CASH' : `SALES_${data.payment_method}`,
            amount: amountPaid,
            description: `Sale ${invoiceNumber}`,
            reference_id: sale.id.toString(),
            created_by_id: cashierId,
            date: new Date(),
          },
        })
      }

      await AuditService.log(
        {
          organization_id: organizationId,
          branch_id: data.branch_id,
          user_id: cashierId,
          module: 'POS',
          action: 'CREATE_SALE',
          table_affected: 'Sale',
          record_id: sale.id.toString(),
          after: { total: netTotal, discount: discountAmount, vat: vatAmount, payment_method: data.payment_method, shift: data.cash_session_id?.toString() },
        },
        tx,
      )

      return { saleId: sale.id, invoiceNumber, netTotal, discountAmount, vatAmount, amountPaid, remaining }
    }, { timeout: 30000, maxWait: 10000 })

    // --- MANDATORY EBM fiscalization (outside the DB tx so a slow provider
    // doesn't hold locks; the sale is already durable). Every sale is fiscalized.
    const provider = getEbmProvider()
    const productNames = await prisma.product.findMany({
      where: { id: { in: data.items.map((i) => i.product_id) } },
      select: { id: true, name: true, tax_rate: true },
    })
    const nameById = new Map(productNames.map((p) => [p.id.toString(), p]))
    const ebm = await provider.fiscalize({
      organization_id: organizationId.toString(),
      invoice_number: result.invoiceNumber,
      items: data.items.map((i) => ({
        name: nameById.get(i.product_id.toString())?.name || `Product ${i.product_id}`,
        quantity: i.quantity,
        unit_price: i.unit_price,
        tax_rate: Number(nameById.get(i.product_id.toString())?.tax_rate || ebmConfig.defaultVatRate),
      })),
      total_amount: result.netTotal,
      payment_method: data.payment_method,
    })

    await prisma.sale.update({
      where: { id: result.saleId },
      data: {
        ebm_invoice_number: ebm.ebm_invoice_number,
        ebm_receipt_data: (ebm.receipt_data ?? undefined) as any,
        ebm_status: ebm.success ? 'SUCCESS' : 'FAILED',
      },
    })

    // --- Post-sale alerts through the single AlertService ---
    if (result.netTotal >= LARGE_SALE_THRESHOLD) {
      await AlertService.emit({
        organization_id: organizationId,
        branch_id: data.branch_id,
        type: 'LARGE_SALE',
        severity: 'WARNING',
        title: 'Large sale recorded',
        message: `Sale ${result.invoiceNumber} of ${result.netTotal} was recorded.`,
        target_role: 'Administrator',
        data: { sale_id: result.saleId.toString(), total: result.netTotal },
      })
    }
    // Recompute low-stock alerts for the products touched.
    await AlertService.runScan(organizationId).catch(() => {})

    // Tell the customer their purchase was recorded (total / paid / balance).
    // Fire-and-forget AFTER commit: a messaging outage must never fail a sale.
    if (data.customer_id) {
      const { CustomerNotifyService } = await import('@/services/customer-notify.service')
      CustomerNotifyService.notifySale(organizationId, data.customer_id, {
        invoice_number: result.invoiceNumber,
        total_amount: result.netTotal,
        amount_paid: result.amountPaid,
        remaining_balance: result.remaining,
        due_date: data.due_date,
      }).catch(() => {})
    }

    const full = await this.getSaleReceipt(organizationId, result.saleId)
    return { sale: full, ebm, duplicate: false }
  }

  /** Structured receipt payload (POS receipt + EBM fiscal block). */
  static async getSaleReceipt(organizationId: bigint, saleId: bigint) {
    const sale = await prisma.sale.findFirst({
      where: { id: saleId, organization_id: organizationId },
      include: {
        items: { include: { Product: { select: { name: true, barcode: true, unit_of_measure: true } } } },
        Customer: { select: { id: true, name: true, phone: true } },
        Branch: { select: { id: true, name: true } },
        User_Sale_created_by_idToUser: { select: { first_name: true, last_name: true } },
      },
    })
    if (!sale) throw new Error('Sale not found')
    return {
      id: sale.id,
      invoice_number: sale.invoice_number,
      ebm_invoice_number: sale.ebm_invoice_number,
      ebm_status: sale.ebm_status,
      ebm_receipt_data: sale.ebm_receipt_data,
      branch: sale.Branch,
      cashier: sale.User_Sale_created_by_idToUser,
      customer: sale.Customer,
      payment_method: sale.payment_method,
      cash_session_id: sale.cash_session_id,
      subtotal: Number(sale.total_amount) + Number(sale.discount_amount),
      discount_amount: sale.discount_amount,
      vat_amount: sale.vat_amount,
      total_amount: sale.total_amount,
      amount_paid: sale.amount_paid,
      remaining_balance: sale.remaining_balance,
      timestamp: sale.timestamp,
      items: sale.items.map((i) => ({
        product_id: i.product_id,
        name: i.Product?.name,
        barcode: i.Product?.barcode,
        uom: i.Product?.unit_of_measure,
        quantity: i.quantity,
        unit_price: i.unit_price,
        subtotal: i.subtotal,
      })),
    }
  }
}
