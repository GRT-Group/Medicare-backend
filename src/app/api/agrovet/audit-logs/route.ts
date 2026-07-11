// @ts-nocheck
/**
 * GET /api/agrovet/audit-logs
 * Unified, read-only, org-scoped audit trail across all modules.
 *   query: ?module=&table=&action=&userId=&branchId=&limit=&offset=
 * RBAC: requires VIEW:AUDIT_LOGS. Response: { data: { total, limit, offset, items } }.
 * Audit rows are append-only; there is no write/update/delete endpoint by design.
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveContext, requirePermission, toErrorResponse } from '@/lib/agrovet/context'
import { AuditService } from '@/services/audit.service'

export async function GET(req: NextRequest) {
  try {
    const ctx = await resolveContext(req)
    await requirePermission(ctx, 'VIEW', 'AUDIT_LOGS')

    const url = new URL(req.url)
    const result = await AuditService.list(ctx.organizationId, {
      module: url.searchParams.get('module') || undefined,
      table: url.searchParams.get('table') || undefined,
      action: url.searchParams.get('action') || undefined,
      userId: url.searchParams.get('userId') ? BigInt(url.searchParams.get('userId')!) : undefined,
      branchId: url.searchParams.get('branchId') ? BigInt(url.searchParams.get('branchId')!) : undefined,
      limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
      offset: url.searchParams.get('offset') ? Number(url.searchParams.get('offset')) : undefined,
    })
    return NextResponse.json({ success: true, data: result }, { status: 200 })
  } catch (error) {
    const { body, status } = toErrorResponse(error)
    return NextResponse.json({ success: false, ...body }, { status })
  }
}
