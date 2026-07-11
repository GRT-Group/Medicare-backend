/**
 * AuditService — thin, consistent helper over the existing AuditLog table so
 * every agrovet module writes an immutable (user, action, timestamp) entry the
 * same way, and there is one read endpoint for them.
 *
 * AuditLog rows are append-only by convention: services only ever INSERT here.
 */
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

export type AuditEntry = {
  organization_id: bigint
  user_id: bigint
  action: string
  table_affected: string
  record_id: string
  module?: string
  branch_id?: bigint | null
  before?: unknown
  after?: unknown
  ip_address?: string | null
}

export class AuditService {
  /** Write one immutable audit entry. Accepts an optional transaction client. */
  static async log(entry: AuditEntry, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.auditLog.create({
      data: {
        organization_id: entry.organization_id,
        user_id: entry.user_id,
        action: entry.action,
        table_affected: entry.table_affected,
        record_id: entry.record_id,
        module: entry.module,
        branch_id: entry.branch_id ?? undefined,
        before: (entry.before ?? undefined) as Prisma.InputJsonValue | undefined,
        after: (entry.after ?? undefined) as Prisma.InputJsonValue | undefined,
        ip_address: entry.ip_address ?? undefined,
        status: 'ACTIVE',
      },
    })
  }

  /**
   * Read audit logs for an organization, newest first, with simple filters and
   * pagination. Strictly scoped to organization_id (multi-tenant isolation).
   */
  static async list(
    organizationId: bigint,
    opts: {
      userId?: bigint
      module?: string
      table?: string
      branchId?: bigint
      action?: string
      limit?: number
      offset?: number
    } = {},
  ) {
    const where: Prisma.AuditLogWhereInput = {
      organization_id: organizationId,
      ...(opts.userId && { user_id: opts.userId }),
      ...(opts.module && { module: opts.module }),
      ...(opts.table && { table_affected: opts.table }),
      ...(opts.branchId && { branch_id: opts.branchId }),
      ...(opts.action && { action: opts.action }),
    }

    const limit = Math.min(opts.limit ?? 100, 500)
    const offset = opts.offset ?? 0

    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset,
        include: {
          User_AuditLog_user_idToUser: {
            select: { id: true, first_name: true, last_name: true, email: true },
          },
          Branch: { select: { id: true, name: true } },
        },
      }),
    ])

    return {
      total,
      limit,
      offset,
      items: rows.map(({ User_AuditLog_user_idToUser, Branch, ...r }) => ({
        ...r,
        user: User_AuditLog_user_idToUser,
        branch: Branch,
      })),
    }
  }
}
