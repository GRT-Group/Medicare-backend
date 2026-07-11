/**
 * AlertService — the single notification/alert service for agrovet. Every alert
 * type (low stock, expiry 30/7 days, unusual discount, large/voided sale,
 * overdue credit) is emitted through emit() with ONE consistent event shape
 * (NotificationEvent), instead of scattered per-module logic.
 *
 * Consumers (frontend, Administrator dashboard) read them via a single feed endpoint.
 */
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

export type AlertType =
  | 'LOW_STOCK'
  | 'EXPIRY_30'
  | 'EXPIRY_7'
  | 'UNUSUAL_DISCOUNT'
  | 'LARGE_SALE'
  | 'VOIDED_SALE'
  | 'OVERDUE_CREDIT'

export type Severity = 'INFO' | 'WARNING' | 'CRITICAL'

export type EmitAlert = {
  organization_id: bigint
  branch_id?: bigint | null
  type: AlertType
  severity?: Severity
  title: string
  message: string
  /** Role name this alert is routed to (e.g. "Administrator"). null = all staff. */
  target_role?: string | null
  data?: Record<string, unknown>
  /**
   * De-dupe key: if provided, an unread event of the same type whose data
   * matches this key is not re-created (avoids alert spam for the same batch).
   */
  dedupeKey?: string
}

export class AlertService {
  static async emit(alert: EmitAlert, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma

    if (alert.dedupeKey) {
      const existing = await client.notificationEvent.findFirst({
        where: {
          organization_id: alert.organization_id,
          type: alert.type,
          is_read: false,
          data: { path: ['dedupe'], equals: alert.dedupeKey },
        },
        select: { id: true },
      })
      if (existing) return existing
    }

    return client.notificationEvent.create({
      data: {
        organization_id: alert.organization_id,
        branch_id: alert.branch_id ?? undefined,
        type: alert.type,
        severity: alert.severity ?? 'INFO',
        title: alert.title,
        message: alert.message,
        target_role: alert.target_role ?? undefined,
        data: {
          ...(alert.data ?? {}),
          ...(alert.dedupeKey ? { dedupe: alert.dedupeKey } : {}),
        } as Prisma.InputJsonValue,
      },
    })
  }

  /** List alerts for an org, newest first, scoped by organization_id. */
  static async list(
    organizationId: bigint,
    opts: { type?: AlertType; unreadOnly?: boolean; targetRole?: string; limit?: number; offset?: number } = {},
  ) {
    const where: Prisma.NotificationEventWhereInput = {
      organization_id: organizationId,
      ...(opts.type && { type: opts.type }),
      ...(opts.unreadOnly && { is_read: false }),
      ...(opts.targetRole && { target_role: opts.targetRole }),
    }
    const limit = Math.min(opts.limit ?? 50, 200)
    const offset = opts.offset ?? 0
    const [total, unread, items] = await Promise.all([
      prisma.notificationEvent.count({ where }),
      prisma.notificationEvent.count({ where: { organization_id: organizationId, is_read: false } }),
      prisma.notificationEvent.findMany({ where, orderBy: { created_at: 'desc' }, take: limit, skip: offset }),
    ])
    return { total, unread, limit, offset, items }
  }

  /** Mark one or many alerts read (scoped to the org). */
  static async markRead(organizationId: bigint, ids: bigint[]) {
    return prisma.notificationEvent.updateMany({
      where: { organization_id: organizationId, id: { in: ids } },
      data: { is_read: true },
    })
  }

  // ---- Scanners: recompute stock/expiry/overdue alerts on demand ----

