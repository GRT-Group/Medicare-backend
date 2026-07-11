import { NextRequest, NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { UserService } from '@/services/user.service';
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
    const { action, oldPassword, newPassword, otpCode } = body;

    const userId = BigInt(decoded.id);

    if (action === 'REQUEST_OTP') {
      if (!oldPassword) return NextResponse.json({ success: false, error: 'Old password is required' }, { status: 400 });
      const result = await UserService.requestPasswordChange(userId, oldPassword);
      return NextResponse.json(result, { status: 200 });
    } 
    
    if (action === 'VERIFY_AND_CHANGE') {
      if (!newPassword || !otpCode) return NextResponse.json({ success: false, error: 'New password and OTP code are required' }, { status: 400 });
      const result = await UserService.verifyPasswordChange(userId, newPassword, otpCode);
      return NextResponse.json(result, { status: 200 });
    }

    return NextResponse.json({ success: false, error: 'Invalid action. Use REQUEST_OTP or VERIFY_AND_CHANGE' }, { status: 400 });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 });
  }
}
