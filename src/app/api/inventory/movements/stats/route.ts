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

    const movements = await prisma.inventoryMovement.findMany({
      where: { organization_id: organizationId, is_deleted: false },
      include: {
        Product: { select: { name: true, id: true } }
      },
      orderBy: { timestamp: 'desc' }
    });

    let netMovement = 0;
    let stockIn = 0;
    let stockOut = 0;
    
    let last7Days = 0;
    let today = 0;
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    let riskEventsCount = 0;
    let negativeStockCount = 0;
    let largeChangesCount = 0;
    let noReferenceCount = 0;
    let pendingCount = 0; // Usually movements aren't pending unless offline synced

    const typeBreakdown: Record<string, number> = {};
    const productVelocity: Record<string, { count: number, name: string }> = {};

    let latestActivity: any = null;

    const auditSummary = {
      purchases: 0,
      sales: 0,
      refunds: 0
    };

    const smartAuditData: Record<string, { adjustments: number, damages: number, negatives: number, corrections: number }> = {};

    for (const m of movements) {
      if (!latestActivity) {
        let actType = m.type.toLowerCase();
        if (m.type as string === 'SALE') actType = 'sale';
        latestActivity = {
          name: m.Product?.name || 'Unknown',
          type: actType,
          timeLabel: 'recently' // Usually calculated relative time
        };
      }

      // Quantity Logic
      let qty = m.quantity;
      if (m.movement_type_id?.includes('DOWN') || m.movement_type_id?.includes('OUT') || m.movement_type_id === 'DECREASE' || m.movement_type_id === 'DISPOSAL') {
        qty = -m.quantity;
      }
      
      netMovement += qty;
      if (qty > 0) stockIn += qty;
      else stockOut += Math.abs(qty);

      // Time logic
      const mDate = new Date(m.timestamp);
      if (mDate >= sevenDaysAgo) last7Days++;
      if (mDate >= startOfToday) today++;

      // Breakdown mapping
      let typeLabel = m.type.toLowerCase().replace('_', ' ');
      typeBreakdown[typeLabel] = (typeBreakdown[typeLabel] || 0) + 1;

      if (m.type as string === 'SALE') auditSummary.sales++;
      else if (m.type as string === 'PURCHASE' || m.type as string === 'RESTOCK') auditSummary.purchases++;
      else if (m.type as string === 'REFUND') auditSummary.refunds++;

      // Risk signals
      if (m.risk_level === 'Critical' || m.risk_level === 'High Risk') riskEventsCount++;
      if (m.stock_after !== null && m.stock_after < 0) negativeStockCount++;
      if (Math.abs(qty) > 500) largeChangesCount++; // Arbitrary large change threshold
      if (!m.reference_id || m.reference_id.trim() === '') noReferenceCount++;

      // Velocity
      const pIdStr = m.product_id.toString();
      if (!productVelocity[pIdStr]) {
        productVelocity[pIdStr] = { count: 0, name: m.Product?.name || 'Unknown' };
      }
      productVelocity[pIdStr].count++;

      // Smart Audit Data
      if (!smartAuditData[pIdStr]) smartAuditData[pIdStr] = { adjustments: 0, damages: 0, negatives: 0, corrections: 0 };
      if (m.stock_after !== null && m.stock_after < 0) smartAuditData[pIdStr].negatives++;
      if (m.type === 'STOCK_ADJUSTMENT') smartAuditData[pIdStr].adjustments++;
      if (m.type === 'DAMAGED_STOCK' || m.type === 'EXPIRED_STOCK') smartAuditData[pIdStr].damages++;
      if (m.type === 'STOCK_COUNT_ADJUSTMENT') smartAuditData[pIdStr].corrections++;
    }

    const typeBreakdownArray = Object.entries(typeBreakdown)
      .map(([type, count]) => ({ type, count, percentage: Math.round((count / movements.length) * 100) }))
      .sort((a, b) => b.count - a.count);

    const velocityArray = Object.entries(productVelocity)
      .map(([id, data]) => ({ id, name: data.name, count: data.count, speed: 'Fast moving' }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);

    let riskScore = 0;
    let riskLabel = 'Normal';
    if (movements.length > 0) {
      riskScore = Math.min(100, Math.round(((riskEventsCount + negativeStockCount) / movements.length) * 100));
      if (riskScore > 15) riskLabel = 'High Risk';
      else if (riskScore > 5) riskLabel = 'Elevated';
    }

    // Smart flags
    let repeatedAdjustmentsId = null;
    let repeatedAdjustmentsCount = 0;
    let damageId = null;
    let damageCount = 0;
    let correctionId = null;
    let correctionCount = 0;
    let negativeId = null;
    let negativeCount = 0;

    for (const [id, data] of Object.entries(smartAuditData)) {
      if (data.adjustments > repeatedAdjustmentsCount) { repeatedAdjustmentsCount = data.adjustments; repeatedAdjustmentsId = id; }
      if (data.damages > damageCount) { damageCount = data.damages; damageId = id; }
      if (data.corrections > correctionCount) { correctionCount = data.corrections; correctionId = id; }
      if (data.negatives > negativeCount) { negativeCount = data.negatives; negativeId = id; }
    }

    const responseData = {
      header: {
        netMovement,
        last7Days,
        latestActivity
      },
      totals: {
        movements: movements.length,
        products: Object.keys(productVelocity).length,
        stockIn: `+${stockIn}`,
        stockOut: `-${stockOut}`,
        riskScore: `${riskScore}%`,
        riskLabel
      },
      breakdown: {
        all: movements.length,
        stockIn,
        stockOut,
        riskEvents: riskEventsCount,
        negativeStock: negativeStockCount,
        largeChanges: largeChangesCount,
        noReference: noReferenceCount,
        pending: pendingCount,
        today
      },
      auditSummary,
      riskSignals: {
        criticalEvents: riskEventsCount,
        negativeStockAfter: negativeStockCount,
        noReference: noReferenceCount,
        largeChanges: largeChangesCount
      },
      typeBreakdown: typeBreakdownArray.slice(0, 5),
      traceability: {
        referenced: movements.length - noReferenceCount,
        potentialReversals: auditSummary.refunds,
        branches: 0,
        warehouses: 0
      },
      velocity: velocityArray,
      smartFlags: {
        repeatedAdjustments: repeatedAdjustmentsCount > 2 ? { id: repeatedAdjustmentsId, count: repeatedAdjustmentsCount } : null,
        frequentDamage: damageCount > 2 ? { id: damageId, count: damageCount } : null,
        frequentCorrections: correctionCount > 2 ? { id: correctionId, count: correctionCount } : null,
        negativeRecurrence: negativeCount > 0 ? { id: negativeId, count: negativeCount } : null
      }
    };

    return NextResponse.json(responseData);
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
