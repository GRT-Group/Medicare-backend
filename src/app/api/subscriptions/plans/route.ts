import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error'
import { SubscriptionPlanService } from '@/services/subscription-plan.service';

export async function GET() {
  try {
    const [plans, discounts] = await Promise.all([
      SubscriptionPlanService.getAllPlans(),
      SubscriptionPlanService.getAllDiscountRules(),
    ]);
    const serialized = JSON.parse(JSON.stringify({ plans, discounts }, (k, v) => typeof v === 'bigint' ? v.toString() : v));
    return NextResponse.json(serialized, { status: 200 });
  } catch (error: any) {
    return apiError(error);
  }
}
