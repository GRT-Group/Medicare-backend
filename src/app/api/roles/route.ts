// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import { friendlyMessage } from '@/lib/api-error'
import { prisma } from '@/lib/prisma'
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

    const { searchParams } = new URL(req.url)
    const action = searchParams.get('action')
    const roleIdParam = searchParams.get('roleId')

    // Viewing a role's granted permissions is admin-only - that's the
    // sensitive part of this endpoint.
    if (action === 'PERMISSIONS' && roleIdParam) {
      if (!PermissionService.isAdminOrHigher(decoded.role_id)) {
        return NextResponse.json({ success: false, error: 'Forbidden: Insufficient privileges' }, { status: 403 })
      }

      const roleId = BigInt(roleIdParam)
      const rolePermissions = await prisma.rolePermission.findMany({
        where: { role_id: roleId, status: 'ACTIVE' },
        include: {
          Permission: true
        }
      })

      const serialized = rolePermissions.map(rp => ({
        ...rp,
        id: rp.id.toString(),
        role_id: rp.role_id.toString(),
        permission_id: rp.permission_id.toString(),
        organization_id: rp.organization_id?.toString(),
        permission: {
          ...rp.Permission,
          id: rp.Permission.id.toString()
        }
      }))
  
      return NextResponse.json({ success: true, data: serialized })
    }

    // Default: the basic id/name role list is not sensitive - any
    // authenticated user needs it to resolve their own role_id to a name
    // (e.g. Administrator/Accountant/Cashier-Agro, not just admin/super_admin).
    // Previously this whole GET required isAdminOrHigher, which silently
    // broke role-name resolution for every non-admin role.
    const roles = await prisma.userRole.findMany({
      where: {
        status: 'ACTIVE'
      },
      orderBy: {
        id: 'asc'
      }
    })

    const serializedRoles = roles.map(role => ({
      ...role,
      id: role.id.toString(),
      deleted_by_id: role.deleted_by_id?.toString()
    }))

    return NextResponse.json({ success: true, data: serializedRoles })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: friendlyMessage(error) },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
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

    if (!PermissionService.isAdminOrHigher(decoded.role_id)) {
       return NextResponse.json({ success: false, error: 'Forbidden: Insufficient privileges' }, { status: 403 })
    }

    const body = await req.json()
    const { action, roleId, permissionIds, organizationId } = body

    if (action === 'UPDATE_PERMISSIONS') {
      if (!roleId) {
        return NextResponse.json({ success: false, error: 'roleId is required' }, { status: 400 })
      }
      
      const targetRoleId = BigInt(roleId)
      if (!Array.isArray(permissionIds)) {
        return NextResponse.json({ success: false, error: 'permissionIds must be an array' }, { status: 400 })
      }

      const targetOrgId = organizationId ? BigInt(organizationId) : null

      await prisma.$transaction(async (tx) => {
        await tx.rolePermission.deleteMany({
          where: {
            role_id: targetRoleId,
            organization_id: targetOrgId
          }
        })

        const inserts = permissionIds.map((pid: string | number) => ({
          role_id: targetRoleId,
          permission_id: BigInt(pid),
          organization_id: targetOrgId,
          status: 'ACTIVE'
        }))

        if (inserts.length > 0) {
          await tx.rolePermission.createMany({
            data: inserts
          })
        }
      })

      return NextResponse.json({ success: true, message: 'Role permissions updated successfully' })
    }

    // Default POST behavior: Create a new role
    const { name, description } = body
    if (!name) {
      return NextResponse.json({ success: false, error: 'Role name is required' }, { status: 400 })
    }

    const newRole = await prisma.userRole.create({
      data: {
        name,
        description: description || null,
        status: 'ACTIVE',
        created_by_id: decoded.userId ? BigInt(decoded.userId) : undefined
      }
    })

    return NextResponse.json({ 
      success: true, 
      data: {
        ...newRole,
        id: newRole.id.toString(),
        created_by_id: newRole.created_by_id?.toString()
      }
    })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
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

    if (!PermissionService.isAdminOrHigher(decoded.role_id)) {
       return NextResponse.json({ success: false, error: 'Forbidden: Insufficient privileges' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) {
      return NextResponse.json({ success: false, error: 'Role ID is required' }, { status: 400 })
    }

    const body = await req.json()
    const { name, description, status } = body

    const updatedRole = await prisma.userRole.update({
      where: { id: BigInt(id) },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(status !== undefined && { status }),
      }
    })

    return NextResponse.json({ 
      success: true, 
      data: {
        ...updatedRole,
        id: updatedRole.id.toString(),
        created_by_id: updatedRole.created_by_id?.toString(),
        updated_by_id: updatedRole.updated_by_id?.toString()
      }
    })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 })
  }
}

