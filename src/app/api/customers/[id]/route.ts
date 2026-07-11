// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { SaleService } from '@/services/sale.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

/**
 * GET /api/customers/:id — full customer profile: the customer record,
 * every sale (with line items), every payment received, and computed
 * summary stats (total spent, average order value, overdue balance, etc).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const orgId = req.headers.get('x-organization-id');
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: 'Invalid customer id' }, { status: 400 });
    }

    const profile = await SaleService.getCustomerProfile(BigInt(id), BigInt(orgId));
    if (!profile) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    return NextResponse.json(profile, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}

/**
 * PUT /api/customers/:id — update a customer (REST path form of
 * PUT /api/customers?id=; both are supported, this is the canonical one).
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const orgId = req.headers.get('x-organization-id');
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: 'Invalid customer id' }, { status: 400 });
    }

    const adminId = req.headers.get('x-user-id');
    const body = await req.json();
    const customer = await SaleService.updateCustomer(BigInt(id), BigInt(orgId), {
      full_name: body.full_name ?? body.name,
      phone: body.phone,
      email: body.email,
      address: body.address,
      tax_id: body.tax_id,
      province: body.province,
      district: body.district,
      sector: body.sector,
      customer_type: body.customer_type,
      credit_limit: body.credit_limit,
      payment_terms: body.payment_terms,
      credit_status: body.credit_status,
      current_balance: body.current_balance,
      status: body.status,
      notes: body.notes,
      metadata: body.metadata
    }, adminId ? BigInt(adminId) : undefined);

    return NextResponse.json(customer, { status: 200 });
  } catch (error: any) {
    const message = error?.message ?? '';
    const status = /not found/i.test(message) ? 404 : /must be one of|required/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: friendlyMessage(error) }, { status });
  }
}

/**
 * DELETE /api/customers/:id — soft-delete a customer (REST path form of
 * DELETE /api/customers?id=; both are supported, this is the canonical one).
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id');
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: 'Invalid customer id' }, { status: 400 });
    }

    await SaleService.deleteCustomer(BigInt(id), BigInt(orgId), adminId ? BigInt(adminId) : BigInt(0));
    return NextResponse.json({ message: 'Customer deleted' }, { status: 200 });
  } catch (error: any) {
    const status = /not found|already deleted/i.test(error?.message ?? '') ? 404 : 500;
    return NextResponse.json({ error: friendlyMessage(error) }, { status });
  }
}
