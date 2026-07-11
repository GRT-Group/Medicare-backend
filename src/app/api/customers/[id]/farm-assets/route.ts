// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { CustomerFarmAssetService } from '@/services/customer-farm-asset.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

/**
 * Farm assets (crops/livestock) declared for a customer — agrovet-specific
 * profile data stored in Customer.metadata.farm_assets. GET lists, POST adds
 * one; PUT/DELETE target a specific asset via ?assetId=<uuid>.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const orgId = req.headers.get('x-organization-id');
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const { id } = await params;
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'Invalid customer id' }, { status: 400 });

    const assets = await CustomerFarmAssetService.getForCustomer(BigInt(id), BigInt(orgId));
    return NextResponse.json(assets, { status: 200 });
  } catch (error: any) {
    if (/not found/i.test(error?.message ?? '')) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const orgId = req.headers.get('x-organization-id');
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const { id } = await params;
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'Invalid customer id' }, { status: 400 });

    const body = await req.json();
    const asset = await CustomerFarmAssetService.create(BigInt(orgId), BigInt(id), {
      type: body.type,
      name: body.name,
      quantity: body.quantity,
      unit: body.unit,
      notes: body.notes,
    });

    return NextResponse.json(asset, { status: 201 });
  } catch (error: any) {
    const status = /not found/i.test(error?.message ?? '') ? 404 : 400;
    return NextResponse.json({ error: friendlyMessage(error) }, { status });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const orgId = req.headers.get('x-organization-id');
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const { id } = await params;
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'Invalid customer id' }, { status: 400 });

    const url = new URL(req.url);
    const assetId = url.searchParams.get('assetId');
    if (!assetId) return NextResponse.json({ error: 'Missing assetId in query parameters' }, { status: 400 });

    const body = await req.json();
    const asset = await CustomerFarmAssetService.update(BigInt(id), BigInt(orgId), assetId, {
      type: body.type,
      name: body.name,
      quantity: body.quantity,
      unit: body.unit,
      notes: body.notes,
    });

    return NextResponse.json(asset, { status: 200 });
  } catch (error: any) {
    const status = /not found/i.test(error?.message ?? '') ? 404 : 400;
    return NextResponse.json({ error: friendlyMessage(error) }, { status });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const orgId = req.headers.get('x-organization-id');
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const { id } = await params;
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'Invalid customer id' }, { status: 400 });

    const url = new URL(req.url);
    const assetId = url.searchParams.get('assetId');
    if (!assetId) return NextResponse.json({ error: 'Missing assetId in query parameters' }, { status: 400 });

    await CustomerFarmAssetService.delete(BigInt(id), BigInt(orgId), assetId);
    return NextResponse.json({ message: 'Farm asset removed' }, { status: 200 });
  } catch (error: any) {
    const status = /not found/i.test(error?.message ?? '') ? 404 : 400;
    return NextResponse.json({ error: friendlyMessage(error) }, { status });
  }
}
