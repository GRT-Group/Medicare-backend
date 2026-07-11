// @ts-nocheck
/**
 * Bulk (multi-select) table actions.
 *
 *   POST /api/agrovet/bulk/{entity}
 *     entity ∈ users | products | customers | suppliers
 *     body: { action: "DELETE" | "STATUS", ids: (number|string)[], status? }
 *       - action=DELETE  -> bulk soft-delete the selected rows
 *       - action=STATUS  -> set `status` on the selected rows (e.g. ACTIVE/INACTIVE/SUSPENDED)
 *
 * Auth: bearer token. RBAC: needs MANAGE permission for the entity. Scope:
 * organization_id (rows outside your org are skipped, never modified).
 * Response: { success:true, data:{ total, succeeded, failed, results:[{id, ok, error?}] } }
 * (Partial success is normal — inspect `results` per id.)
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveContext, requirePermission, toErrorResponse } from '@/lib/agrovet/context'
import { BulkService } from '@/services/bulk.service'

// Map plural route segment -> internal entity + required MANAGE subject.
const MAP: Record<string, { entity: string; subject: string }> = {
  users: { entity: 'user', subject: 'USERS' },
  products: { entity: 'product', subject: 'PRODUCTS' },
  customers: { entity: 'customer', subject: 'CUSTOMERS' },
  suppliers: { entity: 'supplier', subject: 'SUPPLIERS' },
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ entity: string }> }) {
  try {
    const ctx = await resolveContext(req)
    const { entity: segment } = await params
    const mapping = MAP[segment]
    if (!mapping || !BulkService.isValidEntity(mapping.entity)) {
      return NextResponse.json({ success: false, error: 'Unknown entity. Use users|products|customers|suppliers' }, { status: 404 })
    }

    await requirePermission(ctx, 'MANAGE', mapping.subject)

    const body = await req.json().catch(() => ({}))
    const action = body.action
    if (!action || !['DELETE', 'STATUS'].includes(action)) {
      return NextResponse.json({ success: false, error: 'action must be DELETE or STATUS' }, { status: 400 })
    }
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      return NextResponse.json({ success: false, error: 'ids must be a non-empty array' }, { status: 400 })
    }
    if (body.ids.length > 500) {
      return NextResponse.json({ success: false, error: 'Too many ids (max 500 per request)' }, { status: 400 })
    }

    const ids = body.ids.map((x: any) => BigInt(x))

    let data
    if (action === 'DELETE') {
      data = await BulkService.bulkDelete(mapping.entity, ctx.organizationId, ids, ctx.userId)
    } else {
      if (!body.status) return NextResponse.json({ success: false, error: 'status is required for action=STATUS' }, { status: 400 })
      data = await BulkService.bulkStatus(mapping.entity, ctx.organizationId, ids, body.status, ctx.userId)
    }

    return NextResponse.json({ success: true, message: `Bulk ${action.toLowerCase()} processed`, data }, { status: 200 })
  } catch (error) {
    const { body, status } = toErrorResponse(error)
    return NextResponse.json({ success: false, ...body }, { status })
  }
}