  /**
   * Scan inventory and credit state for an org and emit low-stock, expiry
   * (30 & 7 day) and overdue-credit alerts. Idempotent via dedupeKey.
   * Returns the number of alerts emitted.
   */
  static async runScan(organizationId: bigint): Promise<{ emitted: number; byType: Record<string, number> }> {
    const byType: Record<string, number> = {}
    const bump = (t: string) => { byType[t] = (byType[t] || 0) + 1 }

    // --- Low stock: sum active batch qty per product < reorder_level ---
    const products = await prisma.product.findMany({
      where: { organization_id: organizationId, deleted_at: null },
      select: {
        id: true, name: true, reorder_level: true,
        ProductBatch: { where: { deleted_at: null }, select: { quantity_remaining: true } },
      },
    })
    for (const p of products) {
      const stock = p.ProductBatch.reduce((s, b) => s + b.quantity_remaining, 0)
      if (p.reorder_level > 0 && stock <= p.reorder_level) {
        await this.emit({
          organization_id: organizationId,
          type: 'LOW_STOCK',
          severity: stock === 0 ? 'CRITICAL' : 'WARNING',
          title: `Low stock: ${p.name}`,
          message: `${p.name} has ${stock} left (reorder level ${p.reorder_level}).`,
          target_role: 'Administrator',
          data: { product_id: p.id.toString(), current_stock: stock, reorder_level: p.reorder_level },
          dedupeKey: `low_stock:${p.id}`,
        })
        bump('LOW_STOCK')
      }
    }

    // --- Expiry warnings at 30 and 7 days ---
    const now = new Date()
    const in30 = new Date(now); in30.setDate(in30.getDate() + 30)
    const in7 = new Date(now); in7.setDate(in7.getDate() + 7)

    const expiring = await prisma.productBatch.findMany({
      where: {
        organization_id: organizationId,
        deleted_at: null,
        quantity_remaining: { gt: 0 },
        expiry_date: { not: null, lte: in30, gte: now },
      },
      select: { id: true, batch_number: true, expiry_date: true, quantity_remaining: true, Product: { select: { name: true } } },
    })
    for (const b of expiring) {
      const within7 = b.expiry_date! <= in7
      await this.emit({
        organization_id: organizationId,
        type: within7 ? 'EXPIRY_7' : 'EXPIRY_30',
        severity: within7 ? 'CRITICAL' : 'WARNING',
        title: `Expiry ${within7 ? '≤7' : '≤30'} days: ${b.Product.name}`,
        message: `Batch ${b.batch_number} of ${b.Product.name} (${b.quantity_remaining} units) expires ${b.expiry_date!.toISOString().slice(0, 10)}.`,
        target_role: 'Administrator',
        data: { batch_id: b.id.toString(), expiry_date: b.expiry_date, quantity: b.quantity_remaining },
        dedupeKey: `${within7 ? 'expiry7' : 'expiry30'}:${b.id}`,
      })
      bump(within7 ? 'EXPIRY_7' : 'EXPIRY_30')
    }

    // --- Overdue credit: customers past due_date with a balance ---
    const overdue = await prisma.sale.findMany({
      where: {
        organization_id: organizationId,
        deleted_at: null,
        remaining_balance: { gt: 0 },
        due_date: { not: null, lt: now },
        status: { not: 'CANCELLED' },
      },
      select: { id: true, remaining_balance: true, due_date: true, customer_id: true, Customer: { select: { name: true } } },
    })
    for (const s of overdue) {
      await this.emit({
        organization_id: organizationId,
        type: 'OVERDUE_CREDIT',
        severity: 'WARNING',
        title: `Overdue credit: ${s.Customer?.name ?? 'Customer'}`,
        message: `${s.Customer?.name ?? 'A customer'} has an overdue balance of ${s.remaining_balance} (invoice #${s.id}, due ${s.due_date!.toISOString().slice(0, 10)}).`,
        target_role: 'Administrator',
        data: { sale_id: s.id.toString(), customer_id: s.customer_id?.toString(), balance: s.remaining_balance },
        dedupeKey: `overdue:${s.id}`,
      })
      bump('OVERDUE_CREDIT')
    }

    const emitted = Object.values(byType).reduce((a, b) => a + b, 0)
    return { emitted, byType }
  }
}
