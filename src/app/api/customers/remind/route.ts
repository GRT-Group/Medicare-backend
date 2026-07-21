// @ts-nocheck
/**
 * POST /api/customers/remind
 * Bulk credit reminders: messages EVERY customer with an outstanding balance
 * (SMS + email, whichever they have).
 *
 *   body (optional): { "only_overdue": true }  — restrict to customers with
 *   at least one unpaid sale already past its due date.
 *
 * Response: { reminded, skipped, results: [{ customer_name, balance, status, ... }] }
 * — customers without contact details are skipped with a reason, never an error.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { CustomerNotifyService } from '@/services/customer-notify.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function POST(req: NextRequest) {
  try {
    const orgId = req.headers.get('x-organization-id');
    if (!orgId) return NextResponse.json({ success: false, error: 'Missing x-organization-id header' }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const onlyOverdue = body?.only_overdue === true || body?.onlyOverdue === true;
    const customerIds = Array.isArray(body?.customer_ids) ? body.customer_ids : undefined;
    const customTemplate = body?.message_template;

    const summary = await CustomerNotifyService.sendCreditReminders(BigInt(orgId), onlyOverdue, customerIds, customTemplate);

    return NextResponse.json({
      success: true,
      message: `Reminders sent to ${summary.reminded} customer(s)${summary.skipped ? `, ${summary.skipped} skipped` : ''}`,
      data: summary,
    }, { status: 200 });
  } catch (error: any) {
    return apiError(error);
  }
}
