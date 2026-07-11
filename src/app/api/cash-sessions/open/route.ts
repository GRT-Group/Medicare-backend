import { NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { CashSessionService } from '@/services/cash-session.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function POST(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const body = await req.json();
    const { user_id, branch_id, opening_balance } = body;

    if (!user_id || opening_balance === undefined) {
      return NextResponse.json({ error: 'user_id and opening_balance are required' }, { status: 400 });
    }

    const session = await CashSessionService.openSession(BigInt(orgId), {
      user_id: BigInt(user_id),
      branch_id: branch_id ? BigInt(branch_id) : undefined,
      opening_balance: Number(opening_balance)
    });

    return NextResponse.json(session, { status: 201 });
  } catch (error: any) {
    const message = error?.message ?? '';
    const status = /already has an open/i.test(message) ? 409 : /required/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: friendlyMessage(error) }, { status });
  }
}
