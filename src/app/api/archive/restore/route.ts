import { NextRequest, NextResponse } from 'next/server';
import { ArchiveService } from '@/services/archive.service';
import { getBearerToken, verifyBearerToken } from '@/lib/auth-utils';

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req.headers);
    if (!token) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    let decoded: any;
    try {
      decoded = verifyBearerToken(req.headers);
    } catch (e) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Invalid token' }, { status: 401 });
    }

    const body = await req.json();
    const { entityType, entityId } = body;

    if (!entityType || !entityId) {
      return NextResponse.json({ success: false, error: 'entityType and entityId are required' }, { status: 400 });
    }

    if (!decoded.organization_id) {
      return NextResponse.json({ success: false, error: 'Forbidden: No organization assigned to your account' }, { status: 403 });
    }

    const organizationId = BigInt(decoded.organization_id);
    const adminId = BigInt(decoded.id);

    const result = await ArchiveService.restore(organizationId, entityType as any, BigInt(entityId), adminId);

    return NextResponse.json({
      success: true,
      message: `${entityType} restored successfully`,
      data: { ...result, id: result.id.toString() }
    }, { status: 200 });

  } catch (error: any) {
    const message = typeof error?.message === 'string' ? error.message : 'Restore failed';
    const status = /not found/i.test(message)
      ? 404
      : /already deleted|is not deleted|permanently locked/i.test(message)
        ? 400
        : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
