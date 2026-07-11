// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import { friendlyMessage } from '@/lib/api-error'
import { AuthService } from '@/services/auth.service'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { identifier, password } = body

    if (!identifier || !password) {
      return NextResponse.json({ success: false, error: 'Identifier (email/phone) and password are required' }, { status: 400 })
    }

    // Get IP address and user agent for session tracking
    const ipAddress = req.headers.get('x-forwarded-for') || 'unknown'
    const userAgent = req.headers.get('user-agent') || 'unknown'

    const result = await AuthService.login(identifier, password)

    return NextResponse.json({
      success: true,
      message: result.message,
      data: {
        requireOtp: result.requireOtp,
        userId: result.userId.toString(),
        flowToken: result.flowToken,
        otpExpiresAt: result.otpExpiresAt,
        user: {
          publicId: result.user.public_id,
          firstName: result.user.first_name,
          lastName: result.user.last_name,
          email: result.user.email,
          phone: result.user.phone,
          role: result.user.role ? { name: result.user.role.name } : null
        }
      }
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: friendlyMessage(error) },
      { status: 401 }
    )
  }
}
