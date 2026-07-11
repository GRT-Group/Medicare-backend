import { NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { SaleService } from '@/services/sale.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function GET(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const customers = await SaleService.getCustomers(BigInt(orgId));
    return NextResponse.json(customers, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id');
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const body = await req.json();
    const customer = await SaleService.createCustomer(BigInt(orgId), {
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
      notes: body.notes,
      metadata: body.metadata
    }, adminId ? BigInt(adminId) : undefined);
    return NextResponse.json(customer, { status: 201 });
  } catch (error: any) {
    const status = /required/i.test(error?.message ?? '') ? 400 : 500;
    return NextResponse.json({ error: friendlyMessage(error) }, { status });
  }
}

export async function PUT(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    
    if (!orgId || !id) return NextResponse.json({ error: 'Missing organization ID or customer ID' }, { status: 400 });

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

export async function DELETE(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id');
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    
    if (!orgId || !id) return NextResponse.json({ error: 'Missing organization ID or customer ID' }, { status: 400 });

    await SaleService.deleteCustomer(BigInt(id), BigInt(orgId), adminId ? BigInt(adminId) : BigInt(0));
    return NextResponse.json({ message: 'Customer deleted' }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
