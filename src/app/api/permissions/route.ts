import { prisma } from '@/lib/prisma'
import { friendlyMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { getBearerToken, verifyBearerToken } from '@/lib/auth-utils'
import { PermissionService } from '@/services/permission.service'

export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req.headers)
    if (!token) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    let decoded
    try {
      decoded = verifyBearerToken(req.headers)
    } catch {
      return NextResponse.json({ success: false, error: 'Unauthorized: Invalid token' }, { status: 401 })
    }

    const roleId = Number(decoded.role_id)
    if (!PermissionService.isAdminOrHigher(roleId)) {
      return NextResponse.json({ success: false, error: 'Forbidden: Insufficient privileges to view permissions' }, { status: 403 })
    }

    const permissions = await prisma.permission.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [
        { subject: 'asc' },
        { action: 'asc' }
      ]
    })

    const serializedPermissions = permissions.map(p => ({
      ...p,
      id: p.id.toString(),
      deleted_by_id: p.deleted_by_id?.toString()
    }))

    return NextResponse.json({ success: true, data: serializedPermissions })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: friendlyMessage(error) },
      { status: 500 }
    )
  }
}
