import { NotificationService } from '@/services/notification.service';
import { friendlyMessage } from '@/lib/api-error'
import { getBearerToken, verifyBearerToken } from '@/lib/auth-utils';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req.headers);
    if (!token) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    try {
      const decoded = verifyBearerToken(req.headers);
      const userId = BigInt(decoded.id || decoded.user_id);
      const preferences = await NotificationService.getUserPreferences(userId);

      return NextResponse.json({
        success: true,
        data: preferences
      }, { status: 200 });
    } catch (e) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Invalid token' }, { status: 401 });
    }

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

    try {
      const decoded = verifyBearerToken(req.headers);
      const userId = BigInt(decoded.id || decoded.user_id);
      const body = await req.json();
      const { smsEnabled, emailEnabled, authSmsEnabled, authEmailEnabled, systemSmsEnabled, systemEmailEnabled } = body;

      const updatedPreferences = await NotificationService.updatePreferences(userId, {
        smsEnabled,
        emailEnabled,
        authSmsEnabled,
        authEmailEnabled,
        systemSmsEnabled,
        systemEmailEnabled
      });

      return NextResponse.json({
        success: true,
        message: 'Notification preferences updated successfully',
        data: updatedPreferences
      }, { status: 200 });
    } catch (e) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Invalid token' }, { status: 401 });
    }

  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 });
  }
}
