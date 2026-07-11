// @ts-nocheck
/**
 * GET /api/agrovet/pos/lookup?barcode=<code>   (exact barcode match)
 * GET /api/agrovet/pos/lookup?q=<text>&department=AGRO|VET  (name/barcode search)
 *
 * POS product lookup with live per-product stock and the agro/vet department.
 * RBAC: VIEW:PRODUCTS. Scope: organization_id (+ department filter).
 * Response: { data: [{ id, name, barcode, uom, department, selling_price, stock }] }
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveContext, requirePermission, toErrorResponse } from '@/lib/agrovet/context'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const ctx = await resolveContext(req)
    await requirePermission(ctx, 'VIEW', 'PRODUCTS')

    const url = new URL(req.url)
    const barcode = url.searchParams.get('barcode')
    const q = url.searchParams.get('q')
    const department = url.searchParams.get('department') // AGRO | VET | GENERAL
    const productId = url.searchParams.get('product_id') ?? url.searchParams.get('productId')

    const where: any = { organization_id: ctx.organizationId, deleted_at: null, status: 'ACTIVE' }
    if (department) where.department = department
    if (productId) {
      // Single-product refresh: the POS re-fetches one card's live stock
      // after a sale or cart change without reloading the whole list.
      try {
        where.id = BigInt(productId)
      } catch {
        return NextResponse.json({ success: false, error: `product_id must be a numeric ID (got "${productId}")` }, { status: 400 })
      }
    } else if (barcode) {
      where.barcode = barcode
    } else if (q) {
      where.OR = [{ name: { contains: q, mode: 'insensitive' } }, { barcode: { contains: q } }]
    }

    const products = await prisma.product.findMany({
      where,
      take: barcode ? 1 : 25,
      include: {
        ProductBatch: {
          where: { deleted_at: null, quantity_remaining: { gt: 0 } },
          select: { id: true, batch_number: true, quantity_remaining: true, selling_price: true, expiry_date: true },
          // Must match the sale's FEFO order — the price shown is the price
          // the earliest-expiry batch will actually be sold at.
          orderBy: [{ expiry_date: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
        },
        Category: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    })

    const data = products.map((p) => {
      const stock = p.ProductBatch.reduce((s, b) => s + b.quantity_remaining, 0)
      // Sell at the earliest-expiry active batch price if set, else base_price.
      const price = p.ProductBatch.length ? Number(p.ProductBatch[0].selling_price) : Number(p.base_price)
      return {
        id: p.id,
        name: p.name,
        barcode: p.barcode,
        uom: p.unit_of_measure,
        department: p.department,
        category: p.Category?.name,
        selling_price: price,
        tax_rate: p.tax_rate,
        stock,
        // Per-batch detail (FEFO order) so the POS can show batch cards and
        // send items[].batch_id — making the batch on screen the one deducted.
        batches: p.ProductBatch.map((b) => ({
          id: b.id,
          batch_number: b.batch_number,
          quantity_remaining: b.quantity_remaining,
          selling_price: b.selling_price,
          expiry_date: b.expiry_date,
        })),
      }
    })

    return NextResponse.json({ success: true, data }, { status: 200 })
  } catch (error) {
    const { body, status } = toErrorResponse(error)
    return NextResponse.json({ success: false, ...body }, { status })
  }
}
