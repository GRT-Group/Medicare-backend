// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import { friendlyMessage } from '@/lib/api-error'
import { AuthService } from '@/services/auth.service'
import { EmailService } from '@/services/email.service'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { userId, code } = body

    if (!userId || !code) {
      return NextResponse.json({ success: false, error: 'User ID and Verification code are required' }, { status: 400 })
    }

    // This will throw an error if the code is invalid or expired
    await AuthService.verifyOtp(BigInt(userId), code, 'EMAIL_VERIFICATION')

    // Mark the user as ACTIVE
    const updatedUser = await prisma.user.update({
      where: { id: BigInt(userId) },
      data: { status: 'ACTIVE' },
      include: {
        role: true,
        organization: true
      }
    })

    // Send the Verification Success Email asynchronously (No SMS)
    EmailService.sendVerificationSuccessEmail(updatedUser.email, updatedUser.first_name).catch(console.error)

    return NextResponse.json({ 
      success: true, 
      message: 'Email verified successfully! Your account is now active and you can log in.',
      data: {
        userId: updatedUser.id.toString(),
        status: updatedUser.status
      }
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: friendlyMessage(error) },
      { status: 401 }
    )
  }
}
