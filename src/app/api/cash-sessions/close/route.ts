import { NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { CashSessionService } from '@/services/cash-session.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function POST(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id');
    
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });
    if (!adminId) return NextResponse.json({ error: 'Missing x-user-id header' }, { status: 400 });

    const body = await req.json();
    // shift_id is the canonical name (the API speaks "shift"); session_id
    // is kept as an accepted alias for existing callers.
    const shiftId = body.shift_id ?? body.session_id;
    const { closing_balance } = body;

    if (!shiftId || closing_balance === undefined) {
      return NextResponse.json({ error: 'shift_id and closing_balance are required' }, { status: 400 });
    }

    const session = await CashSessionService.closeSession(
      BigInt(shiftId),
      BigInt(orgId),
      { closing_balance: Number(closing_balance) },
      BigInt(adminId)
    );

    return NextResponse.json(session, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
