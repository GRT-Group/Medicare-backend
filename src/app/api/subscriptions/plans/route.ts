import { NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { SubscriptionPlanService } from '@/services/subscription-plan.service';

// JSON serialization for BigInt
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function GET() {
  try {
    const [plans, discounts] = await Promise.all([
      SubscriptionPlanService.getAllPlans(),
      SubscriptionPlanService.getAllDiscountRules(),
    ]);
    return NextResponse.json({ plans, discounts }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
