import { NextRequest, NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { UserService } from '@/services/user.service';
import { getBearerToken, verifyBearerToken } from '@/lib/auth-utils';

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

    const safeUser = await UserService.getUserById(BigInt(decoded.id));

    if (!safeUser) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    // Serialize permissions
    const serializedPermissions = safeUser.permissions.map((p: any) => ({
      ...p,
      id: p.id.toString(),
      deleted_by_id: p.deleted_by_id?.toString()
    }));

    return NextResponse.json({
      success: true,
      data: {
        ...safeUser,
        id: safeUser.id.toString(),
        organization_id: safeUser.organization_id?.toString(),
        role_id: safeUser.role_id.toString(),
        branch_id: safeUser.branch_id?.toString(),
        permissions: serializedPermissions
      }
    }, { status: 200 });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
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
    const { first_name, last_name, phone } = body;

    const safeUser = await UserService.updateProfile(BigInt(decoded.id), { first_name, last_name, phone });

    return NextResponse.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        ...safeUser,
        id: safeUser.id.toString(),
        organization_id: safeUser.organization_id?.toString(),
        role_id: safeUser.role_id.toString(),
        branch_id: safeUser.branch_id?.toString()
      }
    }, { status: 200 });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 });
  }
}
