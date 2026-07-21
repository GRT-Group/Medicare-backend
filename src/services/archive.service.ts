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
      const actualOrgId = existing.organization_id || organizationId;
      const hasNoOwningOrg = ['organizationType', 'subscriptionPlan', 'discountRule', 'organization'].includes(entityType) || !actualOrgId || actualOrgId === BigInt(0);
      if (!hasNoOwningOrg) {
        await tx.auditLog.create({
          data: {
            organization_id: actualOrgId,
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
      const whereClause = isGlobal || organizationId === BigInt(0) ? { id: entityId } : { id: entityId, organization_id: organizationId };
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

      // 2.5 Remove from Archive Table (_RecycleBin)
      const recycleBinModel = entityType.charAt(0).toUpperCase() + entityType.slice(1) + '_RecycleBin';
      if (tx[recycleBinModel] || tx[`${entityType}_RecycleBin`]) {
        const targetModel = tx[recycleBinModel] ? recycleBinModel : `${entityType}_RecycleBin`;
        const camelCaseModel = targetModel.charAt(0).toLowerCase() + targetModel.slice(1);
        if (tx[camelCaseModel]) {
          await tx[camelCaseModel].delete({
            where: { id: entityId }
          }).catch(() => {}); // Ignore if it doesn't exist in recycle bin
        }
      }

      // 3. Audit Log
      const actualOrgId = existing.organization_id || organizationId;
      const hasNoOwningOrg = ['organizationType', 'subscriptionPlan', 'discountRule', 'organization'].includes(entityType) || !actualOrgId || actualOrgId === BigInt(0);
      if (!hasNoOwningOrg) {
        await tx.auditLog.create({
          data: {
            organization_id: actualOrgId,
            user_id: adminId,
            action: `RESTORE_${entityType.toUpperCase()}`,
            table_affected: entityType.toUpperCase(),
            record_id: entityId.toString(),
            before: { status: existing.status || 'DELETED' },
            after: { status: updateData.status || 'ACTIVE' },
            ip_address: '127.0.0.1'
          }
        });
      }

      return restoredEntity;
    });
  }

  /**
   * Fetch Recycle Bin Items
   */
  static async getRecycleBinItems(organizationId: bigint, filterEntityType?: string) {
    // Default entities to show when no filter is provided (to prevent querying 30+ tables at once)
    const defaultEntities = [
      'product', 'supplier', 'customer', 'sale', 'purchaseOrder', 'cashSession', 'user', 'category', 'stockTransfer', 'return',
      'branch', 'organization', 'organizationType', 'subscriptionPlan', 'discountRule'
    ];

    const entitiesToQuery = filterEntityType ? [filterEntityType] : defaultEntities;

    let allItems: any[] = [];

    for (const entityType of entitiesToQuery) {
      const recycleBinModel = entityType.charAt(0).toUpperCase() + entityType.slice(1) + '_RecycleBin';
      const camelCaseModel = recycleBinModel.charAt(0).toLowerCase() + recycleBinModel.slice(1);

      if ((prisma as any)[camelCaseModel]) {
        // Some tables like subscriptionPlan are global and don't have organization_id
        const isGlobal = ['organization', 'organizationType', 'subscriptionPlan', 'discountRule'].includes(entityType);
        
        const items = await (prisma as any)[camelCaseModel].findMany({
          where: isGlobal || organizationId === BigInt(0) ? undefined : { organization_id: organizationId },
          orderBy: { deleted_at: 'desc' }
        });
        
        allItems.push(...items.map((item: any) => ({
          entityType,
          id: item.id.toString(),
          original_id: item.original_id ? item.original_id.toString() : null,
          snapshot: item.snapshot,
          deleted_at: item.deleted_at,
          deleted_by_id: item.deleted_by_id ? item.deleted_by_id.toString() : null
        })));
      } else if (filterEntityType) {
        throw new Error(`Recycle bin for entity type '${filterEntityType}' does not exist.`);
      }
    }

    // Sort combined items by deleted_at desc
    allItems.sort((a, b) => new Date(b.deleted_at).getTime() - new Date(a.deleted_at).getTime());

    // Fetch user details for deleted_by_id
    const userIds = [...new Set(allItems.map(i => i.deleted_by_id).filter(Boolean))].map(id => BigInt(id));
    if (userIds.length > 0) {
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, first_name: true, last_name: true }
      });
      const userMap = new Map(users.map(u => [u.id.toString(), u]));
      allItems = allItems.map(item => ({
        ...item,
        deleted_by_user: item.deleted_by_id && userMap.has(item.deleted_by_id) 
          ? { 
              first_name: userMap.get(item.deleted_by_id)!.first_name, 
              last_name: userMap.get(item.deleted_by_id)!.last_name 
            } 
          : null
      }));
    }

    return allItems;
  }

  /**
   * Permanent Delete
   */
  static async permanentlyDelete(
    organizationId: bigint,
    entityType: string,
    entityId: bigint,
    adminId: bigint
  ) {
    return prisma.$transaction(async (tx: any) => {
      // 1. Validate entity exists and is deleted
      const isGlobal = ['organization', 'organizationType', 'subscriptionPlan', 'discountRule'].includes(entityType);
      const whereClause = isGlobal || organizationId === BigInt(0) ? { id: entityId } : { id: entityId, organization_id: organizationId };
      const existing = await tx[entityType].findFirst({
        where: whereClause
      });

      if (!existing) throw new Error(`${entityType} not found`);
      if (!existing.is_deleted) throw new Error(`${entityType} must be soft-deleted first`);

      // 2. Delete from _RecycleBin
      const recycleBinModel = entityType.charAt(0).toUpperCase() + entityType.slice(1) + '_RecycleBin';
      const targetModel = tx[recycleBinModel] ? recycleBinModel : `${entityType}_RecycleBin`;
      const camelCaseModel = targetModel.charAt(0).toLowerCase() + targetModel.slice(1);

      if (tx[camelCaseModel]) {
        await tx[camelCaseModel].delete({
          where: { id: entityId }
        }).catch(() => {});
      }

      // 3. Delete from original table
      await tx[entityType].delete({
        where: { id: entityId }
      });

      // 4. Audit Log
      const actualOrgId = existing.organization_id || organizationId;
      const hasNoOwningOrg = ['organizationType', 'subscriptionPlan', 'discountRule', 'organization'].includes(entityType) || !actualOrgId || actualOrgId === BigInt(0);
      if (!hasNoOwningOrg) {
        await tx.auditLog.create({
          data: {
            organization_id: actualOrgId,
            user_id: adminId,
            action: `PERMANENT_DELETE_${entityType.toUpperCase()}`,
            table_affected: entityType.toUpperCase(),
            record_id: entityId.toString(),
            before: { status: existing.status || 'DELETED' },
            after: null,
            ip_address: '127.0.0.1'
          }
        });
      }

      return { id: entityId, success: true };
    });
  }
}
