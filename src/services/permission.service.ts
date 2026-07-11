// @ts-nocheck
import { prisma } from '@/lib/prisma'

/**
 * Role IDs (based on typical system setup)
 */
export const ROLES = {
  SUPER_ADMIN: 9,
  ADMIN: 2,
  MANAGER: 3,
  CASHIER: 4,
  PHARMACIST: 5,
  AGROVET_OWNER: 13
}

export class PermissionService {
  /**
   * Check if a user has a specific permission
   */
  static async hasPermission(
    userId: bigint,
    action: string,
    subject: string,
    organizationId?: bigint
  ): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: {
          include: {
            RolePermission: {
              where: {
                status: 'ACTIVE',
                ...(organizationId && { organization_id: organizationId })
              },
              include: {
                Permission: true
              }
            }
          }
        }
      }
    })

    if (!user) return false

    // Super Admin has ALL permissions
    if (Number(user.role_id) === ROLES.SUPER_ADMIN) {
      return true
    }

    // Check if user's role has the specific permission
    const hasPermission = user.role?.RolePermission?.some(
      (rp) => rp.Permission.action === action && rp.Permission.subject === subject
    )

    return hasPermission || false
  }

  /**
   * Get all permissions for a user
   */
  static async getUserPermissions(
    userId: bigint,
    organizationId?: bigint
  ) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: {
          include: {
            RolePermission: {
              where: {
                status: 'ACTIVE',
                ...(organizationId && { organization_id: organizationId })
              },
              include: {
                Permission: true
              }
            }
          }
        }
      }
    })

    if (!user) return []

    // Super Admin gets all permissions
    if (Number(user.role_id) === ROLES.SUPER_ADMIN) {
      const allPermissions = await prisma.permission.findMany({
        where: { status: 'ACTIVE' }
      })
      return allPermissions
    }

    return user.role?.RolePermission?.map(rp => rp.Permission) || []
  }

  /**
   * Check if user is Super Admin
   */
  static isSuperAdmin(roleId: bigint | number | string): boolean {
    return Number(roleId) === ROLES.SUPER_ADMIN
  }

  /**
   * Check if user has Admin or higher privileges
   */
  static isAdminOrHigher(roleId: bigint | number | string): boolean {
    const roleIdNum = Number(roleId)
    return roleIdNum === ROLES.SUPER_ADMIN || roleIdNum === ROLES.ADMIN || roleIdNum === ROLES.AGROVET_OWNER
  }
}
