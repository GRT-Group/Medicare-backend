import { NextRequest, NextResponse } from 'next/server'
import { friendlyMessage } from '@/lib/api-error'
import { prisma } from '@/lib/prisma'
import { AuthService } from '@/services/auth.service'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { identifier } = body

    if (!identifier) {
      return NextResponse.json({ success: false, error: 'Please provide your email or phone number.' }, { status: 400 })
    }

    // Lookup user by email or phone
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: identifier },
          { phone: identifier }
        ],
        deleted_at: null // ensure user is active
      }
    })

    // Always respond the same way whether or not the account exists - this is
    // a password-reset endpoint, so a different status/message per case would
    // let anyone enumerate which emails/phones are registered.
    if (!user) {
      // Keep the response shape identical to the found-user case (still
      // includes `data.userId`, just null) so callers that read
      // response.data.userId don't throw on the not-found path.
      return NextResponse.json({
        success: true,
        message: 'If an account exists for that email or phone number, a password reset code has been sent.',
        data: {
          userId: null
        }
      }, { status: 200 })
    }

    // Generate and send OTP using AuthService
    await AuthService.sendOtp(user.id, user.email, user.phone || undefined, 'PASSWORD_RESET')

    return NextResponse.json({
      success: true,
      message: 'If an account exists for that email or phone number, a password reset code has been sent.',
      data: {
        userId: user.id.toString()
      }
    }, { status: 200 })

  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: friendlyMessage(error) },
      { status: 500 }
    )
  }
}
