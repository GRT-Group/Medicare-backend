import { NextResponse } from 'next/server';
import { PurchaseService } from '@/services/purchase.service';
import { resolveContext, toErrorResponse } from '@/lib/agrovet/context';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function GET(req: Request) {
  try {
    const ctx = await resolveContext(req as any);
    const performance = await PurchaseService.getSupplierPerformance(ctx.organizationId);
    return NextResponse.json(performance, { status: 200 });
  } catch (error: any) {
    const { body, status } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
