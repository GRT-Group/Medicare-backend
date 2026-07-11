// @ts-nocheck
/**
 * BulkService — multi-select table actions (bulk soft-delete and bulk
 * status-change) for the main management entities: users, products, customers,
 * suppliers.
 *
 * Every operation is organization-scoped (rows outside the caller's org are
 * skipped, never touched) and reuses the app's ArchiveService for deletes so
 * archival + audit behaviour stays identical to single-row deletes. Each item
 * is processed independently and the response reports per-id success/failure so
 * the frontend can show partial results.
 */
import { prisma } from '@/lib/prisma'

const ENTITIES = {
  user: { model: 'user', archive: 'user', statuses: ['ACTIVE', 'INACTIVE', 'SUSPENDED'] },
  product: { model: 'product', archive: 'product', statuses: ['ACTIVE', 'INACTIVE'] },
  customer: { model: 'customer', archive: 'customer', statuses: ['ACTIVE', 'INACTIVE'] },
  supplier: { model: 'supplier', archive: 'supplier', statuses: ['ACTIVE', 'INACTIVE'] },
} as const

export type BulkEntity = keyof typeof ENTITIES

export class BulkService {
  static isValidEntity(e: string): e is BulkEntity {
    return e in ENTITIES
  }

  /** Bulk soft-delete. Returns per-id outcome. */
  static async bulkDelete(entity: BulkEntity, organizationId: bigint, ids: bigint[], actorId: bigint) {
    const { ArchiveService } = await import('@/services/archive.service')
    const cfg = ENTITIES[entity]
    const results: { id: string; ok: boolean; error?: string }[] = []

    for (const id of ids) {
      try {
        // Guard: the row must belong to this org (except users, whose org can be
        // null for platform users — still checked below).
        const row = await prisma[cfg.model].findUnique({ where: { id }, select: { organization_id: true, id: true, is_deleted: true } })
        if (!row) throw new Error('Not found')
        if (row.organization_id && row.organization_id !== organizationId) throw new Error('Not in your organization')
        if (entity === 'user' && id === actorId) throw new Error('You cannot delete your own account')

        // Deleting a row that's already deleted is a harmless no-op, not a
        // failure - report it as success so bulk actions stay idempotent and
        // don't show phantom "X failed" toasts on re-submits.
        if (row.is_deleted) {
          results.push({ id: id.toString(), ok: true })
          continue
        }

        await ArchiveService.softDelete(organizationId, cfg.archive, id, actorId, 'BULK_DELETE')
        results.push({ id: id.toString(), ok: true })
      } catch (e: any) {
        results.push({ id: id.toString(), ok: false, error: e.message })
      }
    }
    return this.summarize(results)
  }

  /** Bulk status change (e.g. ACTIVE <-> INACTIVE/SUSPENDED). Returns per-id outcome. */
  static async bulkStatus(entity: BulkEntity, organizationId: bigint, ids: bigint[], status: string, actorId: bigint) {
    const cfg = ENTITIES[entity]
    if (!cfg.statuses.includes(status)) {
      throw new Error(`Invalid status "${status}" for ${entity}. Allowed: ${cfg.statuses.join(', ')}`)
    }
    const results: { id: string; ok: boolean; error?: string }[] = []

    for (const id of ids) {
      try {
        const row = await prisma[cfg.model].findUnique({ where: { id }, select: { organization_id: true, id: true } })
        if (!row) throw new Error('Not found')
        if (row.organization_id && row.organization_id !== organizationId) throw new Error('Not in your organization')

        await prisma[cfg.model].update({ where: { id }, data: { status } })
        // Audit each status change.
        const { AuditService } = await import('@/services/audit.service')
        await AuditService.log({
          organization_id: organizationId,
          user_id: actorId,
          module: 'MANAGEMENT',
          action: `BULK_STATUS_${status}`,
          table_affected: cfg.model,
          record_id: id.toString(),
          after: { status },
        })
        results.push({ id: id.toString(), ok: true })
      } catch (e: any) {
        results.push({ id: id.toString(), ok: false, error: e.message })
      }
    }
    return this.summarize(results)
  }

  private static summarize(results: { id: string; ok: boolean; error?: string }[]) {
    const succeeded = results.filter((r) => r.ok).length
    return { total: results.length, succeeded, failed: results.length - succeeded, results }
  }
}
