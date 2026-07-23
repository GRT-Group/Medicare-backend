// @ts-nocheck
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { badRequest } from '@/lib/api-error';
import { InventoryService } from '@/services/inventory.service';
import { AuditService } from '@/services/audit.service';
import { AlertService } from '@/services/alert.service';
import { DiscountService } from '@/services/discount.service';
import { getEbmProvider } from '@/services/ebm/ebm.provider';
import { ebmConfig } from '@/services/ebm/ebm.config';

const LARGE_SALE_THRESHOLD = Number(process.env.AGROVET_LARGE_SALE_THRESHOLD || 500000);

const VALID_CUSTOMER_TYPES = ['Individual', 'Farmer', 'Cooperative', 'Company', 'Vet_Clinic'];
const VALID_CUSTOMER_STATUSES = ['Active', 'Inactive', 'Blacklisted'];
const VALID_CREDIT_STATUSES = ['Active', 'Suspended'];

function assertValidCustomerType(value: string | undefined) {
  if (value !== undefined && !VALID_CUSTOMER_TYPES.includes(value)) {
    throw new Error(`customer_type must be one of: ${VALID_CUSTOMER_TYPES.join(', ')}`);
  }
}
function assertValidCustomerStatus(value: string | undefined) {
  if (value !== undefined && !VALID_CUSTOMER_STATUSES.includes(value)) {
    throw new Error(`status must be one of: ${VALID_CUSTOMER_STATUSES.join(', ')}`);
  }
}
function assertValidCreditStatus(value: string | undefined) {
  if (value !== undefined && !VALID_CREDIT_STATUSES.includes(value)) {
    throw new Error(`credit_status must be one of: ${VALID_CREDIT_STATUSES.join(', ')}`);
  }
}

/**
 * Maps a raw Customer row onto the public API shape from the spec
 * (full_name, customer_type, status as the enum-backed _v2 columns, etc.),
 * without dropping the underlying legacy columns from the DB.
 */
function serializeCustomer(customer: any) {
  const {
    name,
    customer_type,
    customer_type_v2,
    status,
    status_v2,
    ...rest
  } = customer;

  return {
    ...rest,
    full_name: name,
    customer_type: customer_type_v2,
    status: status_v2,
  };
}

/**
 * The one, complete customer response shape — used identically by
 * list/profile/create/update so every customer endpoint returns the same
 * fields and the frontend can rely on a single type everywhere. Only the
 * profile endpoint additionally attaches `sales`/`payments` (the full
 * transaction history), since those are too heavy for a list/create/update
 * response; `stats`, `top_products`, and `farm_assets` are always present.
 *
 * `sales`/`payments` passed in are used only to compute stats/top_products;
 * pass [] when the caller hasn't loaded them (list/create/update), which is
 * cheap and correct for a brand-new customer, but for an EXISTING customer
 * being updated/listed the caller must load them for stats to be accurate.
 */
