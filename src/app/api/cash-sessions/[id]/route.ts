import { NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error';
import { CashSessionService } from '@/services/cash-session.service';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id') || '1';
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const resolvedParams = await params;
    const body = await req.json();
    const updated = await CashSessionService.updateSession(
      BigInt(resolvedParams.id),
      BigInt(orgId),
      body,
      BigInt(adminId)
    );

    return NextResponse.json(updated, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id') || '1';
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const resolvedParams = await params;
    await CashSessionService.deleteSession(BigInt(resolvedParams.id), BigInt(orgId), BigInt(adminId));

    return NextResponse.json({ success: true, message: 'Shift deleted successfully' }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
