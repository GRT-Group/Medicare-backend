import { NextRequest, NextResponse } from 'next/server'
import { friendlyMessage } from '@/lib/api-error'
import { prisma } from '@/lib/prisma'
import { getBearerToken, verifyBearerToken } from '@/lib/auth-utils'

// Heartbeat endpoint
export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req.headers)
    if (!token) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    
    let decoded
    try {
      decoded = verifyBearerToken(req.headers)
    } catch {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const userId = BigInt(decoded.id)

    // Update user's last_active_at and is_online
    await prisma.user.update({
      where: { id: userId },
      data: {
        is_online: true,
        last_active_at: new Date()
      }
    })

    return NextResponse.json({ success: true, message: 'Presence updated' })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 })
  }
}

// Get online users in the organization
export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req.headers)
    if (!token) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    
    let decoded
    try {
      decoded = verifyBearerToken(req.headers)
    } catch {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const organizationId = decoded.organization_id ? BigInt(decoded.organization_id) : undefined
    if (!organizationId) {
      return NextResponse.json({ success: false, error: 'Organization ID missing' }, { status: 400 })
    }

    // A user is considered online if they pinged within the last 2 minutes
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000)

    const allUsers = await prisma.user.findMany({
      where: {
        organization_id: organizationId,
        is_deleted: false,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        last_active_at: true,
        role: {
          select: { name: true }
        }
      }
    })

    const serializedUsers = allUsers.map(u => ({
      ...u,
      id: u.id.toString(),
      is_online: u.last_active_at ? u.last_active_at >= twoMinutesAgo : false,
    }))

    // Sort online users first
    serializedUsers.sort((a, b) => {
      if (a.is_online === b.is_online) return 0;
      return a.is_online ? -1 : 1;
    })

    return NextResponse.json({ success: true, data: serializedUsers })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 })
  }
}
