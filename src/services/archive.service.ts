import { prisma } from '@/lib/prisma';

export class ArchiveService {
  /**
   * Universal Soft Delete with Archive and Audit
   */
  static async softDelete(
    organizationId: bigint,
    entityType: any,
    entityId: bigint | string,
    adminId: bigint | string,
    reason: string = 'USER_DELETED',
    existingTx?: any
  ) {
    const execute = async (tx: any) => {
      // 1. Fetch the existing entity
      const isGlobal = ['organization', 'organizationType', 'subscriptionPlan', 'discountRule'].includes(entityType);
      const whereClause = isGlobal ? { id: entityId } : { id: entityId, organization_id: organizationId };
      const existing = await tx[entityType].findFirst({
        where: whereClause
      });

      if (!existing) throw new Error(`${entityType} not found`);
      if (existing.is_deleted) throw new Error(`${entityType} is already deleted`);

      // 2. Perform the Soft Delete
      // Some entities use 'status' enum, so we update it to 'DELETED' or 'CANCELLED' if applicable
      const updateData: any = {
        is_deleted: true,
        deleted_at: new Date(),
        deleted_by_id: adminId
      };

      // Check if the entity has a status field that supports DELETED/CANCELLED
      if (existing.status !== undefined) {
        if (['product', 'customer', 'supplier', 'branch', 'category'].includes(entityType)) {
          updateData.status = 'DELETED';
        } else if (['sale', 'purchaseOrder'].includes(entityType)) {
          updateData.status = 'CANCELLED';
        }
      }

      const deletedEntity = await tx[entityType].update({
        where: { id: entityId },
        data: updateData
      });

      // 3. Move to Archive Table (_RecycleBin)
      // Capitalize first letter for the RecycleBin model name
      const recycleBinModel = entityType.charAt(0).toUpperCase() + entityType.slice(1) + '_RecycleBin';
      
      // We safely check if the model exists in prisma before creating
      if (tx[recycleBinModel] || tx[`${entityType}_RecycleBin`]) {
        const targetModel = tx[recycleBinModel] ? recycleBinModel : `${entityType}_RecycleBin`;
        // For compound names like purchaseOrder -> PurchaseOrder_RecycleBin
        const camelCaseModel = targetModel.charAt(0).toLowerCase() + targetModel.slice(1);
        
        if (tx[camelCaseModel]) {
          const snapshot = JSON.parse(JSON.stringify(existing, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value
          ));
          // SubscriptionPlan_RecycleBin has no organization_id column at all
          // (plans are global, not org-owned) - omit it there, include it
          // everywhere else that has the column.
          const recycleBinHasOrgId = entityType !== 'subscriptionPlan';

          // The _RecycleBin tables key their row by the original entity's id (one snapshot per entity),
          // so this must be an upsert: a restore-then-delete cycle would otherwise collide on id.
          await tx[camelCaseModel].upsert({
            where: { id: entityId },
            create: {
              id: entityId,
              ...(recycleBinHasOrgId ? { organization_id: organizationId } : {}),
              original_id: entityId,
              snapshot,
              deleted_at: new Date(),
              deleted_by_id: adminId
            },
            update: {
              snapshot,
              deleted_at: new Date(),
              deleted_by_id: adminId
            }
          });
        }
      }

      // 4. Audit Log
      // AuditLog.organization_id is a required FK to a real Organization row.
      // organizationType/subscriptionPlan/discountRule are system-wide catalog
      // data with no owning organization, so there is nothing valid to log
      // against here - skip rather than writing a bogus/non-existent id that
      // would violate the FK constraint and abort the whole delete.
      const hasNoOwningOrg = ['organizationType', 'subscriptionPlan', 'discountRule'].includes(entityType);
      if (!hasNoOwningOrg) {
        await tx.auditLog.create({
          data: {
            organization_id: organizationId,
            user_id: adminId,
            action: `DELETE_${entityType.toUpperCase()}`,
            table_affected: entityType.toUpperCase(),
            record_id: entityId.toString(),
            before: { status: existing.status || 'ACTIVE' },
            after: { status: updateData.status || 'DELETED' },
            ip_address: '127.0.0.1'
          }
        });
      }

      return deletedEntity;
    };
    return existingTx ? execute(existingTx) : prisma.$transaction(execute);
  }

  /**
   * Universal Restore
   */
  static async restore(
    organizationId: bigint,
    entityType: any,
    entityId: bigint | string,
    adminId: bigint | string
  ) {
    return prisma.$transaction(async (tx: any) => {
      // 1. Fetch the existing deleted entity
      const isGlobal = ['organization', 'organizationType', 'subscriptionPlan', 'discountRule'].includes(entityType);
      const whereClause = isGlobal ? { id: entityId } : { id: entityId, organization_id: organizationId };
      const existing = await tx[entityType].findFirst({
        where: whereClause
      });

      if (!existing) throw new Error(`${entityType} not found`);
      if (!existing.is_deleted) throw new Error(`${entityType} is not deleted`);
      if (existing.restore_allowed === false) throw new Error(`Restoring this ${entityType} is permanently locked`);

      // 2. Perform the Restore
      const updateData: any = {
        is_deleted: false,
        deleted_at: null,
        deleted_by_id: null
      };

      if (existing.status !== undefined) {
        if (['product', 'customer', 'supplier', 'branch', 'category'].includes(entityType)) {
          updateData.status = 'ACTIVE';
        } else if (['sale'].includes(entityType)) {
          updateData.status = 'COMPLETED';
        } else if (['purchaseOrder'].includes(entityType)) {
          updateData.status = 'PENDING';
        }
      }

      const restoredEntity = await tx[entityType].update({
        where: { id: entityId },
        data: updateData
      });

      // 3. Audit Log
      await tx.auditLog.create({
        data: {
          organization_id: organizationId,
          user_id: adminId,
          action: `RESTORE_${entityType.toUpperCase()}`,
          table_affected: entityType.toUpperCase(),
          record_id: entityId.toString(),
          before: { status: existing.status || 'DELETED' },
          after: { status: updateData.status || 'ACTIVE' },
          ip_address: '127.0.0.1'
        }
      });

      return restoredEntity;
    });
  }
}
