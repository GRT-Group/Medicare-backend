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

    const counts = await prisma.stockCount.findMany({
      where: { organization_id: organizationId, is_deleted: false },
      include: {
        Product: { select: { name: true } },
        Branch: { select: { name: true } }
      }
    });

    let netVariance = 0;
    let absoluteVariance = 0;
    let criticalCount = 0;
    let activeCount = 0;
    let completedCount = 0;
    
    let positiveVariance = 0;
    let negativeVariance = 0;
    let cleanCounts = 0;
    
    let totalAccuracySum = 0;
    let locationVariance: Record<string, { counts: number, variance: number }> = {};
    const topVarianceAlerts: any[] = [];

    for (const c of counts) {
      if (c.status === 'ACTIVE') activeCount++;
      if (c.status === 'COMPLETED') completedCount++;

      netVariance += c.variance;
      const absVar = Math.abs(c.variance);
      absoluteVariance += absVar;

      if (c.variance > 0) positiveVariance++;
      else if (c.variance < 0) negativeVariance++;
      else cleanCounts++;

      // Accuracy formula: min / max * 100
      let accuracy = 100; // if both 0, accuracy is 100%
      if (c.system_quantity > 0 || c.counted_quantity > 0) {
        const max = Math.max(c.system_quantity, c.counted_quantity);
        const min = Math.min(c.system_quantity, c.counted_quantity);
        accuracy = max === 0 ? 0 : Math.round((min / max) * 100);
      }
      totalAccuracySum += accuracy;

      // Risk formula
      let isCritical = false;
      if (absVar > 50 || (c.system_quantity > 0 && absVar > c.system_quantity * 0.2)) {
        isCritical = true;
        criticalCount++;
      }

      // Alerts tracking
      if (absVar > 0) {
        topVarianceAlerts.push({
          productName: c.Product?.name || 'Unknown Product',
          reference: c.count_number,
          location: c.Branch?.name || 'No location',
          variance: c.variance > 0 ? `+${c.variance}` : c.variance.toString(),
          absVariance: absVar
        });
      }

      // Location variance aggregation
      const locName = c.Branch?.name || 'No location';
      if (!locationVariance[locName]) {
        locationVariance[locName] = { counts: 0, variance: 0 };
      }
      locationVariance[locName].counts++;
      locationVariance[locName].variance += absVar;
    }

    // Sort alerts by highest absolute variance
    topVarianceAlerts.sort((a, b) => b.absVariance - a.absVariance);
    
    // Sort locations by highest absolute variance
    const locationVarianceChart = Object.entries(locationVariance)
      .map(([name, data]) => ({ name, counts: data.counts, variance: data.variance }))
      .sort((a, b) => b.variance - a.variance)
      .slice(0, 5);

    const averageAccuracy = counts.length > 0 ? Math.round(totalAccuracySum / counts.length) : 0;
    
    // Health score heuristic: high accuracy and low criticals improve health
    let healthScore = averageAccuracy;
    if (criticalCount > 0 && healthScore > 20) {
      healthScore -= (criticalCount * 5); // penalize health
    }
    if (healthScore < 0) healthScore = 0;

    const responseData = {
      workflow: {
        netVariance,
        absoluteVariance,
        critical: criticalCount,
        activeCounts: activeCount,
        completed: completedCount,
        accuracy: `${averageAccuracy}%`,
        auditHealth: `${healthScore}%`
      },
      allStatusCounts: {
        all: counts.length,
        active: activeCount,
        completed: completedCount,
        variance: positiveVariance + negativeVariance,
        clean: cleanCounts,
        positive: positiveVariance,
        negative: negativeVariance,
        pendingSync: 0
      },
      varianceSummary: {
        positiveVariance,
        negativeVariance,
        cleanCounts,
        accuracyLabel: `${averageAccuracy}%`
      },
      highestVarianceAlerts: topVarianceAlerts.slice(0, 3), // Top 3
      locationVarianceChart
    };

    return NextResponse.json(responseData);
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
