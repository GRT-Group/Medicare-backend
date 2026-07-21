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
    const now = new Date();

    const transfers = await prisma.stockTransfer.findMany({
      where: { organization_id: organizationId, is_deleted: false },
      include: {
        from_branch: { select: { name: true } },
        to_branch: { select: { name: true } },
        items: { select: { quantity: true } }
      }
    });

    let totalQuantity = 0;
    let pendingCount = 0;
    let approvedCount = 0;
    let inTransitCount = 0;
    let completedCount = 0;
    let cancelledCount = 0;
    let overdueCount = 0;
    let sameDayCount = 0;

    const routeNodes: Record<string, number> = {};

    for (const t of transfers) {
      const transferQty = t.items.reduce((sum, item) => sum + item.quantity, 0);
      totalQuantity += transferQty;

      if (t.status === 'PENDING') pendingCount++;
      else if (t.status === 'APPROVED') approvedCount++;
      else if (t.status === 'IN_TRANSIT') inTransitCount++;
      else if (t.status === 'COMPLETED') completedCount++;
      else if (t.status === 'CANCELLED') cancelledCount++;

      // Check Overdue (expected date has passed and not completed)
      if (t.expected_date && new Date(t.expected_date) < now && t.status !== 'COMPLETED' && t.status !== 'CANCELLED') {
        overdueCount++;
      }

      // Check Same Day completion
      if (t.transfer_date && t.completed_date) {
        const tDate = new Date(t.transfer_date);
        const cDate = new Date(t.completed_date);
        if (tDate.toDateString() === cDate.toDateString()) {
          sameDayCount++;
        }
      }

      // Top Locations tracking
      if (t.from_branch?.name) {
        routeNodes[t.from_branch.name] = (routeNodes[t.from_branch.name] || 0) + 1;
      }
      if (t.to_branch?.name) {
        routeNodes[t.to_branch.name] = (routeNodes[t.to_branch.name] || 0) + 1;
      }
    }

    const totalActive = pendingCount + approvedCount + inTransitCount + completedCount;
    
    // Health score heuristic: Overdue transfers heavily impact health
    let healthScore = 100 - (overdueCount * 5) - (pendingCount * 1);
    if (healthScore < 0) healthScore = 0;
    if (healthScore > 100) healthScore = 100;

    // Calculate Top Locations map to array
    const topLocationsArray = Object.entries(routeNodes)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3); // Top 3

    const responseData = {
      workflow: {
        totalQuantity,
        overdue: overdueCount,
        sameDay: sameDayCount,
        inTransit: inTransitCount,
        pending: pendingCount,
        completed: completedCount,
        health: `${healthScore}%`
      },
      allStatusCounts: {
        all: transfers.length,
        pending: pendingCount,
        approved: approvedCount,
        inTransit: inTransitCount,
        completed: completedCount,
        cancelled: cancelledCount,
        overdue: overdueCount,
        pendingSync: 0 // offline feature placeholder
      },
      routeSummary: {
        approved: approvedCount,
        cancelled: cancelledCount,
        quantity: totalQuantity,
        priorityNote: overdueCount > 0 ? `${overdueCount} overdue transfer(s) need attention` : 'All routes normal'
      },
      pipeline: {
        pending: { count: pendingCount, percentage: totalActive > 0 ? Math.round((pendingCount / totalActive) * 100) : 0 },
        approved: { count: approvedCount, percentage: totalActive > 0 ? Math.round((approvedCount / totalActive) * 100) : 0 },
        inTransit: { count: inTransitCount, percentage: totalActive > 0 ? Math.round((inTransitCount / totalActive) * 100) : 0 },
        completed: { count: completedCount, percentage: totalActive > 0 ? Math.round((completedCount / totalActive) * 100) : 0 }
      },
      topLocations: topLocationsArray
    };

    return NextResponse.json(responseData);
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
