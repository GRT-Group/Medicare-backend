import { prisma } from '@/lib/prisma'

export class BranchService {
  /**
   * Create a new branch for an organization
   */
  static async createBranch(data: {
    organizationId: bigint;
    name: string;
    location?: string;
    contactInfo?: string;
    isMain?: boolean;
    createdById: bigint;
  }) {
    // If it's marked as the main branch, we should probably unmark any other main branch
    // depending on business rules. For now, we'll just create it.
    
    return prisma.branch.create({
      data: {
        organization_id: data.organizationId,
        name: data.name,
        location: data.location,
        contact_info: data.contactInfo,
        is_main: data.isMain || false,
        status: 'ACTIVE'
      }
    })
  }

  /**
   * Get all branches for a specific organization
   */
  static async getBranchesByOrganization(organizationId: bigint) {
    return prisma.branch.findMany({
      where: {
        organization_id: organizationId,
        is_deleted: false
      },
      orderBy: {
        created_at: 'desc'
      }
    })
  }

  /**
   * Soft-delete a branch
   */
  static async deleteBranch(branchId: bigint, adminId: bigint) {
    const { ArchiveService } = await import('@/services/archive.service');
    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { organization_id: true } });
    if (!branch) throw new Error('Branch not found');
    return ArchiveService.softDelete(branch.organization_id, 'branch', branchId, adminId);
  }

  /**
   * Get a specific branch by ID
   */
  static async getBranchById(branchId: bigint) {
    return prisma.branch.findUnique({
      where: { id: branchId }
    })
  }

  /**
   * Update a branch
   */
  static async updateBranch(branchId: bigint, data: {
    name?: string;
    location?: string;
    contactInfo?: string;
    isMain?: boolean;
    status?: string;
  }) {
    return prisma.branch.update({
      where: { id: branchId },
      data: {
        name: data.name,
        location: data.location,
        contact_info: data.contactInfo,
        is_main: data.isMain,
        status: data.status
      }
    })
  }
}
