import { prisma } from '@/lib/prisma';
import { ArchiveService } from './archive.service';

export class MasterDataService {
  // ==============================================
  // Generic CRUD for Master Data
  // ==============================================

  static async getRecords(modelName: 'brand' | 'manufacturer' | 'unitOfMeasure' | 'taxCategory' | 'expenseCategory' | 'customerGroup' | 'supplierCategory', organizationId: bigint) {
    return (prisma[modelName] as any).findMany({
      where: { organization_id: organizationId, deleted_at: null }
    });
  }

  static async createRecord(modelName: 'brand' | 'manufacturer' | 'unitOfMeasure' | 'taxCategory' | 'expenseCategory' | 'customerGroup' | 'supplierCategory', organizationId: bigint, data: any) {
    return (prisma[modelName] as any).create({
      data: {
        ...data,
        organization_id: organizationId
      }
    });
  }

  static async updateRecord(modelName: 'brand' | 'manufacturer' | 'unitOfMeasure' | 'taxCategory' | 'expenseCategory' | 'customerGroup' | 'supplierCategory', id: bigint, organizationId: bigint, data: any) {
    const existing = await (prisma[modelName] as any).findFirst({
      where: { id, organization_id: organizationId }
    });
    if (!existing) throw new Error(`${modelName} not found`);

    return (prisma[modelName] as any).update({
      where: { id },
      data
    });
  }

  static async deleteRecord(modelName: 'brand' | 'manufacturer' | 'unitOfMeasure' | 'taxCategory' | 'expenseCategory' | 'customerGroup' | 'supplierCategory', id: bigint, organizationId: bigint, adminId: bigint) {
    return ArchiveService.softDelete(organizationId, modelName, id, adminId, 'USER_DELETED');
  }
}
