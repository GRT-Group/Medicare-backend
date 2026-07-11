import { NextRequest, NextResponse } from 'next/server'
import { friendlyMessage } from '@/lib/api-error'
import { prisma } from '@/lib/prisma'
import { AuthService } from '@/services/auth.service'
import bcrypt from 'bcryptjs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { identifier, code, newPassword, confirmPassword } = body

    if (!identifier || !code || !newPassword || !confirmPassword) {
      return NextResponse.json({ success: false, error: 'Missing required fields: identifier, code, newPassword, confirmPassword' }, { status: 400 })
    }

    if (newPassword !== confirmPassword) {
      return NextResponse.json({ success: false, error: 'New password and confirm password do not match.' }, { status: 400 })
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ success: false, error: 'Password must be at least 8 characters long.' }, { status: 400 })
    }

    // 1. Lookup user by email or phone
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: identifier },
          { phone: identifier }
        ],
        deleted_at: null
      }
    })

    if (!user) {
      return NextResponse.json({ success: false, error: 'No active account found with that email or phone number.' }, { status: 404 })
    }

    // 2. Verify OTP (AuthService will throw an error if invalid/expired)
    try {
      await AuthService.verifyOtp(user.id, code, 'PASSWORD_RESET')
    } catch (e: any) {
      return NextResponse.json({ success: false, error: e.message || 'Invalid or expired verification code.' }, { status: 400 })
    }

    // 3. Hash the new password securely
    const passwordHash = await bcrypt.hash(newPassword, 10)

    // 4. Update user password
    await prisma.user.update({
      where: { id: user.id },
      data: { password_hash: passwordHash }
    })

    // Optional: Invalidate active sessions to force re-login on all devices
    await prisma.userSession.updateMany({
      where: { user_id: user.id, status: 'ACTIVE' },
      data: { status: 'INACTIVE' }
    })

    return NextResponse.json({ 
      success: true, 
      message: 'Your password has been successfully reset. You can now login with your new password.'
    }, { status: 200 })

  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: friendlyMessage(error) },
      { status: 500 }
    )
  }
}
