import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error'
import { normalizePaymentMethod, parseSaleItem, parseOptionalId, PAYMENT_METHODS_HINT } from '@/lib/sale-input'
import { SaleService } from '@/services/sale.service';

export const dynamic = 'force-dynamic';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

function badRequestResponse(message: string) {
  return NextResponse.json({ success: false, error: message }, { status: 400 })
}

export async function GET(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    if (!orgId || !/^\d+$/.test(orgId)) return NextResponse.json({ error: 'Missing or invalid x-organization-id header' }, { status: 400 });

    const sales = await SaleService.getSales(BigInt(orgId));
    return NextResponse.json(sales, { status: 200 });
  } catch (error: any) {
    return apiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id') || '1'; // Fallback to 1 for testing
    if (!orgId || !/^\d+$/.test(orgId)) return badRequestResponse('Missing or invalid x-organization-id header');

    let body: any;
    try {
      body = await req.json();
    } catch {
      return badRequestResponse('Request body must be valid JSON');
    }

    // Frontend sends camelCase (paymentMethod); accept snake_case too so
    // either convention works instead of silently 400ing on a mismatch.
    const paymentMethodRaw = body.payment_method ?? body.paymentMethod;
    const customerId = body.customer_id ?? body.customerId;
    const branchId = body.branch_id ?? body.branchId;
    const amountPaid = body.amount_paid ?? body.amountPaid;
    const dueDateRaw = body.due_date ?? body.dueDate;

    if (!paymentMethodRaw) {
      return badRequestResponse(`payment_method is required (${PAYMENT_METHODS_HINT})`);
    }
    const paymentMethod = normalizePaymentMethod(paymentMethodRaw);
    if (!paymentMethod) {
      return badRequestResponse(`Unknown payment_method "${paymentMethodRaw}". Use ${PAYMENT_METHODS_HINT}.`);
    }

    if (!Array.isArray(body.items) || body.items.length === 0) {
      return badRequestResponse('items must be a non-empty array of { product_id, quantity, unit_price }');
    }

    // parseSaleItem/parseOptionalId throw 400-tagged errors that the catch
    // block below turns into a clear 400 response via apiError().
    const items = body.items.map(parseSaleItem);
    const customerIdBig = parseOptionalId(customerId, 'customer_id');
    const branchIdBig = parseOptionalId(branchId, 'branch_id');

    let amountPaidNum: number | undefined;
    if (amountPaid !== undefined && amountPaid !== null && amountPaid !== '') {
      amountPaidNum = Number(amountPaid);
      if (!Number.isFinite(amountPaidNum) || amountPaidNum < 0) {
        return badRequestResponse('amount_paid must be a non-negative number');
      }
    }

    let dueDate: Date | undefined;
    if (dueDateRaw) {
      dueDate = new Date(dueDateRaw);
      if (isNaN(dueDate.getTime())) return badRequestResponse('due_date must be a valid date');
    }

    const sale = await SaleService.processSale(BigInt(orgId), {
      customer_id: customerIdBig,
      branch_id: branchIdBig,
      payment_method: paymentMethod,
      amount_paid: amountPaidNum,
      due_date: dueDate,
      items,
    }, BigInt(adminId));

    // Return the sale with full detail (line items + product names, customer,
    // branch) so the POS can render the receipt from this one response.
    const fullSale = await SaleService.getSaleById(sale.id, BigInt(orgId));

    return NextResponse.json({ success: true, message: 'Sale processed successfully', sale: fullSale ?? sale }, { status: 201 });
  } catch (error: any) {
    return apiError(error);
  }
}

export async function PUT(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    
    if (!orgId || !id || !/^\d+$/.test(orgId)) return NextResponse.json({ error: 'Missing organization ID or sale ID' }, { status: 400 });

    const body = await req.json();
    const sale = await SaleService.updateSale(BigInt(id), BigInt(orgId), body);
    return NextResponse.json(sale, { status: 200 });
  } catch (error: any) {
    return apiError(error);
  }
}

export async function DELETE(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id') || '1';
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    
    if (!orgId || !id || !/^\d+$/.test(orgId)) return NextResponse.json({ error: 'Missing organization ID or sale ID' }, { status: 400 });

    await SaleService.deleteSale(BigInt(id), BigInt(orgId), BigInt(adminId));
    return NextResponse.json({ message: 'Sale voided successfully. Stock and balances have been reversed.' }, { status: 200 });
  } catch (error: any) {
    return apiError(error);
  }
}
