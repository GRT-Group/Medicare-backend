import { NextRequest, NextResponse } from 'next/server'
import { friendlyMessage } from '@/lib/api-error'
import { AuthService } from '@/services/auth.service'
import { issueFlowToken } from '@/lib/flow-token'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { 
      organizationName, 
      organizationTypeId, 
      firstName, 
      lastName, 
      email, 
      phone, 
      password,
      businessUnit,
      taxId,
      registrationNumber,
      licenseNumber,
      website,
      address,
      businessLicenseUrl
    } = body

    // Validation
    if (!organizationName || !organizationTypeId || !firstName || !lastName || !email || !password) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 })
    }

    const { org, user } = await AuthService.registerTenant({
      organizationName,
      organizationTypeId: BigInt(organizationTypeId),
      firstName,
      lastName,
      email,
      phone,
      password,
      businessUnit,
      taxId,
      registrationNumber,
      licenseNumber,
      website,
      address,
      country: address?.country,
      businessLicenseUrl
    })

    // Send the login-style OTP here (not EMAIL_VERIFICATION) since the OTP
    // page's verify-otp call only ever checks LOGIN_2FA-type tokens — this
    // is the one the freshly registered user will actually be asked for.
    // Gets a longer 1-hour window (vs. 5 minutes for a returning login)
    // since a new signup may still be reading a welcome email or choosing a
    // plan before coming back to verify.
    const { expiresAt: otpExpiresAt } = await AuthService.sendOtp(user.id, user.email, user.phone || undefined, 'LOGIN_2FA', 60)

    // Short-lived flow token proving this browser just registered this
    // user, required by /api/subscriptions/subscribe.
    const flowToken = issueFlowToken({
      userId: user.id,
      organizationId: org.id,
      step: 'subscribe',
    })

    return NextResponse.json({
      success: true,
      message: 'Account created successfully. Please check your email for the verification code.',
      data: {
        organizationId: org.id.toString(),
        userId: user.id.toString(),
        publicId: user.public_id,
        flowToken,
        otpExpiresAt
      }
    }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: friendlyMessage(error) },
      { status: 400 }
    )
  }
}
