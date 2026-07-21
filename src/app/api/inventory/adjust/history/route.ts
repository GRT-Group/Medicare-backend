import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { friendlyMessage } from '@/lib/api-error';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function GET(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const organizationId = BigInt(orgId);

    const validTypes = ['STOCK_ADJUSTMENT', 'DAMAGED_STOCK', 'OPENING_BALANCE', 'STOCK_COUNT_ADJUSTMENT', 'EXPIRED_STOCK'];
    const validMovementIds = ['ADJUSTMENT_UP', 'ADJUSTMENT_DOWN', 'INCREASE', 'DECREASE', 'DISPOSAL', 'OPENING_STOCK'];

    const movements = await prisma.inventoryMovement.findMany({
      where: {
        organization_id: organizationId,
        is_deleted: false,
        OR: [
          { type: { in: validTypes as any[] } },
          { movement_type_id: { in: validMovementIds } }
        ]
      },
      include: {
        Product: { select: { name: true } },
        ProductBatch: { select: { batch_number: true, unit_cost: true, selling_price: true } }
      },
      orderBy: { timestamp: 'desc' }
    });

    const formattedHistory = movements.map((m) => {
      const isPositive = m.movement_type_id.includes('UP') || m.movement_type_id === 'INCREASE' || m.movement_type_id === 'OPENING_STOCK';
      const quantityPrefix = isPositive ? '+' : '-';
      
      let uitype = 'adjustment';
      if (m.type === 'DAMAGED_STOCK' || m.movement_type_id === 'DISPOSAL') uitype = 'damage';
      else if (m.type === 'OPENING_BALANCE' || m.movement_type_id === 'OPENING_STOCK') uitype = 'opening_stock';
      else if (m.type === 'STOCK_COUNT_ADJUSTMENT') uitype = 'correction';
      else if (m.type === 'EXPIRED_STOCK') uitype = 'wastage';

      return {
        id: m.id,
        productName: m.Product?.name || 'Unknown Product',
        timestamp: m.timestamp,
        type: uitype,
        quantity: `${quantityPrefix}${m.quantity}`,
        stockChange: {
          before: m.stock_before || 0,
          after: m.stock_after || (isPositive ? (m.stock_before || 0) + m.quantity : (m.stock_before || 0) - m.quantity)
        },
        risk: m.risk_level || 'Normal',
        valueImpact: m.value_impact || 0,
        reference: m.reference_id || 'Direct Stock Adjustment',
        details: {
          costPrice: m.ProductBatch?.unit_cost || 0,
          sellingPrice: m.ProductBatch?.selling_price || 0,
          batch: m.ProductBatch?.batch_number || 'None'
        }
      };
    });

    return NextResponse.json(formattedHistory);
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
