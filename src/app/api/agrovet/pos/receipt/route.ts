// @ts-nocheck
/**
 * GET /api/agrovet/pos/receipt?sale_id=<id>
 * Returns the structured receipt payload (line items, discount, VAT, totals) plus
 * the EBM fiscal block (invoice number, QR data, signature) for printing.
 * RBAC: VIEW:OWN_SALES or VIEW:ALL_SALES. Scope: organization_id.
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveContext, toErrorResponse, ApiError } from '@/lib/agrovet/context'
import { AgrovetSaleService } from '@/services/agrovet-sale.service'
import { PermissionService } from '@/services/permission.service'

export async function GET(req: NextRequest) {
  try {
    const ctx = await resolveContext(req)
    const canAll = await PermissionService.hasPermission(ctx.userId, 'VIEW', 'ALL_SALES', ctx.organizationId)
    const canOwn = await PermissionService.hasPermission(ctx.userId, 'VIEW', 'OWN_SALES', ctx.organizationId)
    if (!canAll && !canOwn && !ctx.isSuperAdmin) throw new ApiError(403, 'Forbidden: missing permission to view sales')

    const url = new URL(req.url)
    const saleId = url.searchParams.get('sale_id')
    if (!saleId) return NextResponse.json({ success: false, error: 'sale_id is required' }, { status: 400 })

    const receipt = await AgrovetSaleService.getSaleReceipt(ctx.organizationId, BigInt(saleId))
    return NextResponse.json({ success: true, data: receipt }, { status: 200 })
  } catch (error) {
    const { body, status } = toErrorResponse(error)
    return NextResponse.json({ success: false, ...body }, { status })
  }
}
