import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

export class OrganizationService {
  /**
   * Fetch all organizations
   */
  static async getAllOrganizations() {
    const organizations = await prisma.organization.findMany({
      where: { deleted_at: null },
      orderBy: { created_at: 'desc' },
      include: {
        OrganizationType: { select: { id: true, name: true } },
        Subscription: {
          select: {
            id: true,
            status: true,
            plan_name: true,
            start_date: true,
            end_date: true,
            subscription_plan: { select: { id: true, name: true, price: true } },
          },
        },
      },
    })

    return organizations.map(({ OrganizationType, Subscription, ...org }) => ({
      ...org,
      type: OrganizationType,
      subscription: Subscription
        ? {
            ...Subscription,
            plan: Subscription.subscription_plan
              ? { ...Subscription.subscription_plan, name: Subscription.subscription_plan.name }
              : { name: Subscription.plan_name },
          }
        : null,
    }))
  }

  /**
   * Get an organization by ID
   */
  static async getOrganizationById(id: string) {
    // findUnique's where must resolve to a single unique key; { id, deleted_at }
    // together isn't one (no compound unique on the model), which throws.
    // findFirst accepts arbitrary filters, so it's used here instead.
    const org = await prisma.organization.findFirst({
      where: { id: BigInt(id), deleted_at: null },
      include: {
        OrganizationType: { select: { id: true, name: true } },
        Subscription: {
          select: {
            id: true,
            status: true,
            plan_name: true,
            start_date: true,
            end_date: true,
            subscription_plan: { select: { id: true, name: true, price: true } },
          },
        },
      },
    })

    if (!org) return null

    const { OrganizationType, Subscription, ...rest } = org
    return {
      ...rest,
      type: OrganizationType,
      subscription: Subscription
        ? {
            ...Subscription,
            plan: Subscription.subscription_plan
              ? { ...Subscription.subscription_plan, name: Subscription.subscription_plan.name }
              : { name: Subscription.plan_name },
          }
        : null,
      // Flat field the frontend also checks (organization.subscription_status).
      subscription_status: Subscription?.status ?? null,
    }
  }

  /**
   * Create a new organization
   */
  static async createOrganization(data: {
    name: string
    organization_type_id: string
    code: string
    phone: string
    email: string
    country?: string
    currency?: string
    timezone?: string
    logo_url?: string
    business_certificate_url?: string
  }) {
    return prisma.organization.create({
      data: {
        ...data,
        organization_type_id: BigInt(data.organization_type_id)
      },
    })
  }

  /**
   * Update an existing organization
   */
  static async updateOrganization(id: string, data: Prisma.OrganizationUpdateInput) {
    return prisma.organization.update({
      where: { id: BigInt(id) },
      data,
    })
  }

  /**
   * Soft delete an organization
   */
  static async deleteOrganization(id: bigint, adminId: bigint | null) {
    const { ArchiveService } = await import('@/services/archive.service');
    return ArchiveService.softDelete(id, 'organization', id, adminId as any);
  }

  /**
   * Mark an organization as VERIFIED after email/sms verification
   */
  static async verifyOrganization(id: string) {
    return prisma.organization.update({
      where: { id: BigInt(id) },
      data: { lifecycle_status: 'VERIFIED' },
    })
  }
}
