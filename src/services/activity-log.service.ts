import { prisma } from '@/lib/prisma';

export class ActivityLogService {
  /**
   * Logs user-specific operational activities like login, export, reports etc.
   */
  static async logActivity(organizationId: bigint, data: {
    user_id: bigint;
    branch_id?: bigint;
    action: string;
    description?: string;
    ip_address?: string;
    device_info?: string;
    browser_info?: string;
  }) {
    return prisma.activityLog.create({
      data: {
        organization_id: organizationId,
        user_id: data.user_id,
        branch_id: data.branch_id,
        action: data.action,
        description: data.description,
        ip_address: data.ip_address,
        device_info: data.device_info,
        browser_info: data.browser_info
      }
    });
  }

  /**
   * Fetch activity logs for monitoring and compliance.
   */
  static async getLogs(organizationId: bigint, userId?: bigint, limit: number = 100) {
    return prisma.activityLog.findMany({
      where: {
        organization_id: organizationId,
        ...(userId && { user_id: userId })
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
      include: {
        user: { select: { id: true, first_name: true, last_name: true, email: true } },
        branch: { select: { id: true, name: true } }
      }
    });
  }
}
