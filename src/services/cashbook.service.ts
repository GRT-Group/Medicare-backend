import { prisma } from '@/lib/prisma';

export class CashbookService {
  // ==============================================
  // CASHBOOK (EXPENSES & INCOME)
  // ==============================================

  static async getExpenses(organizationId: bigint) {
    return prisma.cashbook.findMany({
      where: { 
        organization_id: organizationId, 
        transaction_type: 'OUT',
        deleted_at: null 
      },
      orderBy: { date: 'desc' }
    });
  }

  static async createExpense(organizationId: bigint, data: {
    category: string;
    amount: number;
    description?: string;
  }, adminId: bigint) {
    return prisma.cashbook.create({
      data: {
        organization_id: organizationId,
        transaction_type: 'OUT',
        category: data.category, // e.g., 'TRANSPORT', 'SALARY'
        amount: data.amount,
        description: data.description,
        created_by_id: adminId,
        date: new Date()
      }
    });
  }

  static async updateExpense(id: bigint, organizationId: bigint, data: { category?: string; amount?: number; description?: string; status?: string }) {
    const existing = await prisma.cashbook.findFirst({ where: { id, organization_id: organizationId } });
    if (!existing) throw new Error('Expense not found');

    return prisma.cashbook.update({
      where: { id },
      data
    });
  }

  static async deleteExpense(id: bigint, organizationId: bigint, adminId: bigint) {
    const { ArchiveService } = await import('@/services/archive.service');
    return ArchiveService.softDelete(organizationId, 'cashbook', id, adminId, 'VOID_EXPENSE');
  }
}
