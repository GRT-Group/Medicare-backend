import { NextRequest, NextResponse } from 'next/server';
import { getBearerToken, verifyBearerToken } from '@/lib/auth-utils';
import { PermissionService } from '@/services/permission.service';
import { AuditService } from '@/services/audit.service';

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
    
    if (PermissionService.isSuperAdmin(roleId) && searchParams.get('organization_id')) {
      organizationId = searchParams.get('organization_id');
    }

    if (!organizationId && !PermissionService.isSuperAdmin(roleId)) {
      return NextResponse.json({ success: false, error: 'Forbidden: No organization assigned to your account' }, { status: 403 });
    }

    const targetOrgId = organizationId ? BigInt(organizationId) : BigInt(0);
    const limit = searchParams.get('limit') ? Number(searchParams.get('limit')) : 50;
    const offset = searchParams.get('offset') ? Number(searchParams.get('offset')) : 0;

    const result = await AuditService.list(targetOrgId, { limit, offset });

    return NextResponse.json({
      success: true,
      data: result.items
    }, { status: 200 });

  } catch (error: any) {
    const message = typeof error?.message === 'string' ? error.message : 'Failed to fetch audit logs';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
