import { NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error';
import { MasterDataService } from '@/services/master-data.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function GET(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const units = await MasterDataService.getRecords('unitOfMeasure', BigInt(orgId));
    return NextResponse.json(units, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id');
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const body = await req.json();
    
    // Support standard fields from the frontend
    const payload = {
      name: body.name,
      abbreviation: body.abbreviation,
      description: body.description,
      status: body.status || 'ACTIVE'
    };

    const unit = await MasterDataService.createRecord('unitOfMeasure', BigInt(orgId), payload);
    return NextResponse.json(unit, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    
    if (!orgId || !id) return NextResponse.json({ error: 'Missing organization ID or unit ID' }, { status: 400 });

    const body = await req.json();
    const payload = {
      name: body.name,
      abbreviation: body.abbreviation,
      description: body.description,
      status: body.status
    };
    
    // Remove undefined values
    Object.keys(payload).forEach(key => (payload as any)[key] === undefined && delete (payload as any)[key]);

    const unit = await MasterDataService.updateRecord('unitOfMeasure', BigInt(id), BigInt(orgId), payload);
    return NextResponse.json(unit, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id');
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    
    if (!orgId || !id) return NextResponse.json({ error: 'Missing organization ID or unit ID' }, { status: 400 });

    await MasterDataService.deleteRecord('unitOfMeasure', BigInt(id), BigInt(orgId), adminId ? BigInt(adminId) : BigInt(0));
    return NextResponse.json({ message: 'Unit of measure deleted' }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
