// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import { friendlyMessage } from '@/lib/api-error'
import { AuthService } from '@/services/auth.service'
import { getFlowToken, verifyFlowToken, FlowTokenError } from '@/lib/flow-token'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { code } = body

    if (!code) {
      return NextResponse.json({ success: false, error: 'OTP code is required' }, { status: 400 })
    }

    // The flow token (issued by register/login, or a resumed subscribe) is
    // the sole source of truth for which user this is — the frontend never
    // needs to know or send the raw numeric id, so it never has to appear
    // in a URL or request body. A code alone (even with a userId attached)
    // was never sufficient here anyway.
    const flowPayload = verifyFlowToken(getFlowToken(req.headers), 'verify-otp')
    const userId = body.userId ? String(body.userId) : flowPayload.userId
    if (flowPayload.userId !== userId) {
      return NextResponse.json({ success: false, error: 'Your session has expired. Please start again.' }, { status: 403 })
    }

    // Get IP address and user agent for session tracking
    const ipAddress = req.headers.get('x-forwarded-for') || 'unknown'
    const userAgent = req.headers.get('user-agent') || 'unknown'

    const { user, token } = await AuthService.verifyLoginOtp(BigInt(userId), code, ipAddress, userAgent)

    const response = NextResponse.json({
      success: true,
      message: 'Login successful. OTP verified.',
      data: {
        token,
        user: {
          id: user.id.toString(),
          publicId: user.public_id,
          firstName: user.first_name,
          first_name: user.first_name,
          lastName: user.last_name,
          last_name: user.last_name,
          email: user.email,
          roleId: user.role_id.toString(),
          role_id: user.role_id.toString(),
          role: user.role ? { name: user.role.name } : null,
          organizationId: user.organization_id?.toString(),
          organization_id: user.organization_id?.toString()
        }
      }
    })

    response.cookies.set('medicare_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 7
    })

    return response
  } catch (error: any) {
    if (error instanceof FlowTokenError || error?.name === 'FlowTokenError' || error?.message?.includes('session has expired')) {
      return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 401 })
    }
    const message = error?.message || 'Invalid or expired verification code.'
    const status = /too many incorrect attempts/i.test(message)
      ? 429
      : /invalid or expired verification code|invalid verification code/i.test(message)
        ? 400
        : 500
        
    if (status === 500) {
      console.error("[API/verify-otp] UNEXPECTED 500 ERROR:", error);
    }
        
    return NextResponse.json(
      { success: false, error: message },
      { status }
    )
  }
}


