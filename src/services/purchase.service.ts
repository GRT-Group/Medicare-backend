// @ts-nocheck
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { InventoryService } from '@/services/inventory.service';
import { EmailService } from '@/services/email.service';
import { InvoicePdfService } from '@/services/invoice-pdf.service';

export class PurchaseService {
  // ==============================================
  // SUPPLIERS
  // ==============================================
  
  static async getSuppliers(organizationId: bigint) {
    return prisma.supplier.findMany({
      where: { organization_id: organizationId, deleted_at: null },
      orderBy: { name: 'asc' }
    });
  }

  /**
   * Next sequential supplier_code, formatted "SUP-000001". Global (not
   * per-org), matching the customer_code scheme, so it stays collision-free
   * under the table-wide unique index.
   */
  static async nextSupplierCode(): Promise<string> {
    const last = await prisma.supplier.findFirst({
      where: { supplier_code: { not: null } },
      orderBy: { supplier_code: 'desc' },
      select: { supplier_code: true },
    });
    const lastNumber = last?.supplier_code ? parseInt(last.supplier_code.replace('SUP-', ''), 10) : 0;
    return `SUP-${String(lastNumber + 1).padStart(6, '0')}`;
  }

  /**
   * The frontend supplier form sends camelCase keys (contactPerson, taxId,
   * registrationNumber, preferredPaymentMethod, ...) but every DB column is
   * snake_case — without this mapping, Prisma silently rejects the whole
   * payload (unknown argument) and NOTHING gets saved. This also accepts
   * snake_case directly (for older/API-only callers) and coerces empty
   * strings on numeric fields to undefined so "" doesn't fail a Decimal/Int
   * column cast.
   */
  static readonly SUPPLIER_FIELD_MAP: Record<string, string> = {
    contactPerson: 'contact_person',
    contactPersonPhone: 'contact_person_phone',
    registrationNumber: 'registration_number',
    taxId: 'tax_id',
    nationalId: 'national_id',
    contactInfo: 'contact_info',
    paymentTerms: 'payment_terms',
    supplierType: 'supplier_type',
    approvalStatus: 'approval_status',
    riskLevel: 'risk_level',
    lastContactedAt: 'last_contacted_at',
    lastOrderDate: 'last_order_date',
    outstandingBalance: 'outstanding_balance',
    businessCategory: 'business_category',
    companySize: 'company_size',
    experienceLevel: 'experience_level',
    preferredPaymentMethod: 'preferred_payment_method',
    creditLimit: 'credit_limit',
    leadTimeDays: 'lead_time_days',
    minimumOrderValue: 'minimum_order_value',
    deliveryAvailability: 'delivery_availability',
    internalNotes: 'internal_notes',
  };

  private static readonly SUPPLIER_NUMERIC_FIELDS = new Set([
    'credit_limit', 'lead_time_days', 'minimum_order_value', 'outstanding_balance'
  ]);

  private static readonly SUPPLIER_KNOWN_COLUMNS = new Set([
    'name', 'supplier_type', 'phone', 'email', 'address', 'tax_id', 'contact_person',
    'contact_person_phone', 'registration_number', 'national_id', 'notes', 'contact_info',
    'payment_terms', 'status', 'approval_status', 'risk_level', 'last_contacted_at',
    'last_order_date', 'outstanding_balance', 'country', 'business_category', 'company_size',
    'website', 'specialization', 'experience_level', 'preferred_payment_method', 'currency',
    'credit_limit', 'lead_time_days', 'minimum_order_value', 'delivery_availability', 'internal_notes'
  ]);

