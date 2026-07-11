// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import { friendlyMessage } from '@/lib/api-error'
import { UserService } from '@/services/user.service'
import { prisma } from '@/lib/prisma'
import { UserStatus } from '@prisma/client'
import { getBearerToken, verifyBearerToken } from '@/lib/auth-utils'
import { PermissionService } from '@/services/permission.service'

export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req.headers)
    if (!token) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Missing or invalid token' }, { status: 401 })
    }

    let decoded
    try {
      decoded = verifyBearerToken(req.headers)
    } catch {
      return NextResponse.json({ success: false, error: 'Unauthorized: Invalid token' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const action = searchParams.get('action')
    const userIdParam = searchParams.get('userId')

    // If fetching custom permissions for a user
    if (action === 'PERMISSIONS' && userIdParam) {
      const userId = BigInt(userIdParam)
      const userPermissions = await prisma.userPermission.findMany({
        where: { user_id: userId, status: 'ACTIVE' },
        include: {
          Permission: true
        }
      })

      const serializedPerms = userPermissions.map(up => ({
        ...up,
        id: up.id.toString(),
        user_id: up.user_id.toString(),
        permission_id: up.permission_id.toString(),
        assigned_by_id: up.assigned_by_id?.toString(),
        permission: {
          ...up.Permission,
          id: up.Permission.id.toString()
        }
      }))
  
      return NextResponse.json({ success: true, data: serializedPerms })
    }

    // Default: Fetch all users based on RBAC
    const roleId = Number(decoded.role_id)
    const organizationId = decoded.organization_id ? BigInt(decoded.organization_id) : undefined

    let users = []

    if (PermissionService.isSuperAdmin(roleId)) {
      users = await UserService.getUsers()
    } else if (organizationId) {
      users = await UserService.getUsers(organizationId)
    } else {
      return NextResponse.json({ success: false, error: 'Forbidden: Insufficient privileges' }, { status: 403 })
    }

    const serializedUsers = users.map((user: any) => ({
      ...user,
      id: user.id.toString(),
      organization_id: user.organization_id?.toString(),
      role_id: user.role_id.toString(),
      organization: user.organization ? {
        ...user.organization,
        id: user.organization.id.toString(),
        organization_type_id: user.organization.organization_type_id.toString()
      } : null,
      role: user.role ? {
        ...user.role,
        id: user.role.id.toString()
      } : null,
      permissions: user.permissions.map((p: any) => ({
        ...p,
        id: p.id.toString(),
        deleted_by_id: p.deleted_by_id?.toString()
      }))
    }))

    return NextResponse.json({ success: true, data: serializedUsers })
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
      return NextResponse.json({ success: false, error: 'Unauthorized: Missing or invalid token' }, { status: 401 })
    }

    let decoded
    try {
      decoded = verifyBearerToken(req.headers)
    } catch {
      return NextResponse.json({ success: false, error: 'Unauthorized: Invalid token' }, { status: 401 })
    }

    const roleId = Number(decoded.role_id)
    const adminOrganizationId = decoded.organization_id ? BigInt(decoded.organization_id) : undefined

    const body = await req.json()
    const { action, userId, permissions } = body

    // Handle assigning custom user permissions
    if (action === 'UPDATE_PERMISSIONS') {
      if (!PermissionService.isAdminOrHigher(roleId)) {
         return NextResponse.json({ success: false, error: 'Forbidden: Insufficient privileges to assign user permissions' }, { status: 403 })
      }
      if (!userId) {
        return NextResponse.json({ success: false, error: 'userId is required' }, { status: 400 })
      }
      if (!Array.isArray(permissions)) {
        return NextResponse.json({ success: false, error: 'permissions must be an array of { permissionId, isGranted }' }, { status: 400 })
      }
  
      const callerId = BigInt(decoded.id)
      const targetUserId = BigInt(userId)
  
      await prisma.$transaction(async (tx) => {
        for (const p of permissions) {
          const pId = BigInt(p.permissionId)
          
          await tx.userPermission.upsert({
            where: {
              user_id_permission_id: {
                user_id: targetUserId,
                permission_id: pId
              }
            },
            update: {
              is_granted: p.isGranted,
              status: 'ACTIVE',
              assigned_by_id: callerId
            },
            create: {
              user_id: targetUserId,
              permission_id: pId,
              is_granted: p.isGranted,
              status: 'ACTIVE',
              assigned_by_id: callerId
            }
          })
        }
      })
  
      return NextResponse.json({ success: true, message: 'User permissions updated successfully' })
    }

    // Handle default action: Create User
    const { firstName, lastName, email, phone, roleId: targetRoleId, organizationId: targetOrgId, branchId: targetBranchId } = body

    if (!firstName || !lastName || !email || !targetRoleId) {
      return NextResponse.json({ success: false, error: 'Missing required fields: firstName, lastName, email, roleId' }, { status: 400 })
    }

    let finalOrgId: bigint | undefined = undefined

    if (PermissionService.isSuperAdmin(roleId)) {
      finalOrgId = targetOrgId ? BigInt(targetOrgId) : undefined
    } else if (PermissionService.isAdminOrHigher(roleId) && adminOrganizationId) {
      if (!adminOrganizationId) {
        return NextResponse.json({ success: false, error: 'Forbidden: You do not belong to an organization.' }, { status: 403 })
      }
      finalOrgId = adminOrganizationId
    } else {
      return NextResponse.json({ success: false, error: 'Forbidden: Insufficient privileges to create users.' }, { status: 403 })
    }

    let finalBranchId: bigint | undefined = undefined
    if (targetBranchId !== undefined && targetBranchId !== null && targetBranchId !== '') {
      if (targetBranchId === 'main') {
        if (!finalOrgId) {
          return NextResponse.json({ success: false, error: 'Cannot resolve "main" branch without an organization' }, { status: 400 })
        }
        const mainBranch = await prisma.branch.findFirst({
          where: { organization_id: finalOrgId, is_main: true, status: 'ACTIVE' }
        })
        if (!mainBranch) {
          return NextResponse.json({ success: false, error: 'No main branch found for this organization' }, { status: 400 })
        }
        finalBranchId = mainBranch.id
      } else if (/^\d+$/.test(String(targetBranchId))) {
        finalBranchId = BigInt(targetBranchId)
      } else {
        return NextResponse.json({ success: false, error: 'Invalid branchId' }, { status: 400 })
      }
    }

    const newUser = await UserService.createUser({
      firstName,
      lastName,
      email,
      phone,
      roleId: BigInt(targetRoleId),
      organizationId: finalOrgId,
      branchId: finalBranchId
    })

    const serializedUser = {
      ...newUser,
      id: newUser.id.toString(),
      organization_id: newUser.organization_id?.toString(),
      role_id: newUser.role_id.toString(),
      organization: newUser.organization ? {
        ...newUser.organization,
        id: newUser.organization.id.toString(),
        organization_type_id: newUser.organization.organization_type_id.toString()
      } : null,
      role: newUser.role ? {
        ...newUser.role,
        id: newUser.role.id.toString()
      } : null
    }

    return NextResponse.json({ success: true, message: 'User created successfully', data: serializedUser }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: friendlyMessage(error) },
      { status: 400 }
    )
  }
}

