// @ts-nocheck
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';

/**
 * A farmer-customer's declared farm assets (crops grown, livestock kept —
 * e.g. "Cow" x3, "Maize" 2 acres, "Hen" x20). Agrovet-specific customer
 * profile data used for targeted product recommendations (feed/vet
 * supplies) and vet visit tracking.
 *
 * Stored inside the existing Customer.metadata JSON field (metadata.farm_assets:
 * FarmAsset[]) rather than a dedicated table, so no schema migration is
 * needed and it merges cleanly with any other data already in metadata.
 */

type FarmAssetType = 'CROP' | 'LIVESTOCK';

type FarmAsset = {
  id: string;
  type: FarmAssetType;
  name: string;
  quantity: number;
  unit: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function getFarmAssets(metadata: any): FarmAsset[] {
  if (!metadata || !Array.isArray(metadata.farm_assets)) return [];
  return metadata.farm_assets;
}

function setFarmAssets(metadata: any, assets: FarmAsset[]): any {
  return { ...(metadata || {}), farm_assets: assets };
}

export class CustomerFarmAssetService {
  static async getForCustomer(customerId: bigint, organizationId: bigint) {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, organization_id: organizationId, deleted_at: null },
      select: { metadata: true },
    });
    if (!customer) throw new Error('Customer not found');

    return getFarmAssets(customer.metadata).sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  }

  static async create(organizationId: bigint, customerId: bigint, data: {
    type: FarmAssetType | string;
    name: string;
    quantity?: number;
    unit?: string;
    notes?: string;
  }) {
    if (!data.name) throw new Error('name is required');
    if (data.type !== 'CROP' && data.type !== 'LIVESTOCK') {
      throw new Error('type must be CROP or LIVESTOCK');
    }

    const customer = await prisma.customer.findFirst({
      where: { id: customerId, organization_id: organizationId, deleted_at: null },
      select: { metadata: true },
    });
    if (!customer) throw new Error('Customer not found');

    const now = new Date().toISOString();
    const newAsset: FarmAsset = {
      id: crypto.randomUUID(),
      type: data.type,
      name: data.name,
      quantity: data.quantity ?? 1,
      unit: data.unit ?? null,
      notes: data.notes ?? null,
      created_at: now,
      updated_at: now,
    };

    const assets = [...getFarmAssets(customer.metadata), newAsset];
    await prisma.customer.update({
      where: { id: customerId },
      data: { metadata: setFarmAssets(customer.metadata, assets) },
    });

    return newAsset;
  }

  static async update(customerId: bigint, organizationId: bigint, assetId: string, data: Partial<{
    type: FarmAssetType | string;
    name: string;
    quantity: number;
    unit: string;
    notes: string;
  }>) {
    if (data.type !== undefined && data.type !== 'CROP' && data.type !== 'LIVESTOCK') {
      throw new Error('type must be CROP or LIVESTOCK');
    }

    const customer = await prisma.customer.findFirst({
      where: { id: customerId, organization_id: organizationId, deleted_at: null },
      select: { metadata: true },
    });
    if (!customer) throw new Error('Customer not found');

    const assets = getFarmAssets(customer.metadata);
    const index = assets.findIndex(a => a.id === assetId);
    if (index === -1) throw new Error('Farm asset not found');

    const updated: FarmAsset = {
      ...assets[index],
      ...(data.type !== undefined ? { type: data.type as FarmAssetType } : {}),
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.quantity !== undefined ? { quantity: data.quantity } : {}),
      ...(data.unit !== undefined ? { unit: data.unit } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
      updated_at: new Date().toISOString(),
    };
    assets[index] = updated;

    await prisma.customer.update({
      where: { id: customerId },
      data: { metadata: setFarmAssets(customer.metadata, assets) },
    });

    return updated;
  }

  static async delete(customerId: bigint, organizationId: bigint, assetId: string) {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, organization_id: organizationId, deleted_at: null },
      select: { metadata: true },
    });
    if (!customer) throw new Error('Customer not found');

    const assets = getFarmAssets(customer.metadata);
    const filtered = assets.filter(a => a.id !== assetId);
    if (filtered.length === assets.length) throw new Error('Farm asset not found');

    await prisma.customer.update({
      where: { id: customerId },
      data: { metadata: setFarmAssets(customer.metadata, filtered) },
    });
  }
}