  static normalizeSupplierPayload(data: Record<string, any>): Record<string, any> {
    const normalized: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      const column = this.SUPPLIER_FIELD_MAP[key] || key;
      if (!this.SUPPLIER_KNOWN_COLUMNS.has(column)) continue; // drop anything with no matching column

      if (this.SUPPLIER_NUMERIC_FIELDS.has(column)) {
        normalized[column] = value === '' || value === null || value === undefined ? undefined : Number(value);
      } else if (value === '') {
        normalized[column] = null; // empty string from a form field means "clear this", not literal ""
      } else {
        normalized[column] = value;
      }
    }
    return normalized;
  }

  /**
   * Validates the type-specific shape of a supplier payload.
   * - Both types: name required; phone required unless the caller is a
   *   legacy client still sending only the free-text contact_info blob.
   * - COMPANY: name is the company name; contact_person/registration_number
   *   are its structured extras.
   * - INDIVIDUAL: name is the person's full name; national_id is its extra.
   */
  static validateSupplierPayload(data: any, { creating = false } = {}) {
    if (data.supplier_type !== undefined && !['COMPANY', 'INDIVIDUAL'].includes(data.supplier_type)) {
      throw new Error('supplier_type must be one of: COMPANY, INDIVIDUAL');
    }
    if (creating) {
      if (!data.name) throw new Error('name is required');
      if (!data.phone && !data.contact_info) throw new Error('phone is required');
    }
  }

  static async createSupplier(organizationId: bigint, rawData: Record<string, any>, adminId?: bigint) {
    const data = this.normalizeSupplierPayload(rawData);
    this.validateSupplierPayload(data, { creating: true });

    const supplierCode = await this.nextSupplierCode();

    return prisma.supplier.create({
      data: {
        ...data,
        organization_id: organizationId,
        supplier_code: supplierCode,
        supplier_type: data.supplier_type || 'COMPANY',
        approval_status: data.approval_status || 'APPROVED',
        risk_level: data.risk_level || 'LOW',
        created_by_id: adminId
      }
    });
  }

  static async updateSupplier(id: bigint, organizationId: bigint, rawData: Record<string, any>) {
    const existing = await prisma.supplier.findFirst({ where: { id, organization_id: organizationId } });
    if (!existing) throw new Error('Supplier not found');

    const data = this.normalizeSupplierPayload(rawData);
    this.validateSupplierPayload(data);

    return prisma.supplier.update({
      where: { id },
      data
    });
  }

  static async deleteSupplier(id: bigint, organizationId: bigint, adminId: bigint) {
    const { ArchiveService } = await import('@/services/archive.service');
    return ArchiveService.softDelete(organizationId, 'supplier', id, adminId);
  }

  static async getSupplierById(id: bigint, organizationId: bigint) {
    const supplier = await prisma.supplier.findFirst({
      where: { id, organization_id: organizationId, deleted_at: null }
    });
    if (!supplier) throw new Error('Supplier not found');
    return supplier;
  }

  // ==============================================
  // PURCHASE ORDERS
  // ==============================================

  static async getPurchaseOrders(
    organizationId: bigint,
    supplierId?: bigint,
    dateRange?: { from?: Date; to?: Date }
  ) {
    const orders = await prisma.purchaseOrder.findMany({
      where: {
        organization_id: organizationId,
        deleted_at: null,
        ...(supplierId ? { supplier_id: supplierId } : {}),
        ...(dateRange?.from || dateRange?.to ? {
          updated_at: {
            ...(dateRange.from ? { gte: dateRange.from } : {}),
            ...(dateRange.to ? { lte: dateRange.to } : {})
          }
        } : {})
      },
      include: {
        Supplier: true,
        PurchaseOrderItem: {
          where: { deleted_at: null },
          include: { Product: true }
        }
      },
      orderBy: { id: 'desc' }
    });

    return orders.map(({ Supplier, PurchaseOrderItem, ...po }) => ({
      ...po,
      supplier: Supplier,
      items: PurchaseOrderItem.map(({ Product, ...item }) => ({ ...item, product: Product }))
    }));
  }

  /**
   * Invoices for purchase orders on a specific calendar date (or date
   * range), optionally scoped to one supplier — "what did we invoice/get
   * invoiced on this day." Returns the same structured invoice shape as
   * getPurchaseOrderInvoice (poNumber, totals, items, invoiceDocumentUrl)
   * for each matching PO, so the frontend can list+link every invoice for
   * that day without a separate call per PO.
   */
  static async getInvoicesByDate(
    organizationId: bigint,
    date: Date,
    supplierId?: bigint
  ) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const orders = await this.getPurchaseOrders(organizationId, supplierId, { from: startOfDay, to: endOfDay });

    return Promise.all(
      orders.map((po) => this.getPurchaseOrderInvoice(po.id, organizationId))
    );
  }

  /**
   * Everything a supplier detail page needs: the supplier record, every
   * purchase order ever raised with them (newest first), and a rollup
   * summary (counts by status, lifetime spend, last order date) so the
   * frontend doesn't have to recompute it from the list every time.
   */
  static async getSupplierPurchaseHistory(supplierId: bigint, organizationId: bigint) {
    const supplier = await this.getSupplierById(supplierId, organizationId);
    const orders = await this.getPurchaseOrders(organizationId, supplierId);

    const summary = {
      totalOrders: orders.length,
      pendingOrders: orders.filter((o) => o.status === 'PENDING').length,
      receivedOrders: orders.filter((o) => o.status === 'RECEIVED').length,
      cancelledOrders: orders.filter((o) => o.status === 'CANCELLED_PO').length,
      totalSpend: orders
        .filter((o) => o.status === 'RECEIVED')
        .reduce((sum, o) => sum + Number(o.total_amount), 0)
        .toFixed(2),
      lastOrderDate: orders[0]?.updated_at ?? null
    };

    return { supplier, summary, purchaseOrders: orders };
  }

  static async createPurchaseOrder(organizationId: bigint, data: {
    supplier_id: bigint;
    total_amount: number;
    expected_delivery_date?: Date | string;
    items: {
      product_id: bigint;
      expected_quantity: number;
      unit_cost: number;
    }[];
  }, adminId: bigint) {
    const po = await prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.create({
        data: {
          organization_id: organizationId,
          supplier_id: data.supplier_id,
          total_amount: data.total_amount,
          expected_delivery_date: data.expected_delivery_date ? new Date(data.expected_delivery_date) : undefined,
          status: 'PENDING',
          created_by_id: adminId
        }
      });

      for (const item of data.items) {
        await tx.purchaseOrderItem.create({
          data: {
            purchase_order_id: po.id,
            product_id: item.product_id,
            expected_quantity: item.expected_quantity,
            unit_cost: item.unit_cost
          }
        });
      }

      return po;
    }, { timeout: 20000, maxWait: 10000 });

    // Email the supplier with the PO details. Never let a Resend outage or a
    // supplier with no email on file fail the purchase order itself — this
    // runs after the transaction has already committed, fire-and-forget,
    // matching the rest of the codebase's email conventions (e.g.
    // CustomerNotifyService, auth.service.ts's welcome email).
    this.notifySupplierOfPurchaseOrder(po.id, organizationId).catch((err) =>
      console.error(`[PO EMAIL FAILED] purchase order ${po.id}:`, err)
    );

    return po;
  }

