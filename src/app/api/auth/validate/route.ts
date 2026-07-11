import { NextRequest, NextResponse } from 'next/server'
import { friendlyMessage } from '@/lib/api-error'
import jwt from 'jsonwebtoken'
import { prisma } from '@/lib/prisma'
import { UserService } from '@/services/user.service'
import { JWT_SECRET, getBearerToken } from '@/lib/auth-utils'

function serializeUser(user: any) {
  const { password_hash, ...safeUser } = user
  return {
    ...safeUser,
    id: safeUser.id.toString(),
    organization_id: safeUser.organization_id?.toString(),
    role_id: safeUser.role_id.toString(),
    branch_id: safeUser.branch_id?.toString(),
    organization: safeUser.organization
      ? {
          ...safeUser.organization,
          id: safeUser.organization.id.toString(),
          Subscription: safeUser.organization.Subscription ? {
            ...safeUser.organization.Subscription,
            id: safeUser.organization.Subscription.id.toString(),
            organization_id: safeUser.organization.Subscription.organization_id.toString()
          } : null
        }
      : null,
    role: safeUser.role
      ? {
          ...safeUser.role,
          id: safeUser.role.id.toString()
        }
      : null,
    permissions: Array.isArray(safeUser.permissions)
      ? safeUser.permissions.map((p: any) => ({
          ...p,
          id: p.id.toString(),
          deleted_by_id: p.deleted_by_id?.toString()
        }))
      : []
  }
}

export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req.headers)
    if (!token) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    let decoded: any
    try {
      decoded = jwt.verify(token, JWT_SECRET) as any
    } catch {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Invalid or expired token' },
        { status: 401 }
      )
    }

    const userId = BigInt(decoded.id)
    const now = new Date()

    const activeSession = await prisma.userSession.findFirst({
      where: {
        user_id: userId,
        session_token: token,
        status: 'ACTIVE',
        deleted_at: null,
        is_deleted: false,
        OR: [
          { expires_at: null },
          { expires_at: { gt: now } }
        ]
      },
      orderBy: { login_at: 'desc' }
    })

    if (!activeSession) {
      await prisma.userSession.updateMany({
        where: {
          user_id: userId,
          session_token: token,
          status: 'ACTIVE'
        },
        data: {
          status: 'EXPIRED',
          logout_at: now,
          deleted_at: now,
          is_deleted: true
        }
      })

      return NextResponse.json(
        { success: false, error: 'Unauthorized: Session expired' },
        { status: 401 }
      )
    }

    const user = await UserService.getUserById(userId)
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json(
      {
        success: true,
        data: serializeUser(user)
      },
      { status: 200 }
    )
  } catch (error: any) {
    const message = typeof error?.message === 'string' ? error.message : 'Unauthorized'
    const status = message.includes('Unauthorized') ? 401 : 500
    return NextResponse.json({ success: false, error: message }, { status })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, phone, username, taxId, registrationNumber, licenseNumber } = body

    const errors: any = {}
    let hasErrors = false

    if (email) {
      const existingEmail = await prisma.user.findUnique({ where: { email } })
      if (existingEmail) {
        errors.email = 'This email is already registered in the system.'
        hasErrors = true
      }
    }

    if (phone) {
      const existingPhone = await prisma.user.findFirst({ where: { phone } })
      if (existingPhone) {
        errors.phone = 'This phone number is already registered in the system.'
        hasErrors = true
      }
    }

    if (username) {
      const existingUser = await prisma.user.findFirst({ 
        where: { 
          OR: [
            { email: username },
            { phone: username }
          ]
        } 
      })
      if (existingUser) {
        errors.username = 'This username is already registered in the system.'
        hasErrors = true
      }

      const existingOrg = await prisma.organization.findFirst({
        where: { name: username }
      })
      if (existingOrg) {
        errors.organizationName = 'This organization name is already registered.'
        hasErrors = true
      }
    }

    if (taxId) {
      const existingTax = await prisma.organization.findFirst({ where: { tax_id: taxId } })
      if (existingTax) {
        errors.taxId = 'This TIN/Tax ID is already registered in the system. Please use a different one.'
        hasErrors = true
      }
    }

    if (registrationNumber) {
      const existingReg = await prisma.organization.findFirst({ where: { registration_number: registrationNumber } })
      if (existingReg) {
        errors.registrationNumber = 'This Registration Number is already registered. Please use a different one.'
        hasErrors = true
      }
    }

    if (licenseNumber) {
      const existingLic = await prisma.organization.findFirst({ where: { license_number: licenseNumber } })
      if (existingLic) {
        errors.licenseNumber = 'This License Number is already registered. Please use a different one.'
        hasErrors = true
      }
    }

    if (hasErrors) {
      return NextResponse.json({ 
        success: false, 
        message: 'Validation failed: The provided details already exist.',
        errors 
      }, { status: 400 })
    }

    return NextResponse.json({ success: true, message: 'All details are available.' }, { status: 200 })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: friendlyMessage(error) },
      { status: 500 }
    )
  }
}