function buildCustomerView(customer: any, sales: any[], payments: any[]) {
  const activeSales = sales.filter(s => s.status !== 'CANCELLED');
  const totalSpent = activeSales.reduce((sum, s) => sum + Number(s.total_amount), 0);
  const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const overdueSales = activeSales.filter(s => Number(s.remaining_balance) > 0 && s.due_date && new Date(s.due_date) < new Date());
  const lastPurchaseDate = activeSales.length
    ? activeSales.reduce((latest, s) => (s.timestamp > latest ? s.timestamp : latest), activeSales[0].timestamp)
    : null;
  const firstPurchaseDate = activeSales.length
    ? activeSales.reduce((earliest, s) => (s.timestamp < earliest ? s.timestamp : earliest), activeSales[0].timestamp)
    : null;

  // Favorite/top products: aggregate every line item across this
  // customer's active sales by product, ranked by quantity bought — the
  // "knows the customer at a glance" view for upsell/restock context.
  // Only computable when sale items were loaded (profile view); list/create/
  // update pass sales without items, so this is [] there by design.
  const productAgg = new Map<string, { product_id: string; name: string; quantity: number; total_spent: number; orders: Set<string> }>();
  for (const sale of activeSales) {
    for (const item of sale.items ?? []) {
      const key = item.product_id.toString();
      const existing = productAgg.get(key) ?? {
        product_id: key,
        name: item.Product?.name ?? 'Unknown product',
        quantity: 0,
        total_spent: 0,
        orders: new Set<string>(),
      };
      existing.quantity += item.quantity;
      existing.total_spent += Number(item.subtotal);
      existing.orders.add(sale.id.toString());
      productAgg.set(key, existing);
    }
  }
  const topProducts = Array.from(productAgg.values())
    .map(({ orders, ...p }) => ({ ...p, order_count: orders.size }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 10);

  let farmAssets = Array.isArray((customer.metadata as any)?.farm_assets)
    ? (customer.metadata as any).farm_assets
    : [];

  if (farmAssets.length === 0 && typeof (customer.metadata as any)?.livestock_crops === 'string') {
    const crops = (customer.metadata as any).livestock_crops.split(',').map((s: string) => s.trim()).filter(Boolean);
    farmAssets = crops.map((c: string) => ({ type: c, quantity: 'Unknown' }));
  }

  return {
    ...serializeCustomer(customer),
    stats: {
      total_orders: activeSales.length,
      total_spent: totalSpent,
      total_payments_received: totalPaid,
      average_order_value: activeSales.length ? totalSpent / activeSales.length : 0,
      first_purchase_date: firstPurchaseDate,
      last_purchase_date: lastPurchaseDate,
      outstanding_balance: Number(customer.current_balance),
      available_credit: Math.max(Number(customer.credit_limit) - Number(customer.current_balance), 0),
      outstanding_sales_count: activeSales.filter(s => Number(s.remaining_balance) > 0).length,
      overdue_sales_count: overdueSales.length,
      overdue_amount: overdueSales.reduce((sum, s) => sum + Number(s.remaining_balance), 0),
      has_outstanding_balance: Number(customer.current_balance) > 0,
    },
    // Farm profile: crops/livestock this customer keeps (agrovet-specific).
    farm_assets: farmAssets,
    top_products: topProducts,
  };
}

export class SaleService {
  // ==============================================
  // CUSTOMERS
  // ==============================================

  /**
   * Every customer with the SAME full view as the single-profile endpoint
   * (stats, top_products, farm_assets) — deliberately consistent so the
   * frontend can use one type for both list and profile responses. This
   * loads full sale line items per customer to compute top_products, which
   * is heavier than a bare list; fine at typical customer-list sizes, would
   * need pagination if a tenant's customer base grows very large.
   */
  static async getCustomers(organizationId: bigint) {
    const customers = await prisma.customer.findMany({
      where: { organization_id: organizationId, deleted_at: null },
      include: {
        Sale: {
          where: { deleted_at: null },
          include: { items: { include: { Product: { select: { id: true, name: true } } } } }
        },
        CustomerPayment: {
          where: { deleted_at: null },
          select: { amount: true }
        }
      },
      orderBy: { name: 'asc' }
    });

    return customers.map(({ Sale, CustomerPayment, ...customer }) =>
      buildCustomerView(customer, Sale, CustomerPayment)
    );
  }

  static async getCustomerCredits(organizationId: bigint) {
    const customers = await prisma.customer.findMany({
      where: {
        organization_id: organizationId,
        deleted_at: null,
        current_balance: { gt: 0 }
      },
      select: {
        id: true,
        customer_code: true,
        name: true,
        phone: true,
        credit_limit: true,
        current_balance: true
      },
      orderBy: { current_balance: 'desc' }
    });

    const totalOutstanding = customers.reduce((sum, c) => sum + Number(c.current_balance), 0);

    return {
      totalOutstanding,
      customers: customers.map(c => ({
        id: c.id,
        customer_code: c.customer_code,
        name: c.name,
        phone: c.phone,
        credit_limit: Number(c.credit_limit),
        outstanding_balance: Number(c.current_balance),
      }))
    };
  }

  /**
   * Full customer profile: the customer record, every sale (with line
   * items), every payment received, and computed summary stats — everything
   * a "customer profile" screen needs in one call instead of 3+ requests.
   */
  static async getCustomerProfile(id: bigint, organizationId: bigint) {
    const customer = await prisma.customer.findFirst({
      where: { id, organization_id: organizationId, deleted_at: null },
      include: {
        User_Customer_created_by_idToUser: { select: { id: true, first_name: true, last_name: true, email: true } },
      }
    });
    if (!customer) return null;

    const [sales, payments] = await Promise.all([
      prisma.sale.findMany({
        where: { customer_id: id, organization_id: organizationId, deleted_at: null },
        include: {
          items: { include: { Product: { select: { id: true, name: true } } } },
          Branch: { select: { id: true, name: true } },
        },
        orderBy: { timestamp: 'desc' }
      }),
      prisma.customerPayment.findMany({
        where: { customer_id: id, organization_id: organizationId, deleted_at: null },
        include: {
          User_CustomerPayment_created_by_idToUser: { select: { id: true, first_name: true, last_name: true } },
        },
        orderBy: { timestamp: 'desc' }
      }),
    ]);

    const { User_Customer_created_by_idToUser, ...customerFields } = customer;

    return {
      ...buildCustomerView(customerFields, sales, payments),
      created_by: User_Customer_created_by_idToUser,
      sales: sales.map(({ items, Branch, ...sale }) => ({
        ...sale,
        branch: Branch,
        items: items.map(({ Product, ...item }) => ({ ...item, product: Product }))
      })),
      payments: payments.map(({ User_CustomerPayment_created_by_idToUser: recordedBy, ...payment }) => ({
        ...payment,
        recorded_by: recordedBy
      })),
    };
  }

  /**
   * Fetches only unpaid sales (remaining_balance > 0) with their line items.
   * Useful for the "expanded view" in credit management without loading all history.
   */
  static async getCustomerUnpaidSales(id: bigint, organizationId: bigint) {
    const sales = await prisma.sale.findMany({
      where: { 
        customer_id: id, 
        organization_id: organizationId, 
        deleted_at: null,
        status: { not: 'CANCELLED' },
        remaining_balance: { gt: 0 }
      },
      include: {
        items: { include: { Product: { select: { id: true, name: true } } } },
        User_Sale_created_by_idToUser: { select: { id: true, first_name: true, last_name: true } }
      },
      orderBy: { timestamp: 'desc' }
    });

    return sales.map(({ items, User_Sale_created_by_idToUser, ...sale }) => ({
      ...sale,
      items: items.map(({ Product, ...item }) => ({ ...item, product: Product })),
      sold_by: User_Sale_created_by_idToUser
    }));
  }

  /**
   * Customer statement/ledger: every sale (debit) and payment (credit) for
   * this customer merged into one chronological list with a running balance,
   * the way an accountant reconciles an account — rather than two separate
   * sales/payments lists the caller has to interleave themselves.
   * Optional from/to bound the statement to a date range; the opening
   * balance still reflects everything before `from` so the running balance
   * stays correct even when the list is windowed.
   */
  static async getCustomerStatement(id: bigint, organizationId: bigint, from?: Date, to?: Date) {
    const customer = await prisma.customer.findFirst({
      where: { id, organization_id: organizationId, deleted_at: null },
      select: { id: true, customer_code: true, name: true, phone: true, email: true, current_balance: true, credit_limit: true }
    });
    if (!customer) return null;

    const [allSales, allPayments] = await Promise.all([
      prisma.sale.findMany({
        where: { customer_id: id, organization_id: organizationId, deleted_at: null, status: { not: 'CANCELLED' } },
        select: { id: true, invoice_number: true, total_amount: true, amount_paid: true, timestamp: true },
        orderBy: { timestamp: 'asc' }
      }),
      prisma.customerPayment.findMany({
        where: { customer_id: id, organization_id: organizationId, deleted_at: null },
        select: { id: true, amount: true, payment_method: true, reference: true, timestamp: true },
        orderBy: { timestamp: 'asc' }
      }),
    ]);

    type LedgerEntry = {
      date: Date;
      type: 'SALE' | 'PAYMENT';
      reference: string;
      description: string;
      debit: number;
      credit: number;
      running_balance: number;
    };

    // Merge into one chronological stream first (unwindowed), so the
    // running balance is correct, then slice to [from, to] for display.
    const entries: Omit<LedgerEntry, 'running_balance'>[] = [
      ...allSales.map(s => ({
        date: s.timestamp,
        type: 'SALE' as const,
        reference: s.invoice_number,
        description: `Sale ${s.invoice_number}`,
        debit: Number(s.total_amount),
        credit: 0,
      })),
      ...allPayments.map(p => ({
        date: p.timestamp,
        type: 'PAYMENT' as const,
        reference: p.reference || `Payment #${p.id}`,
        description: `Payment received (${p.payment_method})`,
        debit: 0,
        credit: Number(p.amount),
      })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime());

    let runningBalance = 0;
    const fullLedger: LedgerEntry[] = entries.map(e => {
      runningBalance += e.debit - e.credit;
      return { ...e, running_balance: runningBalance };
    });

    const entriesBeforeFrom = from ? fullLedger.filter(e => e.date < from) : [];
    const openingBalance = entriesBeforeFrom.length
      ? entriesBeforeFrom[entriesBeforeFrom.length - 1].running_balance
      : 0;

    const windowed = fullLedger.filter(e => (!from || e.date >= from) && (!to || e.date <= to));

    return {
      customer: {
        id: customer.id.toString(),
        customer_code: customer.customer_code,
        full_name: customer.name,
        phone: customer.phone,
        email: customer.email,
        credit_limit: customer.credit_limit,
      },
      period: { from: from ?? null, to: to ?? null },
      opening_balance: openingBalance,
      closing_balance: Number(customer.current_balance),
      total_debits: windowed.reduce((sum, e) => sum + e.debit, 0),
      total_credits: windowed.reduce((sum, e) => sum + e.credit, 0),
      entries: windowed,
    };
  }

  /**
   * Next sequential customer_code for this org's customer base, formatted
   * "CUS-000001". Codes are global (not per-org) — simplest scheme that
   * matches the existing backfilled values and stays collision-free under
   * the unique index, since customer_code is unique across the whole table.
   */
  static async nextCustomerCode(): Promise<string> {
    const last = await prisma.customer.findFirst({
      where: { customer_code: { not: null } },
      orderBy: { customer_code: 'desc' },
      select: { customer_code: true },
    });
    const lastNumber = last?.customer_code ? parseInt(last.customer_code.replace('CUS-', ''), 10) : 0;
    return `CUS-${String(lastNumber + 1).padStart(6, '0')}`;
  }

  static async createCustomer(organizationId: bigint, data: {
    full_name?: string;
    name?: string;
    phone?: string;
    email?: string;
    address?: string;
    tax_id?: string;
    province?: string;
    district?: string;
    sector?: string;
    customer_type?: string;
    credit_limit?: number;
    payment_terms?: number;
    credit_status?: string;
    notes?: string;
    metadata?: any;
  }, adminId?: bigint) {
    const fullName = data.full_name ?? data.name;
    if (!fullName) throw new Error('full_name is required');
    assertValidCustomerType(data.customer_type);
    assertValidCreditStatus(data.credit_status);

    const customerCode = await this.nextCustomerCode();

    const created = await prisma.customer.create({
      data: {
        organization_id: organizationId,
        customer_code: customerCode,
        name: fullName,
        phone: data.phone,
        email: data.email,
        address: data.address,
        tax_id: data.tax_id,
        province: data.province,
        district: data.district,
        sector: data.sector,
        customer_type_v2: (data.customer_type as any) || 'Individual',
        credit_limit: data.credit_limit ?? 0,
        payment_terms: data.payment_terms ?? 0,
        credit_status: (data.credit_status as any) || 'Active',
        notes: data.notes,
        metadata: data.metadata || null,
        created_by_id: adminId,
      }
    });

    // A brand-new customer has no sales/payments yet — [] is correct and
    // avoids a pointless extra query, while still returning the SAME
    // stats/top_products/farm_assets shape as list/profile for consistency.
    return buildCustomerView(created, [], []);
  }

  static async updateCustomer(id: bigint, organizationId: bigint, data: Partial<{
    full_name: string;
    name: string;
    phone: string;
    email: string;
    address: string;
    tax_id: string;
    province: string;
    district: string;
    sector: string;
    customer_type: string;
    credit_limit: number;
    payment_terms: number;
    credit_status: string;
    status: string;
    current_balance: number;
    notes: string;
    metadata: any;
  }>, adminId?: bigint) {
    const existing = await prisma.customer.findFirst({ where: { id, organization_id: organizationId } });
    if (!existing) throw new Error('Customer not found');

    assertValidCustomerType(data.customer_type);
    assertValidCustomerStatus(data.status);
    assertValidCreditStatus(data.credit_status);

    const { full_name, name, customer_type, status, ...rest } = data;
    const fullName = full_name ?? name;

    const updated = await prisma.customer.update({
      where: { id },
      data: {
        ...rest,
        ...(fullName !== undefined ? { name: fullName } : {}),
        ...(customer_type !== undefined ? { customer_type_v2: customer_type as any } : {}),
        ...(status !== undefined ? { status_v2: status as any } : {}),
        updated_by_id: adminId,
      }
    });

    // Same full response shape as list/profile/create: load this customer's
    // sales/payments so stats/top_products reflect their real activity
    // rather than an empty [] (which would be wrong for an existing customer).
    const [sales, payments] = await Promise.all([
      prisma.sale.findMany({
        where: { customer_id: id, organization_id: organizationId, deleted_at: null },
        include: { items: { include: { Product: { select: { id: true, name: true } } } } },
      }),
      prisma.customerPayment.findMany({
        where: { customer_id: id, organization_id: organizationId, deleted_at: null },
        select: { amount: true },
      }),
    ]);

    return buildCustomerView(updated, sales, payments);
  }

  static async deleteCustomer(id: bigint, organizationId: bigint, adminId: bigint) {
    const { ArchiveService } = await import('@/services/archive.service');
    return ArchiveService.softDelete(organizationId, 'customer', id, adminId);
  }

  // ==============================================
  // SALES (POS)
  // ==============================================

  static async getSales(organizationId: bigint) {
    const sales = await prisma.sale.findMany({
      where: { organization_id: organizationId, deleted_at: null },
      include: {
        items: {
          include: { Product: true }
        },
        Customer: { select: { id: true, name: true, phone: true } },
        Branch: { select: { id: true, name: true } },
        User_Sale_created_by_idToUser: { select: { id: true, first_name: true, last_name: true } },
      },
      orderBy: { id: 'desc' }
    });

    return sales.map(({ Customer, Branch, items, User_Sale_created_by_idToUser, ...sale }) => ({
      ...sale,
      customer_name: Customer?.name || null,
      customer_phone: Customer?.phone || null,
      branch_name: Branch?.name || null,
      created_by: User_Sale_created_by_idToUser,
      items: items.map(({ Product, ...item }) => ({ ...item, product: Product }))
    }));
  }

  /** Single sale with full detail: line items (+product), customer, branch. */
  static async getSaleById(id: bigint, organizationId: bigint) {
    const sale = await prisma.sale.findFirst({
      where: { id, organization_id: organizationId, deleted_at: null },
      include: {
        items: { include: { Product: { select: { id: true, name: true, barcode: true, unit_of_measure: true } } } },
        Customer: { select: { id: true, customer_code: true, name: true, phone: true, email: true } },
        Branch: { select: { id: true, name: true } },
      }
    });
    if (!sale) return null;

    const { items, Customer, Branch, ...rest } = sale;
    return {
      ...rest,
      customer: Customer ? { ...Customer, full_name: Customer.name } : null,
      branch: Branch,
      items: items.map(({ Product, ...item }) => ({ ...item, product: Product })),
    };
  }

  static async processSale(organizationId: bigint, data: {
    customer_id?: bigint;
    branch_id?: bigint;
    cash_session_id?: bigint;
    payment_method: string; // 'CASH', 'CREDIT', 'MOMO', 'CARD', 'BANK_TRANSFER', 'MANUAL_INVOICE'
    amount_paid?: number;
    due_date?: Date;
    discount_request_id?: bigint;
    client_ref?: string;
    allocation_strategy?: 'FIFO' | 'LIFO' | 'FEFO'; // default to FEFO
    items: {
      product_id: bigint;
      batch_id?: bigint;
      quantity: number;
      unit_price?: number;
    }[];
  }, adminId: bigint) {
    if (!data.items?.length) throw badRequest('A sale must have at least one item');
    if (!data.branch_id) throw badRequest('branch_id is required');

    // Idempotency check for offline POS clients
    if (data.client_ref) {
      const existing = await prisma.sale.findFirst({
        where: { organization_id: organizationId, invoice_number: `INV-${data.client_ref}` },
        include: { items: true },
      });
      if (existing) {
        const full = await this.getSaleReceipt(organizationId, existing.id);
        return { sale: full, ebm: { success: existing.ebm_status === 'SUCCESS' }, duplicate: true };
      }
    }

    const createdSale = await prisma.$transaction(async (tx) => {
      const productIds = data.items.map(i => i.product_id);

      // Validate products
      const products = await tx.product.findMany({
        where: { id: { in: productIds }, organization_id: organizationId, is_deleted: false },
        select: { id: true, name: true, base_price: true, tax_rate: true }
      });
      const productsById = new Map(products.map(p => [p.id.toString(), p]));
      for (const item of data.items) {
        if (!productsById.has(item.product_id.toString())) {
          throw badRequest(`Product ${item.product_id} was not found in this organization`);
        }
      }

      // Dynamic Batch ordering (FEFO/FIFO)
      const allBatches = await tx.productBatch.findMany({
        where: {
          organization_id: organizationId,
          product_id: { in: productIds },
          quantity_remaining: { gt: 0 },
          is_deleted: false
        },
        orderBy: data.allocation_strategy === 'FIFO' ? [{ id: 'asc' }] :
                 data.allocation_strategy === 'LIFO' ? [{ id: 'desc' }] :
                 [{ expiry_date: 'asc' }, { id: 'asc' }]
      });

      const batchesByProduct = new Map<string, typeof allBatches>();
      for (const b of allBatches) {
        const key = b.product_id.toString();
        if (!batchesByProduct.has(key)) batchesByProduct.set(key, []);
        batchesByProduct.get(key)!.push(b);
      }

      type Allocation = { batch_id: bigint; product_id: bigint; quantity: number; unit_price: number };
      const allocations: Allocation[] = [];
      const finalRemainingByBatch = new Map<string, { id: bigint; remaining: number }>();
      let grossTotal = 0;

      for (const item of data.items) {
        const product = productsById.get(item.product_id.toString())!;
        let batches = batchesByProduct.get(item.product_id.toString()) ?? [];

        if (item.batch_id !== undefined) {
          const chosen = batches.find(b => b.id === item.batch_id);
          if (!chosen || chosen.quantity_remaining <= 0) {
            throw badRequest(`Batch ${item.batch_id} of "${product.name}" has no remaining stock (or does not exist). Refresh the product list and pick an available batch.`);
          }
          batches = [chosen, ...batches.filter(b => b.id !== item.batch_id)];
        }

        const unitPrice = item.unit_price
          ?? Number(batches.find(b => b.quantity_remaining > 0)?.selling_price ?? product.base_price);

        let remainingQtyToDeduct = item.quantity;

        for (const batch of batches) {
          if (remainingQtyToDeduct <= 0) break;
          if (batch.quantity_remaining <= 0) continue;

          const take = Math.min(batch.quantity_remaining, remainingQtyToDeduct);
          allocations.push({
            batch_id: batch.id,
            product_id: item.product_id,
            quantity: take,
            unit_price: unitPrice,
          });
          batch.quantity_remaining -= take;
          finalRemainingByBatch.set(batch.id.toString(), { id: batch.id, remaining: batch.quantity_remaining });
          remainingQtyToDeduct -= take;
        }

        if (remainingQtyToDeduct > 0) {
          throw badRequest(`Insufficient stock for "${product.name}": short by ${remainingQtyToDeduct} (requested ${item.quantity})`);
        }

        grossTotal += item.quantity * unitPrice;
      }

      const invoiceNumber = data.client_ref ? `INV-${data.client_ref}` : `INV-${Date.now()}`;

      // Create Sale with initial gross totals (need ID for discount consume)
      const sale = await tx.sale.create({
        data: {
          organization_id: organizationId,
          branch_id: data.branch_id,
          customer_id: data.customer_id,
          cash_session_id: data.cash_session_id,
          total_amount: grossTotal,
          amount_paid: 0,
          remaining_balance: 0,
          due_date: data.due_date,
          payment_method: data.payment_method as any,
          status: 'COMPLETED',
          invoice_number: invoiceNumber,
          created_by_id: adminId
        }
      });

      let discountAmount = 0;
      if (data.discount_request_id) {
        discountAmount = await DiscountService.consumeForSale(tx, organizationId, data.discount_request_id, sale.id);
        if (discountAmount > grossTotal) throw badRequest('Approved discount exceeds sale total');
      }

      const netTotal = grossTotal - discountAmount;
      
      // Calculate VAT
      const vatRate = ebmConfig.defaultVatRate;
      const vatAmount = Number(((netTotal * vatRate) / (100 + vatRate)).toFixed(2));

      // Calculate payments and credit
      const amountPaid = data.amount_paid !== undefined
        ? data.amount_paid
        : (data.payment_method === 'CREDIT' ? 0 : netTotal);
      if (amountPaid > netTotal) {
        throw badRequest(`amount_paid (${amountPaid}) cannot exceed the sale total (${netTotal})`);
      }
      const remainingBalance = netTotal - amountPaid;

      // Handle customer credit
      if (data.payment_method === 'CREDIT' || remainingBalance > 0) {
        if (!data.customer_id) {
          if (data.payment_method === 'CREDIT') {
            throw badRequest('A registered customer is required for credit sales');
          }
        } else {
          const customer = await tx.customer.findFirst({
            where: { id: data.customer_id, organization_id: organizationId, is_deleted: false }
          });
          if (!customer) throw badRequest(`Customer ${data.customer_id} was not found in this organization`);

          const newBalance = Number(customer.current_balance) + remainingBalance;
          const limit = Number(customer.credit_limit);
          
          if (data.payment_method === 'CREDIT') {
            if (limit <= 0) throw badRequest('Credit denied: customer has no approved credit limit');
            if (newBalance > limit) throw badRequest(`Credit limit exceeded: balance ${newBalance} would exceed limit ${limit}`);
          }

          await tx.customer.update({
            where: { id: data.customer_id },
            data: { current_balance: newBalance }
          });
        }
      }

      // Insert items
      const now = new Date();
      await tx.saleItem.createMany({
        data: allocations.map(a => ({
          sale_id: sale.id,
          product_id: a.product_id,
          batch_id: a.batch_id,
          quantity: a.quantity,
          unit_price: a.unit_price,
          subtotal: a.quantity * a.unit_price,
          updated_at: now
        }))
      });

      // Insert inventory movements
      await tx.inventoryMovement.createMany({
        data: allocations.map(a => ({
          organization_id: organizationId,
          branch_id: data.branch_id!,
          product_id: a.product_id,
          batch_id: a.batch_id,
          movement_type_id: 'SALES',
          type: 'SALES',
          quantity: a.quantity,
          reference_id: sale.id.toString(),
          created_by_id: adminId
        }))
      });

      // Set-based decrement of every touched batch (highly optimized)
      const touched = Array.from(finalRemainingByBatch.values());
      if (touched.length > 0) {
        const valuesSql = touched
          .map((_, i) => `($${i * 2 + 1}::bigint, $${i * 2 + 2}::int)`)
          .join(', ');
        const params = touched.flatMap(t => [t.id, t.remaining]);
        await tx.$executeRawUnsafe(
          `UPDATE "ProductBatch" AS pb
           SET quantity_remaining = v.qty, updated_at = now()
           FROM (VALUES ${valuesSql}) AS v(id, qty)
           WHERE pb.id = v.id`,
          ...params
        );
      }

      // Update the Sale with final totals
      const finalSale = await tx.sale.update({
        where: { id: sale.id },
        data: {
           total_amount: netTotal,
           discount_amount: discountAmount,
           vat_amount: vatAmount,
           amount_paid: amountPaid,
           remaining_balance: remainingBalance,
        }
      });

      if (amountPaid > 0) {
        await tx.cashbook.create({
          data: {
            organization_id: organizationId,
            branch_id: data.branch_id!,
            transaction_type: 'IN',
            category: data.payment_method === 'CASH' ? 'SALES_CASH' : `SALES_${data.payment_method}`,
            amount: amountPaid,
            description: `Sale ${invoiceNumber}`,
            reference_id: sale.id.toString(),
            created_by_id: adminId,
            date: new Date()
          }
        });
      }

      await AuditService.log({
        organization_id: organizationId,
        branch_id: data.branch_id!,
        user_id: adminId,
        module: 'POS',
        action: 'CREATE_SALE',
        table_affected: 'Sale',
        record_id: sale.id.toString(),
        after: { total: netTotal, discount: discountAmount, vat: vatAmount, payment_method: data.payment_method, shift: data.cash_session_id?.toString() },
      }, tx);

      return { saleId: sale.id, invoiceNumber, netTotal, discountAmount, vatAmount, amountPaid, remainingBalance };
    }, { timeout: 30000, maxWait: 10000 });

    // MANDATORY EBM fiscalization (outside DB tx)
    const provider = getEbmProvider();
    const productNames = await prisma.product.findMany({
      where: { id: { in: data.items.map(i => i.product_id) } },
      select: { id: true, name: true, tax_rate: true },
    });
    const nameById = new Map(productNames.map(p => [p.id.toString(), p]));
    const ebm = await provider.fiscalize({
      organization_id: organizationId.toString(),
      invoice_number: createdSale.invoiceNumber,
      items: data.items.map(i => ({
        name: nameById.get(i.product_id.toString())?.name || `Product ${i.product_id}`,
        quantity: i.quantity,
        unit_price: i.unit_price!,
        tax_rate: Number(nameById.get(i.product_id.toString())?.tax_rate || ebmConfig.defaultVatRate),
      })),
      total_amount: createdSale.netTotal,
      payment_method: data.payment_method as any,
    });

    await prisma.sale.update({
      where: { id: createdSale.saleId },
      data: {
        ebm_invoice_number: ebm.ebm_invoice_number,
        ebm_receipt_data: (ebm.receipt_data ?? undefined) as any,
        ebm_status: ebm.success ? 'SUCCESS' : 'FAILED',
      },
    });

    if (createdSale.netTotal >= LARGE_SALE_THRESHOLD) {
      await AlertService.emit({
        organization_id: organizationId,
        branch_id: data.branch_id!,
        type: 'LARGE_SALE',
        severity: 'WARNING',
        title: 'Large sale recorded',
        message: `Sale ${createdSale.invoiceNumber} of ${createdSale.netTotal} was recorded.`,
        target_role: 'Administrator',
        data: { sale_id: createdSale.saleId.toString(), total: createdSale.netTotal },
      });
    }

    await AlertService.runScan(organizationId).catch(() => {});

    if (data.customer_id) {
      const { CustomerNotifyService } = await import('@/services/customer-notify.service');
      CustomerNotifyService.notifySale(organizationId, data.customer_id, {
        invoice_number: createdSale.invoiceNumber,
        total_amount: createdSale.netTotal,
        amount_paid: createdSale.amountPaid,
        remaining_balance: createdSale.remainingBalance,
        due_date: data.due_date,
      }).catch(() => {});
    }

    const full = await this.getSaleReceipt(organizationId, createdSale.saleId);
    return { sale: full, ebm, duplicate: false };
  }

  static async getSaleReceipt(organizationId: bigint, saleId: bigint) {
    const sale = await prisma.sale.findFirst({
      where: { id: saleId, organization_id: organizationId },
      include: {
        items: { include: { Product: { select: { name: true, barcode: true, unit_of_measure: true } } } },
        Customer: { select: { id: true, name: true, phone: true } },
        Branch: { select: { id: true, name: true } },
        User_Sale_created_by_idToUser: { select: { first_name: true, last_name: true } },
      },
    });
    if (!sale) throw new Error('Sale not found');
    return {
      id: sale.id,
      invoice_number: sale.invoice_number,
      ebm_invoice_number: sale.ebm_invoice_number,
      ebm_status: sale.ebm_status,
      ebm_receipt_data: sale.ebm_receipt_data,
      branch: sale.Branch,
      cashier: sale.User_Sale_created_by_idToUser,
      customer: sale.Customer,
      payment_method: sale.payment_method,
      cash_session_id: sale.cash_session_id,
      subtotal: Number(sale.total_amount) + Number(sale.discount_amount),
      discount_amount: sale.discount_amount,
      vat_amount: sale.vat_amount,
      total_amount: sale.total_amount,
      amount_paid: sale.amount_paid,
      remaining_balance: sale.remaining_balance,
      timestamp: sale.timestamp,
      items: sale.items.map((i) => ({
        product_id: i.product_id,
        name: i.Product?.name,
        barcode: i.Product?.barcode,
        uom: i.Product?.unit_of_measure,
        quantity: i.quantity,
        unit_price: i.unit_price,
        subtotal: i.subtotal,
      })),
    };
  }

  static async updateSale(id: bigint, organizationId: bigint, data: { status?: string }) {
    const existing = await prisma.sale.findFirst({ where: { id, organization_id: organizationId } });
    if (!existing) throw new Error('Sale not found');

    return prisma.sale.update({
      where: { id },
      data: {
        ...(data.status ? { status: data.status as any } : {})
      }
    });
  }

  static async payCreditSale(id: bigint, organizationId: bigint, adminId: bigint, amount: number, paymentMethod: string) {
    return prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findFirst({
        where: { id, organization_id: organizationId },
        include: { Customer: true }
      });
      if (!sale) throw new Error('Sale not found');
      if (!sale.customer_id) throw new Error('Cannot pay credit for a sale with no customer');
      
      const balance = Number(sale.remaining_balance);
      if (balance <= 0) throw new Error('This sale is already fully paid');
      if (amount <= 0 || amount > balance) throw new Error(`Invalid payment amount. Remaining balance is ${balance}`);

      // Update sale
      const newRemaining = balance - amount;
      const newAmountPaid = Number(sale.amount_paid) + amount;
      
      const updatedSale = await tx.sale.update({
        where: { id },
        data: {
          amount_paid: newAmountPaid,
          remaining_balance: newRemaining,
        }
      });

      // Update customer balance (reduce it because they are paying us)
      if (sale.Customer) {
        await tx.customer.update({
          where: { id: sale.customer_id },
          data: { current_balance: Number(sale.Customer.current_balance) - amount }
        });
      }

      // Add to cashbook
      await tx.cashbook.create({
        data: {
          organization_id: organizationId,
          branch_id: sale.branch_id || BigInt(1),
          transaction_type: 'IN',
          category: `SALES_${paymentMethod.toUpperCase()}`,
          amount,
          description: `Credit payment for Sale #${sale.invoice_number}`,
          reference_id: sale.id.toString(),
          created_by_id: adminId,
          date: new Date(),
        }
      });

      // Also create a customer payment record for history
      await tx.customerPayment.create({
        data: {
          organization_id: organizationId,
          customer_id: sale.customer_id,
          amount,
          payment_method: paymentMethod.toUpperCase(),
          reference: `Sale #${sale.invoice_number}`,
          status: 'COMPLETED',
          created_by_id: adminId,
          timestamp: new Date()
        }
      });

      return updatedSale;
    });
  }

  static async deleteSale(id: bigint, organizationId: bigint, adminId: bigint) {
    return prisma.$transaction(async (tx) => {
      // Voiding a sale implies returning stock and reversing cashbook
      const sale = await tx.sale.findFirstOrThrow({
        where: { id, organization_id: organizationId },
        include: { items: true }
      });

      if (sale.status === 'CANCELLED') throw new Error('Sale is already voided');

      // 1. Mark Sale as CANCELLED and logically delete
      const { ArchiveService } = await import('@/services/archive.service');
      await ArchiveService.softDelete(organizationId, 'sale', id, adminId, 'VOID_SALE', tx);

      // 2. Reverse stock (INCREASE)
      for (const item of sale.items) {
        if (item.batch_id && sale.branch_id) {
          const batch = await tx.productBatch.findUnique({ where: { id: item.batch_id } });
          if (batch) {
            await tx.productBatch.update({
              where: { id: batch.id },
              data: { quantity_remaining: batch.quantity_remaining + (item.quantity || 0) }
            });
            await tx.inventoryMovement.create({
              data: {
                organization_id: organizationId,
                branch_id: sale.branch_id,
                product_id: item.product_id!,
                batch_id: batch.id,
                movement_type_id: 'INCREASE',
                quantity: item.quantity || 0,
                reference_id: `VOID_SALE_${sale.id}`,
                created_by_id: adminId
              }
            });
          }
        }
      }

      // 3. Reverse Customer Balance — the sale only ever added its UNPAID
      // remainder to the customer's balance, so reverse exactly that (not the
      // full total, which would over-credit a partially-paid sale).
      if (sale.customer_id && Number(sale.remaining_balance) > 0) {
        const customer = await tx.customer.findUnique({ where: { id: sale.customer_id } });
        if (customer) {
          await tx.customer.update({
            where: { id: customer.id },
            data: { current_balance: Number(customer.current_balance) - Number(sale.remaining_balance) }
          });
        }
      }

      // 4. Void whatever cashbook entry this sale created (if any) — matched
      // by reference, so it works for any payment method including a credit
      // sale that took a down payment.
      await tx.cashbook.updateMany({
        where: { reference_id: sale.id.toString(), transaction_type: 'IN', category: 'SALES' },
        data: { status: 'VOID', deleted_at: new Date(), deleted_by_id: adminId }
      });

      return true;
    // Voiding walks batches/movements sequentially against a remote DB —
    // Prisma's default 5s interactive-transaction timeout is not enough.
    }, { timeout: 20000, maxWait: 10000 });
  }
}
