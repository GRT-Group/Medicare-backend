import { prisma } from '../lib/prisma';

// SubscriptionPlan only has columns for id/name/price/features/status - there is
// no currency/duration_months/max_organizations/description column. Rather than
// a schema migration, those extra fields the frontend edits are namespaced and
// persisted inside `features` (JSON) so nothing the admin enters is silently
// dropped, while `pos`/`inventory`/etc. module flags stay at the top level of
// `features` for backward compatibility with plans created via setup-defaults.
type PlanFeaturesInput = {
  code?: string;
  pos?: boolean;
  inventory?: boolean;
  reports?: boolean;
  advanced_analytics?: boolean;
  branches_limit?: number;
  users_limit?: number;
  currency?: string;
  duration_months?: number;
  max_organizations?: number;
  description?: string;
  [key: string]: any;
};

export class SubscriptionPlanService {
  static async getAllPlans() {
    return prisma.subscriptionPlan.findMany({
      where: { deleted_at: null, is_deleted: false },
      orderBy: { price: 'asc' },
    });
  }

  static async createPlan(data: {
    name: string;
    price: number;
    status?: string;
    currency?: string;
    duration_months?: number;
    max_organizations?: number;
    description?: string;
    features?: PlanFeaturesInput;
  }) {
    if (!data.name?.trim()) throw new Error('Plan name is required');
    if (data.price === undefined || Number(data.price) < 0) throw new Error('Plan price must be a non-negative number');

    const existing = await prisma.subscriptionPlan.findFirst({
      where: { name: data.name.trim(), deleted_at: null, is_deleted: false }
    });
    if (existing) throw new Error(`A plan named "${data.name}" already exists`);

    return prisma.subscriptionPlan.create({
      data: {
        name: data.name.trim(),
        price: data.price,
        status: normalizeStatus(data.status),
        features: mergeFeatures({}, data),
      },
    });
  }

  static async updatePlan(id: bigint, data: {
    name?: string;
    price?: number;
    status?: string;
    currency?: string;
    duration_months?: number;
    max_organizations?: number;
    description?: string;
    features?: PlanFeaturesInput;
  }) {
    const existing = await prisma.subscriptionPlan.findFirst({ where: { id, deleted_at: null, is_deleted: false } });
    if (!existing) throw new Error('Subscription plan not found');

    if (data.name && data.name.trim() !== existing.name) {
      const nameTaken = await prisma.subscriptionPlan.findFirst({
        where: { name: data.name.trim(), deleted_at: null, is_deleted: false, id: { not: id } }
      });
      if (nameTaken) throw new Error(`A plan named "${data.name}" already exists`);
    }

    if (data.price !== undefined && Number(data.price) < 0) throw new Error('Plan price must be a non-negative number');

    return prisma.subscriptionPlan.update({
      where: { id },
      data: {
        name: data.name?.trim(),
        price: data.price,
        status: data.status !== undefined ? normalizeStatus(data.status) : undefined,
        features: mergeFeatures((existing.features as PlanFeaturesInput) || {}, data),
      },
    });
  }

  static async deletePlan(id: bigint, adminId: bigint) {
    const inUse = await prisma.subscription.findFirst({ where: { plan_id: id, status: 'ACTIVE' } });
    if (inUse) throw new Error('Cannot delete a plan with active subscriptions. Deactivate it instead.');

    const { ArchiveService } = await import('@/services/archive.service');
    return ArchiveService.softDelete(BigInt(0), 'subscriptionPlan', id, adminId);
  }

  static async getAllDiscountRules() {
    return prisma.discountRule.findMany({
      where: { deleted_at: null, is_deleted: false },
      orderBy: { months: 'asc' },
    });
  }

  static async createDiscountRule(data: { months: number; discount_percentage: number; status?: string }) {
    const months = Number(data.months);
    const pct = Number(data.discount_percentage);
    if (!Number.isInteger(months) || months < 1) throw new Error('Duration must be a whole number of months (1 or more)');
    if (Number.isNaN(pct) || pct < 0 || pct > 100) throw new Error('Discount percentage must be between 0 and 100');

    const existing = await prisma.discountRule.findFirst({ where: { months, deleted_at: null, is_deleted: false } });
    if (existing) throw new Error(`A discount rule for ${months} month${months === 1 ? '' : 's'} already exists`);

    return prisma.discountRule.create({
      data: {
        months,
        discount_percentage: pct,
        status: normalizeStatus(data.status),
      },
    });
  }

  static async updateDiscountRule(id: bigint, data: { months?: number; discount_percentage?: number; status?: string }) {
    const existing = await prisma.discountRule.findFirst({ where: { id, deleted_at: null, is_deleted: false } });
    if (!existing) throw new Error('Discount rule not found');

    let months: number | undefined;
    if (data.months !== undefined) {
      months = Number(data.months);
      if (!Number.isInteger(months) || months < 1) throw new Error('Duration must be a whole number of months (1 or more)');
      if (months !== existing.months) {
        const monthsTaken = await prisma.discountRule.findFirst({
          where: { months, deleted_at: null, is_deleted: false, id: { not: id } }
        });
        if (monthsTaken) throw new Error(`A discount rule for ${months} month${months === 1 ? '' : 's'} already exists`);
      }
    }

    let pct: number | undefined;
    if (data.discount_percentage !== undefined) {
      pct = Number(data.discount_percentage);
      if (Number.isNaN(pct) || pct < 0 || pct > 100) throw new Error('Discount percentage must be between 0 and 100');
    }

    return prisma.discountRule.update({
      where: { id },
      data: {
        months,
        discount_percentage: pct,
        status: data.status !== undefined ? normalizeStatus(data.status) : undefined,
      },
    });
  }

  static async deleteDiscountRule(id: bigint, adminId: bigint) {
    const { ArchiveService } = await import('@/services/archive.service');
    return ArchiveService.softDelete(BigInt(0), 'discountRule', id, adminId);
  }
}

function normalizeStatus(status?: string): 'ACTIVE' | 'INACTIVE' {
  return String(status ?? 'active').toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
}

function mergeFeatures(existing: PlanFeaturesInput, data: {
  currency?: string;
  duration_months?: number;
  max_organizations?: number;
  description?: string;
  features?: PlanFeaturesInput;
}): PlanFeaturesInput {
  const merged: PlanFeaturesInput = { ...existing, ...(data.features || {}) };
  if (data.currency !== undefined) merged.currency = data.currency;
  if (data.duration_months !== undefined) merged.duration_months = Number(data.duration_months);
  if (data.max_organizations !== undefined) merged.max_organizations = Number(data.max_organizations);
  if (data.description !== undefined) merged.description = data.description;
  return merged;
}
