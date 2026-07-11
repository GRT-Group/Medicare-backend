// @ts-nocheck
import { prisma } from '@/lib/prisma';
import { TicketPriority, TicketStatus } from '@prisma/client';

export class SupportService {
  /**
   * Calculates the SLA target DateTime based on priority
   */
  private static calculateSLA(priority: TicketPriority): Date {
    const now = new Date();
    switch (priority) {
      case 'URGENT':
        now.setHours(now.getHours() + 4);
        break;
      case 'HIGH':
        now.setHours(now.getHours() + 12);
        break;
      case 'MEDIUM':
        now.setHours(now.getHours() + 24);
        break;
      case 'LOW':
        now.setHours(now.getHours() + 72);
        break;
      default:
        now.setHours(now.getHours() + 24);
    }
    return now;
  }

  static async getTickets(organizationId: bigint) {
    return prisma.supportTicket.findMany({
      where: {
        organization_id: organizationId,
        deleted_at: null,
      },
      include: {
        User_SupportTicket_created_by_idToUser: {
          select: { id: true, first_name: true, last_name: true, email: true }
        },
        User_SupportTicket_assigned_to_idToUser: {
          select: { id: true, first_name: true, last_name: true, email: true }
        }
      },
      orderBy: { created_at: 'desc' },
    });
  }

  static async getAllTickets() {
    return prisma.supportTicket.findMany({
      where: {
        deleted_at: null,
      },
      include: {
        User_SupportTicket_created_by_idToUser: {
          select: { id: true, first_name: true, last_name: true, email: true }
        },
        User_SupportTicket_assigned_to_idToUser: {
          select: { id: true, first_name: true, last_name: true, email: true }
        }
      },
      orderBy: { created_at: 'desc' },
    });
  }

  static async createTicket(
    organizationId: bigint,
    adminId: bigint,
    data: {
      subject: string;
      category: string;
      priority: string;
      message: string;
      assigned_to_id?: bigint;
    }
  ) {
    const priority = data.priority as TicketPriority;
    const slaTarget = this.calculateSLA(priority);

    return prisma.supportTicket.create({
      data: {
        organization_id: organizationId,
        created_by_id: adminId,
        subject: data.subject,
        category: data.category || 'General',
        priority: priority,
        message: data.message,
        assigned_to_id: data.assigned_to_id,
        sla_target: slaTarget,
        status: 'OPEN',
      },
      include: {
        User_SupportTicket_created_by_idToUser: {
          select: { id: true, first_name: true, last_name: true, email: true }
        },
        User_SupportTicket_assigned_to_idToUser: {
          select: { id: true, first_name: true, last_name: true, email: true }
        }
      }
    });
  }

  static async updateTicket(id: bigint, data: { status?: TicketStatus; assigned_to_id?: bigint; response_message?: string }, organizationId?: bigint) {
    const existing = await prisma.supportTicket.findFirst({ 
      where: { 
        id, 
        ...(organizationId ? { organization_id: organizationId } : {}) 
      } 
    });
    
    if (!existing) throw new Error('Support ticket not found or access denied');

    return prisma.supportTicket.update({
      where: { id },
      data,
    });
  }
}
