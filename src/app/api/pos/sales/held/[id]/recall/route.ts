import { NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error';
import { prisma } from '@/lib/prisma';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const orgId = req.headers.get('x-organization-id');
    if (!orgId) return NextResponse.json({ error: 'Missing organization' }, { status: 400 });

    const saleId = BigInt(id);
    const sale = await prisma.sale.update({
      where: { id: saleId, organization_id: BigInt(orgId) },
      data: { status: 'PENDING' }
    });

    return NextResponse.json(sale, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
