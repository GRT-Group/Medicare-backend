import { NextRequest, NextResponse } from 'next/server';
import { ArchiveService } from '@/services/archive.service';
import { getBearerToken, verifyBearerToken } from '@/lib/auth-utils';
import { PermissionService } from '@/services/permission.service';

export async function GET(req: NextRequest) {
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

    const roleId = Number(decoded.role_id);
    if (!PermissionService.isAdminOrHigher(roleId)) {
      return NextResponse.json({ success: false, error: 'Forbidden: Requires Admin privileges' }, { status: 403 });
    }

    let organizationId = decoded.organization_id;
    const searchParams = req.nextUrl.searchParams;
    
    if (PermissionService.isSuperAdmin(roleId) && searchParams.get('organizationId')) {
      organizationId = searchParams.get('organizationId');
    }

    if (!organizationId && !PermissionService.isSuperAdmin(roleId)) {
      return NextResponse.json({ success: false, error: 'Forbidden: No organization assigned to your account' }, { status: 403 });
    }

    const targetOrgId = organizationId ? BigInt(organizationId) : BigInt(0);
    const entityType = searchParams.get('entityType') || undefined;

    const items = await ArchiveService.getRecycleBinItems(targetOrgId, entityType);

    return NextResponse.json({
      success: true,
      data: items
    }, { status: 200 });

  } catch (error: any) {
    const message = typeof error?.message === 'string' ? error.message : 'Failed to fetch recycle bin items';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
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

    const roleId = Number(decoded.role_id);
    if (!PermissionService.isAdminOrHigher(roleId)) {
      return NextResponse.json({ success: false, error: 'Forbidden: Requires Admin privileges' }, { status: 403 });
    }

    const body = await req.json();
    const { entityType, entityId } = body;

    let organizationId = decoded.organization_id;
    if (PermissionService.isSuperAdmin(roleId) && body.organizationId) {
      organizationId = body.organizationId;
    }

    if (!organizationId && !PermissionService.isSuperAdmin(roleId)) {
      return NextResponse.json({ success: false, error: 'Forbidden: No organization assigned to your account' }, { status: 403 });
    }

    if (!entityType || !entityId) {
      return NextResponse.json({ success: false, error: 'entityType and entityId are required' }, { status: 400 });
    }

    const targetOrgId = organizationId ? BigInt(organizationId) : BigInt(0);
    const adminId = BigInt(decoded.id);

    // Ensure entityType is properly camelCased for Prisma calls
    const camelEntity = entityType.charAt(0).toLowerCase() + entityType.slice(1);

    const result = await ArchiveService.permanentlyDelete(targetOrgId, camelEntity, BigInt(entityId), adminId);

    return NextResponse.json({
      success: true,
      message: `${camelEntity} permanently deleted`,
      data: { ...result, id: result.id.toString() }
    }, { status: 200 });

  } catch (error: any) {
    console.error('[Archive Delete Error]:', error); // Log to server console so we can see what exactly failed
    const message = typeof error?.message === 'string' ? error.message : 'Permanent delete failed';
    const isForeignKeyError = /Foreign key constraint/i.test(message);
    
    const status = /not found/i.test(message)
      ? 404
      : /must be soft-deleted first/i.test(message)
        ? 400
        : isForeignKeyError
          ? 409
          : 500;
          
    const friendlyMessage = isForeignKeyError 
      ? 'Cannot permanently delete this item because it is referenced by other records (e.g., existing sales, branches, or logs).' 
      : message;

    return NextResponse.json({ success: false, error: friendlyMessage }, { status });
  }
}
