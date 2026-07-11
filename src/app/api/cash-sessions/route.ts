import { NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { CashSessionService } from '@/services/cash-session.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

/**
 * GET /api/cash-sessions (alias: /api/shifts)
 * Query:
 *   ?period=daily|weekly|monthly  — filter shifts by period
 *   &date=YYYY-MM-DD              — anchor for the period (default: today)
 *   ?from=&to=                    — explicit range (used when no period)
 *   &branchId= &userId=           — narrow to a branch / cashier
 */
export async function GET(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const url = new URL(req.url);

    if (!orgId || !/^\d+$/.test(orgId)) return NextResponse.json({ error: 'Missing or invalid x-organization-id header' }, { status: 400 });

    const branchId = url.searchParams.get('branchId');
    const userId = url.searchParams.get('userId');

    const result = await CashSessionService.getSessions(BigInt(orgId), {
      branchId: branchId ? BigInt(branchId) : undefined,
      userId: userId ? BigInt(userId) : undefined,
      period: url.searchParams.get('period') ?? undefined,
      date: url.searchParams.get('date') ?? undefined,
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error: any) {
    const message = error?.message ?? '';
    const status = /must be one of|Invalid/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: friendlyMessage(error) }, { status });
  }
}