/**
   * The human-readable invoice/PO number shown to the supplier and on the
   * invoice document — derived from the id so it's stable and unique without
   * a separate counter column (mirrors the AGV-/INV- prefix convention used
   * for sale invoice_number elsewhere in this codebase).
   */
  static poNumber(id: bigint | string) {
    return `PO-${String(id).padStart(6, '0')}`;
  }

  /**
   * Shared loader for both the supplier notification email and the invoice
   * fetch endpoint, so the two can never drift out of sync with each other.
   */
  static async loadPurchaseOrderForDocument(purchaseOrderId: bigint, organizationId: bigint) {
    return prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, organization_id: organizationId },
      include: {
        Supplier: true,
        Organization: { select: { name: true, phone: true, email: true, address: true } },
        PurchaseOrderItem: { where: { deleted_at: null }, include: { Product: { select: { name: true } } } }
      }
    });
  }

  /**
   * Structured invoice data for a purchase order — same shape/fields used to
   * generate the PDF that was emailed to the supplier and saved to
   * invoice_document_url, so this API and that document never disagree.
   */
  static async getPurchaseOrderInvoice(purchaseOrderId: bigint, organizationId: bigint) {
    const po = await this.loadPurchaseOrderForDocument(purchaseOrderId, organizationId);
    if (!po) throw new Error('Purchase order not found');

    const items = po.PurchaseOrderItem.map((item) => ({
      productId: item.product_id.toString(),
      productName: item.Product.name,
      quantity: item.expected_quantity,
      receivedQuantity: item.received_quantity,
      unitCost: item.unit_cost.toString(),
      lineTotal: (Number(item.unit_cost) * item.expected_quantity).toFixed(2)
    }));

    return {
      poNumber: this.poNumber(po.id),
      id: po.id.toString(),
      status: po.status,
      totalAmount: po.total_amount.toString(),
      createdAt: po.updated_at,
      expectedDeliveryDate: po.expected_delivery_date,
      actualDeliveryDate: po.actual_delivery_date,
      invoiceDocumentUrl: po.invoice_document_url,
      organization: {
        name: po.Organization.name,
        phone: po.Organization.phone,
        email: po.Organization.email,
        address: po.Organization.address
      },
      supplier: {
        id: po.Supplier.id.toString(),
        name: po.Supplier.name,
        email: po.Supplier.email,
        phone: po.Supplier.phone,
        address: po.Supplier.address
      },
      items
    };
  }

  /**
   * Generates the invoice PDF for a PO, stores it (Supabase Storage, falling
   * back to local disk — see storeFile), and persists the URL onto
   * PurchaseOrder.invoice_document_url. Idempotent to call again later
   * (e.g. from an admin "regenerate invoice" action) — it always overwrites
   * with a freshly generated file/URL.
   */
  static async generateInvoicePdf(purchaseOrderId: bigint, organizationId: bigint) {
    const po = await this.loadPurchaseOrderForDocument(purchaseOrderId, organizationId);
    if (!po) throw new Error('Purchase order not found');

    const items = po.PurchaseOrderItem.map((item) => ({
      productName: item.Product.name,
      quantity: item.expected_quantity,
      unitCost: item.unit_cost.toString(),
      lineTotal: (Number(item.unit_cost) * item.expected_quantity).toFixed(2)
    }));

    const { url, buffer } = await InvoicePdfService.generateAndStore(po.id.toString(), {
      poNumber: this.poNumber(po.id),
      createdAt: po.updated_at,
      expectedDeliveryDate: po.expected_delivery_date,
      totalAmount: po.total_amount.toString(),
      organization: po.Organization,
      supplier: po.Supplier,
      items
    });

    await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: { invoice_document_url: url }
    });

    return { url, buffer, po, items };
  }

  /**
   * Generates and stores the invoice PDF, then emails it (as an attachment)
   * to the supplier if they have an email on file. Isolated from
   * createPurchaseOrder's transaction so a slow/failed PDF render or email
   * can never roll back or delay the PO creation response.
   */
  static async notifySupplierOfPurchaseOrder(purchaseOrderId: bigint, organizationId: bigint) {
    const { url, buffer, po, items } = await this.generateInvoicePdf(purchaseOrderId, organizationId);

    if (!po.Supplier.email) {
      console.log(`[PO EMAIL SKIPPED] Supplier ${po.Supplier.id} (${po.Supplier.name}) has no email on file. Invoice stored at ${url}.`);
      return;
    }

    const attachment = { filename: `invoice-${this.poNumber(po.id)}.pdf`, content: buffer.toString('base64') };

    await EmailService.sendPurchaseOrderEmail(
      po.Supplier.email,
      po.Supplier.name,
      po.Organization.name,
      {
        id: po.id.toString(),
        poNumber: this.poNumber(po.id),
        totalAmount: po.total_amount.toString(),
        expectedDeliveryDate: po.expected_delivery_date,
        items: items.map((item) => ({ productName: item.productName, quantity: item.quantity, unitCost: item.unitCost }))
      },
      attachment
    );
  }

  // CORE LOGIC: Receiving Stock from PO
  static async receivePurchaseOrder(id: bigint, organizationId: bigint, branchId: bigint, adminId: bigint) {
    return prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findFirstOrThrow({
        where: { id, organization_id: organizationId },
        include: { PurchaseOrderItem: true, Supplier: true }
      });

      if (po.status === 'RECEIVED') {
        throw new Error('Purchase Order is already received');
      }

      // Mark PO as received, update actual delivery date
      const actualDeliveryDate = new Date();
      await tx.purchaseOrder.update({
        where: { id },
        data: { 
          status: 'RECEIVED',
          actual_delivery_date: actualDeliveryDate
        }
      });

      // Update Supplier Performance Rating and Lead Time
      if (po.expected_delivery_date) {
        const expectedDate = new Date(po.expected_delivery_date);
        const delayDays = Math.floor((actualDeliveryDate.getTime() - expectedDate.getTime()) / (1000 * 3600 * 24));
        
        let newRating = po.Supplier.performance_rating ? Number(po.Supplier.performance_rating) : 5;
        if (delayDays <= 0) {
          // Delivered on time or early, increase rating slightly
          newRating = Math.min(5, newRating + 0.1);
        } else {
          // Delivered late, decrease rating based on delay
          newRating = Math.max(0, newRating - (delayDays * 0.2));
        }

        // Calculate lead time days based on PO creation date
        const poDate = new Date(po.updated_at); // Using updated_at or created_at
        const leadTimeDays = Math.floor((actualDeliveryDate.getTime() - poDate.getTime()) / (1000 * 3600 * 24));

        await tx.supplier.update({
          where: { id: po.supplier_id },
          data: {
            performance_rating: newRating,
            lead_missing: leadTimeDays > 0 ? leadTimeDays : 1
          }
        });
      }

      // Process each item to update inventory
      for (const item of po.PurchaseOrderItem) {
        // Mark item as fully received
        await tx.purchaseOrderItem.update({
          where: { id: item.id },
          data: { received_quantity: item.expected_quantity }
        });

        // 1. Create a ProductBatch
        const batch = await tx.productBatch.create({
          data: {
            organization_id: organizationId,
            product_id: item.product_id,
            supplier_id: po.supplier_id,
            batch_number: `BATCH-PO-${po.id}-${Date.now()}`,
            quantity_remaining: item.expected_quantity,
            unit_cost: item.unit_cost,
            selling_price: Number(item.unit_cost) * 1.5, // Dummy calculation, user should update via UI
          }
        });

        // Update BranchStock
        

        // 2. Create the InventoryMovement (INCREASE)
        await tx.inventoryMovement.create({
          data: {
            organization_id: organizationId,
            branch_id: branchId,
            product_id: item.product_id,
            batch_id: batch.id,
            movement_type_id: 'INCREASE',
            quantity: item.expected_quantity,
            reference_id: po.id.toString(),
            created_by_id: adminId
          }
        });
      }

      return true;
    }, { timeout: 20000, maxWait: 10000 });
  }

  static async updatePurchaseOrder(id: bigint, organizationId: bigint, data: { status?: string; invoice_document_url?: string }) {
    const existing = await prisma.purchaseOrder.findFirst({ where: { id, organization_id: organizationId } });
    if (!existing) throw new Error('Purchase order not found');

    // Marking RECEIVED here would skip receivePurchaseOrder's batch/inventory
    // creation and supplier performance update entirely, desyncing stock from
    // the PO's recorded status — that transition must always go through
    // receivePurchaseOrder (via the RECEIVE action / receive endpoint).
    if (data.status && data.status !== existing.status) {
      if (data.status === 'RECEIVED') {
        throw new Error('Use the receive purchase order action to mark a PO as RECEIVED — this also updates inventory.');
      }
      if (existing.status === 'RECEIVED') {
        throw new Error('Cannot change the status of a Purchase Order that has already been received.');
      }
    }

    return prisma.purchaseOrder.update({
      where: { id },
      data
    });
  }

  static async deletePurchaseOrder(id: bigint, organizationId: bigint, adminId: bigint) {
    return prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findFirst({ where: { id, organization_id: organizationId } });
      if (!po) throw new Error('Purchase order not found');
      if (po.status === 'RECEIVED') {
        throw new Error('Cannot delete a Purchase Order that has already been received. Stock has already been altered.');
      }
      const { ArchiveService } = await import('@/services/archive.service');
      return ArchiveService.softDelete(organizationId, 'purchaseOrder', id, adminId, 'CANCELLED_PO', tx);
    });
  }

  // ==============================================
  // PROCUREMENT INTELLIGENCE
  // ==============================================

  static async getSupplierPerformance(organizationId: bigint) {
    return prisma.supplier.findMany({
      where: { organization_id: organizationId, deleted_at: null },
      select: {
        id: true,
        name: true,
        performance_rating: true,
        lead_missing: true,
        _count: {
          select: {
            PurchaseOrder: { where: { status: 'RECEIVED' } }
          }
        }
      },
      orderBy: [{ performance_rating: 'desc' }, { lead_missing: 'asc' }]
    });
  }

  static async getReorderSuggestions(organizationId: bigint, branchId?: bigint) {
    // Suggest products where sum of active batches < reorder_level
    const products = await prisma.product.findMany({
      where: { organization_id: organizationId, deleted_at: null },
      include: {
        ProductBatch: {
          where: { deleted_at: null },
          include: {
            Supplier: { select: { id: true, name: true, lead_missing: true, performance_rating: true } }
          }
        }
      }
    });

    const suggestions = [];

    for (const p of products) {
      const currentStock = p.ProductBatch
        .filter(b => b.quantity_remaining > 0)
        .reduce((sum: number, b: any) => sum + b.quantity_remaining, 0);

      if (currentStock <= p.reorder_level) {
        const supplierMap = new Map();
        for (const b of p.ProductBatch) {
          if (b.Supplier) supplierMap.set(b.Supplier.id.toString(), b.Supplier);
        }

        suggestions.push({
          product_id: p.id,
          name: p.name,
          current_stock: currentStock,
          reorder_level: p.reorder_level,
          suggested_quantity: Math.max(0, p.reorder_level * 2 - currentStock), // Example simple reorder formula
          suppliers: [...supplierMap.values()].sort((a, b) => Number(b.performance_rating) - Number(a.performance_rating))
        });
      }
    }

    return suggestions;
  }
}
