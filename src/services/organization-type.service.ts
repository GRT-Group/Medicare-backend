import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

export class OrganizationTypeService {
  /**
   * Fetch all organization types
   */
  static async getAllOrganizationTypes() {
    return prisma.organizationType.findMany({
      where: { deleted_at: null },
      orderBy: { created_at: 'desc' },
    })
  }

  /**
   * Get an organization type by ID
   */
  static async getOrganizationTypeById(id: string) {
    return prisma.organizationType.findUnique({
      where: { id: BigInt(id), deleted_at: null },
    })
  }

  /**
   * Create a new organization type
   */
  static async createOrganizationType(data: {
    name: string
    description?: string
    status?: string
  }) {
    return prisma.organizationType.create({
      data,
    })
  }

  /**
   * Update an existing organization type
   */
  static async updateOrganizationType(id: string, data: Prisma.OrganizationTypeUpdateInput) {
    return prisma.organizationType.update({
      where: { id: BigInt(id) },
      data,
    })
  }

  /**
   * Soft delete an organization type
   */
  static async deleteOrganizationType(id: bigint, adminId: bigint | null) {
    const { ArchiveService } = await import('@/services/archive.service');
    return ArchiveService.softDelete(BigInt(0), 'organizationType', id, adminId as any);
  }
}
