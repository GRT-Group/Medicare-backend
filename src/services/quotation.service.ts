// @ts-nocheck
import { prisma } from '@/lib/prisma';

export class QuotationService {
  static async getQuotations(organizationId: bigint) {
    return prisma.quotation.findMany({
      where: { organization_id: organizationId, deleted_at: null },
      include: {
        items: {
          include: { Product: true }
        },
        Customer: true
      },
      orderBy: { id: 'desc' }
    });
  }

  static async createQuotation(organizationId: bigint, data: {
    customer_id?: bigint;
    branch_id: bigint;
    validity_date?: Date;
    items: {
      product_id: bigint;
      quantity: number;
      unit_price: number;
    }[];
  }, adminId: bigint) {
    return prisma.$transaction(async (tx) => {
      let totalAmount = 0;
      
      // Calculate total
      for (const item of data.items) {
        totalAmount += (item.quantity * item.unit_price);
      }

      // Create Quotation
      const quotation = await tx.quotation.create({
        data: {
          organization_id: organizationId,
          branch_id: data.branch_id,
          customer_id: data.customer_id,
          total_amount: totalAmount,
          validity_date: data.validity_date,
          status: 'DRAFT',
          quotation_number: `QT-${Date.now()}`,
          created_by_id: adminId
        }
      });

      // Create Items
      for (const item of data.items) {
        await tx.quotationItem.create({
          data: {
            quotation_id: quotation.id,
            product_id: item.product_id,
            quantity: item.quantity,
            unit_price: item.unit_price,
            subtotal: item.quantity * item.unit_price
          }
        });
      }

      return quotation;
    });
  }

  static async updateQuotationStatus(id: bigint, organizationId: bigint, status: string) {
    const existing = await prisma.quotation.findFirst({ where: { id, organization_id: organizationId } });
    if (!existing) throw new Error('Quotation not found');

    return prisma.quotation.update({
      where: { id },
      data: { status: status as any }
    });
  }

  static async convertToSale(id: bigint, organizationId: bigint, adminId: bigint, paymentMethod: string, amountPaid?: number) {
    return prisma.$transaction(async (tx) => {
      const quotation = await tx.quotation.findFirstOrThrow({
        where: { id, organization_id: organizationId },
        include: { items: true }
      });

      if (quotation.status === 'CONVERTED') {
        throw new Error('Quotation is already converted');
      }

      // Call SaleService inside transaction logic (simulated by instantiating the module logic)
      const { SaleService } = await import('@/services/sale.service');
      const saleData = {
        customer_id: quotation.customer_id || undefined,
        branch_id: quotation.branch_id!,
        payment_method: paymentMethod,
        amount_paid: amountPaid,
        items: quotation.items.map(item => ({
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: Number(item.unit_price)
        }))
      };

      // Create sale (this handles stock deduction and customer balances)
      const sale = await SaleService.processSale(organizationId, saleData, adminId);

      // Update Quotation Status
      await tx.quotation.update({
        where: { id },
        data: { status: 'CONVERTED' }
      });

      return sale;
    });
  }

  static async deleteQuotation(id: bigint, organizationId: bigint, adminId: bigint) {
    const { ArchiveService } = await import('@/services/archive.service');
    return ArchiveService.softDelete(organizationId, 'quotation', id, adminId);
  }
}
