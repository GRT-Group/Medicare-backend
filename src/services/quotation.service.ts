// @ts-nocheck
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';
import { badRequest } from '@/lib/api-error';

/**
 * Valid status transitions for quotation workflow.
 * Each key is the current status, values are the statuses it can move to.
 */
const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT:     ['SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED'],
  SENT:      ['ACCEPTED', 'REJECTED', 'EXPIRED', 'DRAFT'],
  ACCEPTED:  ['CONVERTED', 'REJECTED'],
  REJECTED:  ['DRAFT'],
  EXPIRED:   ['DRAFT'],
  CONVERTED: [],  // terminal — no further transitions
};

/** Generate a unique 8-char hex quotation number like QT-A3F8B12C */
function generateQuotationNumber(): string {
  return `QT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

export class QuotationService {

  // ─── LIST ───────────────────────────────────────────────────────────
  static async getQuotations(organizationId: bigint) {
    return prisma.quotation.findMany({
      where: {
        organization_id: organizationId,
        is_deleted: false,
        deleted_at: null,
      },
      include: {
        items: {
          where: { is_deleted: false },
          include: { Product: true },
        },
        Customer: true,
        Supplier: true,
      },
      orderBy: { id: 'desc' },
    });
  }

  // ─── GET ONE ────────────────────────────────────────────────────────
  static async getQuotationById(id: bigint, organizationId: bigint) {
    const quotation = await prisma.quotation.findFirst({
      where: {
        id,
        organization_id: organizationId,
        is_deleted: false,
        deleted_at: null,
      },
      include: {
        items: {
          where: { is_deleted: false },
          include: { Product: true },
        },
        Customer: true,
        Supplier: true,
      },
    });

    if (!quotation) throw badRequest('Quotation not found');
    return quotation;
  }

  // ─── CREATE ─────────────────────────────────────────────────────────
  static async createQuotation(
    organizationId: bigint,
    data: {
      type?: string;
      customer_id?: bigint;
      supplier_id?: bigint;
      customer_name?: string;
      customer_email?: string;
      customer_phone?: string;
      notes?: string;
      branch_id?: bigint;
      validity_date?: string | Date;
      discount_amount?: number;
      items: {
        product_id: bigint;
        quantity: number;
        unit_price: number;
        line_discount?: number;
        tax_rate?: number;
      }[];
    },
    adminId: bigint
  ) {
    if (!data.items || data.items.length === 0) {
      throw badRequest('At least one item is required.');
    }

    const quotationType = data.type || 'SALES';

    if (quotationType === 'PURCHASE' && !data.supplier_id) {
      throw badRequest('supplier_id is required for PURCHASE quotations.');
    }

    return prisma.$transaction(async (tx) => {
      // Calculate line totals
      let subtotal = 0;
      let taxAmount = 0;
      let lineDiscountTotal = 0;

      const computedItems = data.items.map((item) => {
        const lineGross = item.quantity * item.unit_price;
        const lineDiscount = item.line_discount || 0;
        const lineSub = lineGross - lineDiscount;
        const lineTax = lineSub * (item.tax_rate || 0);

        subtotal += lineSub;
        taxAmount += lineTax;
        lineDiscountTotal += lineDiscount;

        return { ...item, lineSub, lineTax, lineDiscount };
      });

      // Header-level discount (e.g. the "Discount" field in the UI)
      const headerDiscount = data.discount_amount || 0;
      const totalDiscount = lineDiscountTotal + headerDiscount;
      const totalAmount = subtotal + taxAmount - headerDiscount;

      // Generate unique quotation number with retry on collision
      let quotationNumber = generateQuotationNumber();
      let collision = await tx.quotation.findUnique({ where: { quotation_number: quotationNumber } });
      let retries = 0;
      while (collision && retries < 5) {
        quotationNumber = generateQuotationNumber();
        collision = await tx.quotation.findUnique({ where: { quotation_number: quotationNumber } });
        retries++;
      }
      if (collision) {
        throw new Error('Unable to generate unique quotation number. Please try again.');
      }

      // Create the quotation
      const quotation = await tx.quotation.create({
        data: {
          organization_id: organizationId,
          branch_id: data.branch_id,
          type: quotationType as any,
          customer_id: data.customer_id,
          supplier_id: data.supplier_id,
          customer_name: data.customer_name,
          customer_email: data.customer_email,
          customer_phone: data.customer_phone,
          notes: data.notes,
          subtotal,
          tax_amount: taxAmount,
          discount_amount: totalDiscount,
          total_amount: totalAmount,
          validity_date: data.validity_date ? new Date(data.validity_date) : null,
          status: 'DRAFT',
          quotation_number: quotationNumber,
          created_by_id: adminId,
        },
      });

      // Create items
      for (const item of computedItems) {
        await tx.quotationItem.create({
          data: {
            quotation_id: quotation.id,
            product_id: item.product_id,
            quantity: item.quantity,
            unit_price: item.unit_price,
            subtotal: item.lineSub,
            tax_amount: item.lineTax,
            discount_amount: item.lineDiscount,
          },
        });
      }

      // Return with items included
      return tx.quotation.findFirst({
        where: { id: quotation.id },
        include: {
          items: { include: { Product: true } },
          Customer: true,
          Supplier: true,
        },
      });
    });
  }

  // ─── UPDATE ─────────────────────────────────────────────────────────
  static async updateQuotation(
    id: bigint,
    organizationId: bigint,
    data: {
      customer_id?: bigint | null;
      supplier_id?: bigint | null;
      customer_name?: string;
      customer_email?: string;
      customer_phone?: string;
      notes?: string;
      branch_id?: bigint;
      validity_date?: string | Date | null;
      discount_amount?: number;
      items?: {
        product_id: bigint;
        quantity: number;
        unit_price: number;
        line_discount?: number;
        tax_rate?: number;
      }[];
    },
    adminId: bigint
  ) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.quotation.findFirst({
        where: { id, organization_id: organizationId, is_deleted: false },
      });

      if (!existing) throw badRequest('Quotation not found.');

      // Only DRAFT and SENT quotations can be edited
      if (!['DRAFT', 'SENT'].includes(existing.status)) {
        throw badRequest(`Cannot edit a quotation with status ${existing.status}.`);
      }

      // Recalculate totals if items are provided
      let updateData: any = {
        customer_id: data.customer_id,
        supplier_id: data.supplier_id,
        customer_name: data.customer_name,
        customer_email: data.customer_email,
        customer_phone: data.customer_phone,
        notes: data.notes,
        branch_id: data.branch_id,
        validity_date: data.validity_date ? new Date(data.validity_date) : data.validity_date,
      };

      // Remove undefined keys so we don't overwrite existing values with null
      Object.keys(updateData).forEach(
        (key) => updateData[key] === undefined && delete updateData[key]
      );

      if (data.items && data.items.length > 0) {
        let subtotal = 0;
        let taxAmount = 0;
        let lineDiscountTotal = 0;

        const computedItems = data.items.map((item) => {
          const lineGross = item.quantity * item.unit_price;
          const lineDiscount = item.line_discount || 0;
          const lineSub = lineGross - lineDiscount;
          const lineTax = lineSub * (item.tax_rate || 0);

          subtotal += lineSub;
          taxAmount += lineTax;
          lineDiscountTotal += lineDiscount;

          return { ...item, lineSub, lineTax, lineDiscount };
        });

        const headerDiscount = data.discount_amount || 0;
        const totalDiscount = lineDiscountTotal + headerDiscount;
        const totalAmount = subtotal + taxAmount - headerDiscount;

        updateData = {
          ...updateData,
          subtotal,
          tax_amount: taxAmount,
          discount_amount: totalDiscount,
          total_amount: totalAmount,
        };

        // Soft-delete old items
        await tx.quotationItem.updateMany({
          where: { quotation_id: id, is_deleted: false },
          data: { is_deleted: true, deleted_at: new Date(), deleted_by_id: adminId },
        });

        // Create new items
        for (const item of computedItems) {
          await tx.quotationItem.create({
            data: {
              quotation_id: id,
              product_id: item.product_id,
              quantity: item.quantity,
              unit_price: item.unit_price,
              subtotal: item.lineSub,
              tax_amount: item.lineTax,
              discount_amount: item.lineDiscount,
            },
          });
        }
      }

      await tx.quotation.update({
        where: { id },
        data: updateData,
      });

      return tx.quotation.findFirst({
        where: { id },
        include: {
          items: { where: { is_deleted: false }, include: { Product: true } },
          Customer: true,
          Supplier: true,
        },
      });
    });
  }

  // ─── STATUS UPDATE ──────────────────────────────────────────────────
  static async updateQuotationStatus(
    id: bigint,
    organizationId: bigint,
    status: string
  ) {
    const existing = await prisma.quotation.findFirst({
      where: { id, organization_id: organizationId, is_deleted: false },
    });

    if (!existing) throw badRequest('Quotation not found.');

    const allowed = VALID_TRANSITIONS[existing.status] || [];
    if (!allowed.includes(status)) {
      throw badRequest(
        `Cannot change status from ${existing.status} to ${status}. Allowed: ${allowed.join(', ') || 'none'}.`
      );
    }

    return prisma.quotation.update({
      where: { id },
      data: { status: status as any },
      include: {
        items: { where: { is_deleted: false }, include: { Product: true } },
        Customer: true,
        Supplier: true,
      },
    });
  }

  // ─── SEND (mark as SENT + email customer) ───────────────────────────
  static async sendQuotation(
    id: bigint,
    organizationId: bigint,
    adminId: bigint
  ) {
    const quotation = await prisma.quotation.findFirst({
      where: { id, organization_id: organizationId, is_deleted: false },
      include: {
        items: { where: { is_deleted: false }, include: { Product: true } },
        Organization: true,
      },
    });

    if (!quotation) throw badRequest('Quotation not found.');

    if (quotation.status !== 'DRAFT' && quotation.status !== 'SENT') {
      throw badRequest(`Cannot send a quotation with status ${quotation.status}.`);
    }

    // Update status to SENT
    const updated = await prisma.quotation.update({
      where: { id },
      data: { status: 'SENT' },
      include: {
        items: { where: { is_deleted: false }, include: { Product: true } },
        Customer: true,
        Supplier: true,
      },
    });

    // Email the customer if an email is available
    const recipientEmail = quotation.customer_email;
    if (recipientEmail) {
      const { EmailService } = await import('@/services/email.service');
      const orgName = quotation.Organization?.name || 'Medicare System';
      const itemsHtml = quotation.items
        .map(
          (item: any) =>
            `<tr>
              <td style="padding:8px;border:1px solid #ddd;">${item.Product?.name || 'Product'}</td>
              <td style="padding:8px;border:1px solid #ddd;text-align:center;">${item.quantity}</td>
              <td style="padding:8px;border:1px solid #ddd;text-align:right;">RF ${Number(item.unit_price).toLocaleString()}</td>
              <td style="padding:8px;border:1px solid #ddd;text-align:right;">RF ${Number(item.subtotal).toLocaleString()}</td>
            </tr>`
        )
        .join('');

      const html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#1a56db;">Quotation from ${orgName}</h2>
          <p>Dear ${quotation.customer_name || 'Customer'},</p>
          <p>Please find your quotation <strong>${quotation.quotation_number}</strong> below:</p>
          
          <table style="width:100%;border-collapse:collapse;margin:20px 0;">
            <thead>
              <tr style="background:#f3f4f6;">
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">Product</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:center;">Qty</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:right;">Unit Price</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:right;">Subtotal</th>
              </tr>
            </thead>
            <tbody>${itemsHtml}</tbody>
          </table>

          <div style="margin:20px 0;padding:15px;background:#f9fafb;border-radius:8px;">
            <p style="margin:4px 0;"><strong>Subtotal:</strong> RF ${Number(quotation.subtotal).toLocaleString()}</p>
            <p style="margin:4px 0;"><strong>Tax:</strong> RF ${Number(quotation.tax_amount).toLocaleString()}</p>
            ${Number(quotation.discount_amount) > 0 ? `<p style="margin:4px 0;"><strong>Discount:</strong> -RF ${Number(quotation.discount_amount).toLocaleString()}</p>` : ''}
            <p style="margin:4px 0;font-size:18px;"><strong>Total: RF ${Number(quotation.total_amount).toLocaleString()}</strong></p>
          </div>

          ${quotation.validity_date ? `<p><strong>Valid until:</strong> ${new Date(quotation.validity_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>` : ''}
          ${quotation.notes ? `<p><strong>Notes:</strong> ${quotation.notes}</p>` : ''}
          
          <p style="color:#6b7280;font-size:12px;margin-top:30px;">This quotation was generated by ${orgName} via Medicare System.</p>
        </div>
      `;

      const text = `Quotation ${quotation.quotation_number} — Total: RF ${Number(quotation.total_amount).toLocaleString()}`;
      EmailService.sendEmail(recipientEmail, `Quotation ${quotation.quotation_number} from ${orgName}`, html, text).catch(console.error);
    }

    return updated;
  }

  // ─── DUPLICATE ──────────────────────────────────────────────────────
  static async duplicateQuotation(
    id: bigint,
    organizationId: bigint,
    adminId: bigint
  ) {
    const original = await prisma.quotation.findFirst({
      where: { id, organization_id: organizationId, is_deleted: false },
      include: {
        items: { where: { is_deleted: false } },
      },
    });

    if (!original) throw badRequest('Quotation not found.');

    return prisma.$transaction(async (tx) => {
      let quotationNumber = generateQuotationNumber();
      let collision = await tx.quotation.findUnique({ where: { quotation_number: quotationNumber } });
      let retries = 0;
      while (collision && retries < 5) {
        quotationNumber = generateQuotationNumber();
        collision = await tx.quotation.findUnique({ where: { quotation_number: quotationNumber } });
        retries++;
      }

      const clone = await tx.quotation.create({
        data: {
          organization_id: organizationId,
          branch_id: original.branch_id,
          type: original.type,
          customer_id: original.customer_id,
          supplier_id: original.supplier_id,
          customer_name: original.customer_name,
          customer_email: original.customer_email,
          customer_phone: original.customer_phone,
          notes: original.notes,
          subtotal: original.subtotal,
          tax_amount: original.tax_amount,
          discount_amount: original.discount_amount,
          total_amount: original.total_amount,
          validity_date: null, // reset validity so user must set a new one
          status: 'DRAFT',
          quotation_number: quotationNumber,
          created_by_id: adminId,
        },
      });

      for (const item of original.items) {
        await tx.quotationItem.create({
          data: {
            quotation_id: clone.id,
            product_id: item.product_id,
            quantity: item.quantity,
            unit_price: item.unit_price,
            subtotal: item.subtotal,
            tax_amount: item.tax_amount,
            discount_amount: item.discount_amount,
          },
        });
      }

      return tx.quotation.findFirst({
        where: { id: clone.id },
        include: {
          items: { include: { Product: true } },
          Customer: true,
          Supplier: true,
        },
      });
    });
  }

  // ─── CONVERT TO SALE ────────────────────────────────────────────────
  static async convertToSale(
    id: bigint,
    organizationId: bigint,
    adminId: bigint,
    paymentMethod: string,
    amountPaid?: number
  ) {
    return prisma.$transaction(async (tx) => {
      const quotation = await tx.quotation.findFirst({
        where: { id, organization_id: organizationId, is_deleted: false },
        include: { items: { where: { is_deleted: false } } },
      });

      if (!quotation) throw badRequest('Quotation not found.');

      if (quotation.status === 'CONVERTED') {
        throw badRequest('This quotation has already been converted to a sale.');
      }
      if (quotation.status === 'REJECTED') {
        throw badRequest('Cannot convert a rejected quotation. Reopen it first.');
      }

      if (!paymentMethod) {
        throw badRequest('payment_method is required to convert a quotation to a sale.');
      }

      const { SaleService } = await import('@/services/sale.service');
      const saleData = {
        customer_id: quotation.customer_id || undefined,
        branch_id: quotation.branch_id!,
        payment_method: paymentMethod,
        amount_paid: amountPaid,
        items: quotation.items.map((item) => ({
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: Number(item.unit_price),
        })),
      };

      const sale = await SaleService.processSale(organizationId, saleData, adminId);

      await tx.quotation.update({
        where: { id },
        data: { status: 'CONVERTED' },
      });

      return sale;
    });
  }

  // ─── STATS ──────────────────────────────────────────────────────────
  static async getQuotationStats(organizationId: bigint) {
    const quotations = await prisma.quotation.findMany({
      where: { organization_id: organizationId, is_deleted: false },
      select: {
        status: true,
        total_amount: true,
      },
    });

    const total = quotations.length;
    const byStatus: Record<string, { count: number; value: number }> = {
      DRAFT: { count: 0, value: 0 },
      SENT: { count: 0, value: 0 },
      ACCEPTED: { count: 0, value: 0 },
      REJECTED: { count: 0, value: 0 },
      EXPIRED: { count: 0, value: 0 },
      CONVERTED: { count: 0, value: 0 },
    };

    let totalValue = 0;

    for (const q of quotations) {
      const amount = Number(q.total_amount);
      totalValue += amount;
      if (byStatus[q.status]) {
        byStatus[q.status].count++;
        byStatus[q.status].value += amount;
      }
    }

    const acceptedCount = byStatus.ACCEPTED.count + byStatus.CONVERTED.count;
    const conversionRate = total > 0 ? Math.round((acceptedCount / total) * 100) : 0;

    // Pipeline = DRAFT + SENT (active, not yet resolved)
    const pipelineCount = byStatus.DRAFT.count + byStatus.SENT.count;
    const pipelineValue = byStatus.DRAFT.value + byStatus.SENT.value;

    return {
      total,
      total_value: totalValue,
      accepted_value: byStatus.ACCEPTED.value + byStatus.CONVERTED.value,
      conversion_rate: conversionRate,
      pipeline_count: pipelineCount,
      pipeline_value: pipelineValue,
      by_status: {
        draft:     byStatus.DRAFT.count,
        sent:      byStatus.SENT.count,
        accepted:  byStatus.ACCEPTED.count,
        rejected:  byStatus.REJECTED.count,
        expired:   byStatus.EXPIRED.count,
        converted: byStatus.CONVERTED.count,
      },
    };
  }

  // ─── SOFT DELETE ────────────────────────────────────────────────────
  static async deleteQuotation(
    id: bigint,
    organizationId: bigint,
    adminId: bigint
  ) {
    const existing = await prisma.quotation.findFirst({
      where: { id, organization_id: organizationId, is_deleted: false },
    });

    if (!existing) throw badRequest('Quotation not found.');

    // Don't delete converted quotations — they are linked to a sale
    if (existing.status === 'CONVERTED') {
      throw badRequest('Cannot delete a converted quotation. It is linked to a sale.');
    }

    return prisma.quotation.update({
      where: { id },
      data: {
        is_deleted: true,
        deleted_at: new Date(),
        deleted_by_id: adminId,
      },
    });
  }
}
