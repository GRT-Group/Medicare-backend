// @ts-nocheck
/**
 * AgrovetPurchaseService — GRN (goods-received) with per-line batch + expiry
 * capture and correct selling price, plus supplier payables tracking. Separate
 * from the generic PurchaseService (which uses a dummy ×1.5 price and captures
 * no expiry) so other org types are unaffected.
 */
import { prisma } from '@/lib/prisma'
import { AuditService } from '@/services/audit.service'
import { AlertService } from '@/services/alert.service'

export class AgrovetPurchaseService {
  /**
   * Receive a purchase order (GRN). For each received line the caller supplies
   * batch number, expiry and selling price. On confirmation this creates
   * ProductBatch rows (with expiry), records INCREASE movements, marks the PO
   * received, and increments the supplier's outstanding payable balance.
   *
   *   lines: [{ po_item_id, received_quantity, batch_number?, expiry_date?, selling_price }]
   */
  static async receiveGRN(
    organizationId: bigint,
    data: {
      purchase_order_id: bigint
      branch_id: bigint
      lines: { po_item_id: bigint; received_quantity: number; batch_number?: string; expiry_date?: Date; selling_price: number }[]
    },
    actorId: bigint,
  ) {
    return prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findFirst({
        where: { id: data.purchase_order_id, organization_id: organizationId },
        include: { PurchaseOrderItem: true },
      })
      if (!po) throw new Error('Purchase order not found')
      if (po.status === 'RECEIVED') throw new Error('Purchase order already received')

      const lineById = new Map(data.lines.map((l) => [l.po_item_id.toString(), l]))
      let payableIncrease = 0

      for (const item of po.PurchaseOrderItem) {
        const line = lineById.get(item.id.toString())
        if (!line) continue // partial GRN: only received lines are processed
        if (line.received_quantity <= 0) continue

        const batch = await tx.productBatch.create({
          data: {
            organization_id: organizationId,
            product_id: item.product_id,
            supplier_id: po.supplier_id,
            batch_number: line.batch_number || `GRN-${po.id}-${item.id}-${Date.now()}`,
            quantity_remaining: line.received_quantity,
            unit_cost: item.unit_cost,
            selling_price: line.selling_price, // real price, not a dummy multiplier
            expiry_date: line.expiry_date ?? null, // expiry captured on GRN
          },
        })

        await tx.purchaseOrderItem.update({
          where: { id: item.id },
          data: { received_quantity: line.received_quantity },
        })

        await tx.inventoryMovement.create({
          data: {
            organization_id: organizationId,
            branch_id: data.branch_id,
            product_id: item.product_id,
            batch_id: batch.id,
            movement_type_id: 'PURCHASE_RECEIPT',
            type: 'PURCHASE_RECEIPT',
            quantity: line.received_quantity,
            reference_id: po.id.toString(),
            created_by_id: actorId,
          },
        })

        payableIncrease += line.received_quantity * Number(item.unit_cost)
      }

      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: 'RECEIVED', actual_delivery_date: new Date() },
      })

      // Outstanding payable to the supplier grows by the received value.
      await tx.supplier.update({
        where: { id: po.supplier_id },
        data: { outstanding_balance: { increment: payableIncrease } },
      })

      await AuditService.log(
        {
          organization_id: organizationId,
          branch_id: data.branch_id,
          user_id: actorId,
          module: 'PURCHASING',
          action: 'RECEIVE_GRN',
          table_affected: 'PurchaseOrder',
          record_id: po.id.toString(),
          after: { payable_increase: payableIncrease, lines: data.lines.length },
        },
        tx,
      )

      return { purchase_order_id: po.id, supplier_id: po.supplier_id, payable_increase: payableIncrease }
    }, { timeout: 30000, maxWait: 10000 })
  }

  /** Record a payment to a supplier; decrements outstanding payable. */
  static async paySupplier(
    organizationId: bigint,
    data: { supplier_id: bigint; amount: number; payment_method?: string; reference?: string; note?: string },
    actorId: bigint,
  ) {
    if (data.amount <= 0) throw new Error('Payment amount must be positive')
    return prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findFirst({ where: { id: data.supplier_id, organization_id: organizationId } })
      if (!supplier) throw new Error('Supplier not found in this organization')

      const payment = await tx.supplierPayment.create({
        data: {
          organization_id: organizationId,
          supplier_id: data.supplier_id,
          amount: data.amount,
          payment_method: (data.payment_method as any) || 'BANK_TRANSFER',
          reference: data.reference,
          note: data.note,
          created_by_id: actorId,
        },
      })

      await tx.supplier.update({
        where: { id: data.supplier_id },
        data: { outstanding_balance: { decrement: data.amount } },
      })

      // Money leaving the business is logged in the cash book (bank/MoMo channel).
      await tx.cashbook.create({
        data: {
          organization_id: organizationId,
          transaction_type: 'OUT',
          category: `SUPPLIER_PAYMENT_${(data.payment_method as any) || 'BANK_TRANSFER'}`,
          amount: data.amount,
          description: `Payment to ${supplier.name}`,
          reference_id: payment.id.toString(),
          created_by_id: actorId,
          date: new Date(),
        },
      })

      await AuditService.log(
        {
          organization_id: organizationId,
          user_id: actorId,
          module: 'PURCHASING',
          action: 'PAY_SUPPLIER',
          table_affected: 'SupplierPayment',
          record_id: payment.id.toString(),
          after: { supplier_id: data.supplier_id.toString(), amount: data.amount },
        },
        tx,
      )

      const updated = await tx.supplier.findUnique({ where: { id: data.supplier_id }, select: { outstanding_balance: true } })
      return { payment, outstanding_balance: updated?.outstanding_balance }
    })
  }

  /** Per-supplier outstanding payable balances (accounts payable summary). */
  static async getPayables(organizationId: bigint) {
    const suppliers = await prisma.supplier.findMany({
      where: { organization_id: organizationId, deleted_at: null },
      select: { id: true, name: true, outstanding_balance: true, payment_terms: true },
      orderBy: { outstanding_balance: 'desc' },
    })
    const totalPayable = suppliers.reduce((s, x) => s + Number(x.outstanding_balance), 0)
    return { total_payable: totalPayable, suppliers }
  }
}
