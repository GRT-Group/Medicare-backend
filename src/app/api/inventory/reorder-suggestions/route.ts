import { NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { PurchaseService } from '@/services/purchase.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function GET(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const url = new URL(req.url);
    const branchId = url.searchParams.get('branchId');

    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const suggestions = await PurchaseService.getReorderSuggestions(BigInt(orgId), branchId ? BigInt(branchId) : undefined);
    return NextResponse.json(suggestions, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
