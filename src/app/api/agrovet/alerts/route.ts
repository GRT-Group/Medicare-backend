// @ts-nocheck
/**
 * Unified alerts feed.
 *   GET /api/agrovet/alerts?type=&unread=true&targetRole=&limit=&offset=
 *          -> { data: { total, unread, items } }
 *   PATCH /api/agrovet/alerts   body: { ids: number[] }   -> mark read
 *
 * One consistent event shape for every alert type (low stock, expiry 30/7,
 * unusual discount, large/voided sale, overdue credit). RBAC: VIEW:BRANCH_DASHBOARD.
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveContext, requirePermission, toErrorResponse } from '@/lib/agrovet/context'
import { AlertService } from '@/services/alert.service'

export async function GET(req: NextRequest) {
  try {
    const ctx = await resolveContext(req)
    await requirePermission(ctx, 'VIEW', 'BRANCH_DASHBOARD')

    const url = new URL(req.url)
    const data = await AlertService.list(ctx.organizationId, {
      type: url.searchParams.get('type') || undefined,
      unreadOnly: url.searchParams.get('unread') === 'true',
      targetRole: url.searchParams.get('targetRole') || undefined,
      limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
      offset: url.searchParams.get('offset') ? Number(url.searchParams.get('offset')) : undefined,
    })
    return NextResponse.json({ success: true, data }, { status: 200 })
  } catch (error) {
    const { body, status } = toErrorResponse(error)
    return NextResponse.json({ success: false, ...body }, { status })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await resolveContext(req)
    await requirePermission(ctx, 'VIEW', 'BRANCH_DASHBOARD')

    const body = await req.json().catch(() => ({}))
    if (!Array.isArray(body.ids) || !body.ids.length) {
      return NextResponse.json({ success: false, error: 'ids array is required' }, { status: 400 })
    }
    const result = await AlertService.markRead(ctx.organizationId, body.ids.map((x: any) => BigInt(x)))
    return NextResponse.json({ success: true, message: `${result.count} alert(s) marked read` }, { status: 200 })
  } catch (error) {
    const { body, status } = toErrorResponse(error)
    return NextResponse.json({ success: false, ...body }, { status })
  }
}
