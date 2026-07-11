import { NextRequest, NextResponse } from 'next/server'
import { friendlyMessage } from '@/lib/api-error'
import { AuthService } from '@/services/auth.service'
import { getFlowToken, verifyFlowToken, FlowTokenError } from '@/lib/flow-token'

// A resend can't tell from `type` alone whether this is a fresh
// registration's verification code (longer-lived) or a returning login's
// code (short-lived) - both send LOGIN_2FA. The frontend states which flow
// it's on via `origin`; this only picks a display/expiry duration, it's not
// a trust boundary (attempts/expiry are still enforced server-side
// regardless of what's claimed here).
const REGISTRATION_OTP_TTL_MINUTES = 60
const LOGIN_OTP_TTL_MINUTES = 5

/**
 * Triggers sending an OTP (resend). Requires the same flow token issued by
 * register/login, scoped to this user, so a bare userId can't be used to
 * spam OTPs to an arbitrary account.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, phone, type, origin } = body

    if (!type) {
      return NextResponse.json({ success: false, error: 'Missing required field: type' }, { status: 400 })
    }

    // userId comes from the flow token, not the request body/URL - the
    // frontend never needs to know or carry the raw numeric id.
    const flowPayload = verifyFlowToken(getFlowToken(req.headers), 'verify-otp')
    const userId = body.userId ? String(body.userId) : flowPayload.userId
    if (flowPayload.userId !== userId) {
      return NextResponse.json({ success: false, error: 'Your session has expired. Please start again.' }, { status: 403 })
    }

    const ttlMinutes = origin === 'register' ? REGISTRATION_OTP_TTL_MINUTES : LOGIN_OTP_TTL_MINUTES
    const { expiresAt } = await AuthService.sendOtp(BigInt(userId), email, phone, type, ttlMinutes)

    return NextResponse.json({
      success: true,
      message: 'OTP sent successfully',
      data: { otpExpiresAt: expiresAt }
    })
  } catch (error: any) {
    if (error instanceof FlowTokenError) {
      return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 401 })
    }
    const status = /wait \d+s before requesting/i.test(error?.message || '') ? 429 : 500
    return NextResponse.json(
      { success: false, error: friendlyMessage(error) },
      { status }
    )
  }
}

/**
 * Verifies an OTP (used for EMAIL_VERIFICATION / PASSWORD_RESET flows).
 * Requires the same flow token issued by register/login, scoped to this
 * user, so a code alone is never sufficient to progress the flow.
 */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const { code, type } = body

    if (!code || !type) {
      return NextResponse.json({ success: false, error: 'Missing required fields: code, type' }, { status: 400 })
    }

    const flowPayload = verifyFlowToken(getFlowToken(req.headers), 'verify-otp')
    const userId = body.userId ? String(body.userId) : flowPayload.userId
    if (flowPayload.userId !== userId) {
      return NextResponse.json({ success: false, error: 'Your session has expired. Please start again.' }, { status: 403 })
    }

    await AuthService.verifyOtp(BigInt(userId), code, type)

    return NextResponse.json({
      success: true,
      message: 'OTP verified successfully'
    })
  } catch (error: any) {
    if (error instanceof FlowTokenError) {
      return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 401 })
    }
    const status = /too many incorrect attempts/i.test(error?.message || '') ? 429 : 400
    return NextResponse.json(
      { success: false, error: friendlyMessage(error) },
      { status }
    )
  }
}
