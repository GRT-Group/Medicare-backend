// @ts-nocheck
/**
 * POST /api/customers/:id/remind
 * Sends a "please pay your outstanding balance" reminder (SMS + email,
 * whichever the customer has) for ONE customer. Returns what was sent so the
 * UI can confirm it. Fails with a readable 400 when there is nothing to
 * remind about (no balance) or no contact details on file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { CustomerNotifyService } from '@/services/customer-notify.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const orgId = req.headers.get('x-organization-id');
    if (!orgId) return NextResponse.json({ success: false, error: 'Missing x-organization-id header' }, { status: 400 });

    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ success: false, error: 'Invalid customer id' }, { status: 400 });
    }

    const result = await CustomerNotifyService.sendCreditReminder(BigInt(orgId), BigInt(id));

    return NextResponse.json({ success: true, message: `Reminder sent to ${result.customer_name}`, data: result }, { status: 200 });
  } catch (error: any) {
    return apiError(error);
  }
}