export async function PUT(req: NextRequest) {
  try {
    const token = getBearerToken(req.headers)
    if (!token) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Missing or invalid token' }, { status: 401 })
    }

    let decoded
    try {
      decoded = verifyBearerToken(req.headers)
    } catch {
      return NextResponse.json({ success: false, error: 'Unauthorized: Invalid token' }, { status: 401 })
    }

    const roleId = Number(decoded.role_id)
    const adminOrganizationId = decoded.organization_id ? BigInt(decoded.organization_id) : undefined

    const body = await req.json()
    const { action } = body
    // Accept id/userId interchangeably, and normalize status casing, so
    // minor frontend naming differences don't surface as a 400.
    const userId = body.userId ?? body.id ?? body.user_id
    const rawStatus = body.status
    const status = typeof rawStatus === 'string'
      ? (Object.values(UserStatus) as string[]).find(s => s.toLowerCase() === rawStatus.toLowerCase()) ?? rawStatus
      : rawStatus

    // Treat any PUT that includes a recognized status value as a status
    // update, even if the caller didn't set action: 'UPDATE_STATUS'
    // explicitly (some frontend flows just send { userId, status }).
    const isStatusUpdate = action === 'UPDATE_STATUS' || (status !== undefined && Object.values(UserStatus).includes(status))

    if (isStatusUpdate) {
      if (!userId) {
        return NextResponse.json({ success: false, error: 'Missing userId field (expected body.id, body.userId, or body.user_id)' }, { status: 400 })
      }
      if (!status || !Object.values(UserStatus).includes(status)) {
        return NextResponse.json({ success: false, error: `Invalid status "${rawStatus}". Valid statuses: ${Object.values(UserStatus).join(', ')}` }, { status: 400 })
      }
  
      const targetUserId = BigInt(userId)
  
      const targetUser = await UserService.getUserById(targetUserId)
      if (!targetUser) {
        return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 })
      }
  
      if (PermissionService.isSuperAdmin(roleId)) {
        // Super Admin
      } else if (PermissionService.isAdminOrHigher(roleId) && adminOrganizationId) {
        if (!adminOrganizationId) {
          return NextResponse.json({ success: false, error: 'Forbidden: No organization assigned to your account' }, { status: 403 })
        }
        if (targetUser.organization_id !== adminOrganizationId) {
          return NextResponse.json({ success: false, error: 'Forbidden: You can only change the status of users within your own organization.' }, { status: 403 })
        }
      } else {
        return NextResponse.json({ success: false, error: 'Forbidden: Insufficient privileges' }, { status: 403 })
      }
  
      const updatedUser = await UserService.changeUserStatus(targetUserId, status as UserStatus)
  
      const serializedUser = {
        ...updatedUser,
        id: updatedUser.id.toString(),
        organization_id: updatedUser.organization_id?.toString(),
        role_id: updatedUser.role_id.toString(),
        organization: updatedUser.organization ? {
          ...updatedUser.organization,
          id: updatedUser.organization.id.toString(),
          organization_type_id: updatedUser.organization.organization_type_id.toString()
        } : null,
        role: updatedUser.role ? {
          ...updatedUser.role,
          id: updatedUser.role.id.toString()
        } : null
      }
  
      return NextResponse.json({ success: true, message: 'User status updated successfully', data: serializedUser })
    }

    // Fallback: general user edit (name/role/branch/phone), mirroring
    // PUT /api/users/[id]. Supported so callers that PUT to the collection
    // route with a userId in the body (rather than in the path) still work.
    if (userId) {
      const targetUserId = BigInt(userId)
      const targetUser = await UserService.getUserById(targetUserId)
      if (!targetUser) {
        return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 })
      }

      const callerIsSuperAdmin = PermissionService.isSuperAdmin(roleId)
      if (!callerIsSuperAdmin) {
        if (!PermissionService.isAdminOrHigher(roleId) || !adminOrganizationId || targetUser.organization_id !== adminOrganizationId) {
          return NextResponse.json({ success: false, error: 'Forbidden: Insufficient privileges' }, { status: 403 })
        }
      }

      const first_name = body.first_name ?? body.firstName
      const last_name = body.last_name ?? body.lastName
      const phone = body.phone
      const bodyRoleId = body.roleId ?? body.role_id
      const branchId = body.branchId ?? body.branch_id

      const data: any = {}
      if (first_name !== undefined) {
        if (!first_name) return NextResponse.json({ success: false, error: 'First Name is required' }, { status: 400 })
        data.first_name = first_name
      }
      if (last_name !== undefined) {
        if (!last_name) return NextResponse.json({ success: false, error: 'Last Name is required' }, { status: 400 })
        data.last_name = last_name
      }
      if (phone !== undefined) data.phone = phone

      if (bodyRoleId !== undefined) {
        if (Number(bodyRoleId) === 9 && !callerIsSuperAdmin) {
          return NextResponse.json({ success: false, error: 'Forbidden: Only Super Admin can assign the Super Admin role' }, { status: 403 })
        }
        data.role_id = BigInt(bodyRoleId)
      }

      if (branchId !== undefined) {
        if (branchId === null || branchId === '') {
          data.branch_id = null
        } else if (branchId === 'main') {
          const targetOrgId = targetUser.organization_id
          if (!targetOrgId) {
            return NextResponse.json({ success: false, error: 'Cannot resolve "main" branch: user has no organization' }, { status: 400 })
          }
          const mainBranch = await prisma.branch.findFirst({
            where: { organization_id: targetOrgId, is_main: true, status: 'ACTIVE' }
          })
          if (!mainBranch) {
            return NextResponse.json({ success: false, error: 'No main branch found for this organization' }, { status: 400 })
          }
          data.branch_id = mainBranch.id
        } else if (/^\d+$/.test(String(branchId))) {
          data.branch_id = BigInt(branchId)
        } else {
          return NextResponse.json({ success: false, error: 'Invalid branchId' }, { status: 400 })
        }
      }

      if (Object.keys(data).length === 0) {
        return NextResponse.json({ success: false, error: 'No updatable fields provided' }, { status: 400 })
      }

      const updated = await UserService.updateUserByAdmin(targetUserId, data)

      const serializedUpdated = {
        ...updated,
        id: updated.id.toString(),
        organization_id: updated.organization_id?.toString(),
        role_id: updated.role_id.toString(),
        organization: updated.organization ? {
          ...updated.organization,
          id: updated.organization.id.toString(),
          organization_type_id: updated.organization.organization_type_id.toString()
        } : null,
        role: updated.role ? {
          ...updated.role,
          id: updated.role.id.toString()
        } : null
      }

      return NextResponse.json({ success: true, message: 'User updated successfully', data: serializedUpdated })
    }

    return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: friendlyMessage(error) },
      { status: 500 }
    )
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const token = getBearerToken(req.headers)
    if (!token) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Missing or invalid token' }, { status: 401 })
    }

    let decoded
    try {
      decoded = verifyBearerToken(req.headers)
    } catch {
      return NextResponse.json({ success: false, error: 'Unauthorized: Invalid token' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const idParam = searchParams.get('id') || searchParams.get('userId')
    if (!idParam) {
      return NextResponse.json({ success: false, error: 'Missing user id' }, { status: 400 })
    }

    const roleId = Number(decoded.role_id)
    const callerId = BigInt(decoded.id)
    const adminOrganizationId = decoded.organization_id ? BigInt(decoded.organization_id) : undefined
    const targetUserId = BigInt(idParam)

    // Admin-or-higher, or any role holding the MANAGE:USERS permission
    // (e.g. the agrovet Administrator), may delete users.
    const canManageUsers =
      PermissionService.isAdminOrHigher(roleId) ||
      (adminOrganizationId
        ? await PermissionService.hasPermission(callerId, 'MANAGE', 'USERS', adminOrganizationId)
        : false)
    if (!canManageUsers) {
      return NextResponse.json({ success: false, error: 'Forbidden: Insufficient privileges to delete users' }, { status: 403 })
    }

    // A user cannot delete their own account via this endpoint.
    if (targetUserId === callerId) {
      return NextResponse.json({ success: false, error: 'You cannot delete your own account' }, { status: 400 })
    }

    const targetUser = await UserService.getUserById(targetUserId)
    if (!targetUser || targetUser.is_deleted) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 })
    }

    // Tenant isolation: a non-super-admin may only delete users in their own org.
    if (!PermissionService.isSuperAdmin(roleId)) {
      if (!adminOrganizationId || targetUser.organization_id !== adminOrganizationId) {
        return NextResponse.json({ success: false, error: 'Forbidden: You can only delete users within your own organization' }, { status: 403 })
      }
      // A non-super-admin may not delete a Super Admin.
      if (PermissionService.isSuperAdmin(Number(targetUser.role_id))) {
        return NextResponse.json({ success: false, error: 'Forbidden: You cannot delete a Super Admin' }, { status: 403 })
      }
    }

    // Standard app-wide soft delete (archives to User_RecycleBin + audit trail).
    const { ArchiveService } = await import('@/services/archive.service')
    await ArchiveService.softDelete(
      targetUser.organization_id ?? adminOrganizationId ?? BigInt(0),
      'user',
      targetUserId,
      callerId,
      'USER_DELETED',
    )

    return NextResponse.json({ success: true, message: 'User deleted' }, { status: 200 })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: friendlyMessage(error) },
      { status: 500 }
    )
  }
}
