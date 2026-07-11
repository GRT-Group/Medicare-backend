import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { storeFile } from '@/lib/file-storage'

export type InvoiceLineItem = {
  productName: string
  quantity: number
  unitCost: string | number
  lineTotal: string | number
}

export type InvoicePdfInput = {
  poNumber: string
  createdAt: Date
  expectedDeliveryDate?: Date | null
  totalAmount: string | number
  organization: { name: string; phone?: string | null; email?: string | null; address?: string | null }
  supplier: { name: string; phone?: string | null; email?: string | null; address?: string | null }
  items: InvoiceLineItem[]
}

const PAGE_WIDTH = 595.28 // A4 in points
const PAGE_HEIGHT = 841.89
const MARGIN = 50

/**
 * Renders a purchase order invoice as an actual PDF file (not just JSON) and
 * uploads it via storeFile, so PurchaseOrder.invoice_document_url points to
 * a real downloadable document — matching the pattern of every other
 * file-backed field in this codebase (Organization.logo_url, receipt
 * uploads), rather than requiring the frontend to render the invoice itself.
 */
export class InvoicePdfService {
  static async generateAndStore(purchaseOrderId: string, input: InvoicePdfInput): Promise<{ url: string; buffer: Buffer }> {
    const pdfDoc = await PDFDocument.create()
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

    let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    let y = PAGE_HEIGHT - MARGIN

    const teal = rgb(0x14 / 255, 0xa3 / 255, 0x9a / 255)
    const gray = rgb(0.4, 0.45, 0.5)
    const black = rgb(0.1, 0.1, 0.1)

    const draw = (text: string, x: number, size: number, f = font, color = black) => {
      page.drawText(text, { x, y, size, font: f, color })
    }
    const newLine = (gap = 16) => { y -= gap }
    const ensureSpace = (needed: number) => {
      if (y - needed < MARGIN) {
        page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
        y = PAGE_HEIGHT - MARGIN
      }
    }

    // Header
    draw('PURCHASE ORDER INVOICE', MARGIN, 22, bold, teal)
    newLine(30)
    draw(`Invoice / PO Number: ${input.poNumber}`, MARGIN, 11, bold)
    newLine(16)
    draw(`Date: ${input.createdAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, MARGIN, 11, font, gray)
    if (input.expectedDeliveryDate) {
      newLine(16)
      draw(`Expected Delivery: ${input.expectedDeliveryDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, MARGIN, 11, font, gray)
    }
    newLine(30)

    // Issued by / Billed to
    const colWidth = (PAGE_WIDTH - MARGIN * 2) / 2
    draw('Issued By', MARGIN, 11, bold, teal)
    draw('Billed To (Supplier)', MARGIN + colWidth, 11, bold, teal)
    newLine(16)
    draw(input.organization.name, MARGIN, 11, bold)
    draw(input.supplier.name, MARGIN + colWidth, 11, bold)
    newLine(15)
    if (input.organization.phone) { draw(input.organization.phone, MARGIN, 10, font, gray) }
    if (input.supplier.phone) { draw(input.supplier.phone, MARGIN + colWidth, 10, font, gray) }
    newLine(14)
    if (input.organization.email) { draw(input.organization.email, MARGIN, 10, font, gray) }
    if (input.supplier.email) { draw(input.supplier.email, MARGIN + colWidth, 10, font, gray) }
    newLine(14)
    if (input.organization.address) { draw(input.organization.address, MARGIN, 10, font, gray) }
    if (input.supplier.address) { draw(input.supplier.address, MARGIN + colWidth, 10, font, gray) }
    newLine(30)

    // Item table header
    const colProduct = MARGIN
    const colQty = MARGIN + 260
    const colUnit = MARGIN + 340
    const colTotal = MARGIN + 440
    draw('Product', colProduct, 11, bold)
    draw('Qty', colQty, 11, bold)
    draw('Unit Cost', colUnit, 11, bold)
    draw('Total', colTotal, 11, bold)
    newLine(6)
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 1, color: rgb(0.85, 0.85, 0.85) })
    newLine(16)

    for (const item of input.items) {
      ensureSpace(20)
      draw(item.productName, colProduct, 10)
      draw(String(item.quantity), colQty, 10)
      draw(String(item.unitCost), colUnit, 10)
      draw(String(item.lineTotal), colTotal, 10)
      newLine(18)
    }

    newLine(6)
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 1, color: rgb(0.85, 0.85, 0.85) })
    newLine(22)

    draw('Total', colUnit, 13, bold)
    draw(String(input.totalAmount), colTotal, 13, bold, teal)

    const pdfBytes = await pdfDoc.save()
    const buffer = Buffer.from(pdfBytes)
    const filename = `invoice-${purchaseOrderId}-${Date.now()}.pdf`
    const { url } = await storeFile('purchase-invoices', filename, buffer, 'application/pdf')
    return { url, buffer }
  }
}
