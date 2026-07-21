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
    
    // For "this month" calculations
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Fetch all movements related to adjustments, damages, corrections, opening stock
    // Type is mostly STOCK_ADJUSTMENT, DAMAGED_STOCK, OPENING_BALANCE, etc.
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
      }
    });

    let totalRecords = movements.length;
    let uniqueProducts = new Set(movements.map(m => m.product_id.toString())).size;

    let thisMonthAdded = 0;
    let thisMonthReduced = 0;
    let thisMonthDamages = 0;

    let allAdded = 0;
    let allReduced = 0;
    let allDamages = 0;
    let allCorrections = 0;
    
    let criticalCount = 0;
    let reviewCount = 0;
    let openingStockCount = 0;

    let netChange = 0;
    let totalValueImpact = 0;

    for (const m of movements) {
      const isThisMonth = new Date(m.timestamp) >= startOfMonth;
      const qty = m.quantity;
      const isPositive = m.movement_type_id.includes('UP') || m.movement_type_id === 'INCREASE' || m.movement_type_id === 'OPENING_STOCK';
      const isDamage = m.type === 'DAMAGED_STOCK' || m.movement_type_id === 'DISPOSAL';
      
      if (isPositive) {
        allAdded += qty;
        netChange += qty;
        if (isThisMonth) thisMonthAdded += qty;
      } else {
        allReduced += qty;
        netChange -= qty;
        if (isThisMonth) thisMonthReduced += qty;
      }

      if (isDamage) {
        allDamages++;
        if (isThisMonth) thisMonthDamages++;
      }

      if (m.type === 'STOCK_COUNT_ADJUSTMENT') {
        allCorrections++;
      }
      
      if (m.movement_type_id === 'OPENING_STOCK' || m.type === 'OPENING_BALANCE') {
        openingStockCount++;
      }

      if (m.risk_level === 'Critical') criticalCount++;
      if (m.risk_level === 'Review') reviewCount++;

      if (m.value_impact) {
        totalValueImpact += isPositive ? Number(m.value_impact) : -Number(m.value_impact);
      }
    }

    let healthScore = 100 - (criticalCount * 5) - (reviewCount * 2);
    if (healthScore < 0) healthScore = 0;

    const responseData = {
      totalRecords,
      totalProducts: uniqueProducts,
      auditHealth: `${healthScore}% Ready`,
      thisMonth: {
        added: thisMonthAdded,
        reduced: thisMonthReduced,
        damages: thisMonthDamages
      },
      allRecords: {
        added: allAdded,
        reduced: allReduced,
        damages: allDamages,
        corrections: allCorrections,
        pendingSync: 0 // Offline feature placeholder
      },
      adjustmentHealth: {
        score: healthScore,
        critical: criticalCount,
        review: reviewCount,
        pending: 0
      },
      stockImpact: {
        netChange: netChange > 0 ? `+${netChange}` : netChange.toString(),
        valueImpact: Math.abs(totalValueImpact),
        corrections: allCorrections,
        openingStock: openingStockCount
      },
      lossControl: {
        damageCases: allDamages,
        wastageCases: movements.filter(m => m.type === 'EXPIRED_STOCK' || m.reference_id?.toLowerCase().includes('waste')).length
      }
    };

    return NextResponse.json(responseData);
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
