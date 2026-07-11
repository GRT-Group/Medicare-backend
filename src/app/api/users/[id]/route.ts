// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import { friendlyMessage } from '@/lib/api-error'
import { UserService } from '@/services/user.service'
import { getBearerToken, verifyBearerToken } from '@/lib/auth-utils'
import { PermissionService } from '@/services/permission.service'
import { prisma } from '@/lib/prisma'
import { UserStatus } from '@prisma/client'

function serializeUser(user: any) {
  return {
    ...user,
    id: user.id.toString(),
    organization_id: user.organization_id?.toString(),
    role_id: user.role_id.toString(),
    branch_id: user.branch_id?.toString(),
    organization: user.organization ? {
      ...user.organization,
      id: user.organization.id.toString(),
      organization_type_id: user.organization.organization_type_id.toString()
    } : null,
    role: user.role ? {
      ...user.role,
      id: user.role.id.toString()
    } : null,
    branch: user.branch ? {
      ...user.branch,
      id: user.branch.id.toString()
    } : null,
    permissions: (user.permissions || []).map((p: any) => ({
      ...p,
      id: p.id.toString(),
      deleted_by_id: p.deleted_by_id?.toString()
    }))
  }
}

async function authenticate(req: NextRequest) {
  const token = getBearerToken(req.headers)
  if (!token) {
    return { error: NextResponse.json({ success: false, error: 'Unauthorized: Missing or invalid token' }, { status: 401 }) }
  }
  try {
    const decoded = verifyBearerToken(req.headers)
    return { decoded }
  } catch {
    return { error: NextResponse.json({ success: false, error: 'Unauthorized: Invalid token' }, { status: 401 }) }
  }
}

// Can the caller view/manage the target user?
function canAccessTarget(callerRoleId: number, callerOrgId: bigint | undefined, targetOrgId: bigint | null | undefined) {
  if (PermissionService.isSuperAdmin(callerRoleId)) return true
  if (PermissionService.isAdminOrHigher(callerRoleId) && callerOrgId && targetOrgId && callerOrgId === targetOrgId) return true
  return false
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { decoded, error } = await authenticate(req)
    if (error) return error

    let targetId: bigint
    try {
      targetId = BigInt((await params).id)
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid user id' }, { status: 400 })
    }

    const target = await UserService.getUserById(targetId)
    if (!target) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 })
    }

    const callerRoleId = Number(decoded.role_id)
    const callerOrgId = decoded.organization_id ? BigInt(decoded.organization_id) : undefined
    const isSelf = decoded.id === targetId.toString()

    if (!isSelf && !canAccessTarget(callerRoleId, callerOrgId, target.organization_id)) {
      return NextResponse.json({ success: false, error: 'Forbidden: Insufficient privileges' }, { status: 403 })
    }

    return NextResponse.json({ success: true, data: serializeUser(target) }, { status: 200 })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { decoded, error } = await authenticate(req)
    if (error) return error

    let targetId: bigint
    try {
      targetId = BigInt((await params).id)
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid user id' }, { status: 400 })
    }

    const target = await UserService.getUserById(targetId)
    if (!target) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 })
    }

    const callerRoleId = Number(decoded.role_id)
    const callerOrgId = decoded.organization_id ? BigInt(decoded.organization_id) : undefined
    const callerIsSuperAdmin = PermissionService.isSuperAdmin(callerRoleId)

    if (!canAccessTarget(callerRoleId, callerOrgId, target.organization_id)) {
      return NextResponse.json({ success: false, error: 'Forbidden: Insufficient privileges' }, { status: 403 })
    }

    const body = await req.json()
    // Accept both camelCase (used by the user-creation form) and snake_case
    // so callers don't silently drop fields depending on which they send.
    const first_name = body.first_name ?? body.firstName
    const last_name = body.last_name ?? body.lastName
    const phone = body.phone
    const roleId = body.roleId ?? body.role_id
    const branchId = body.branchId ?? body.branch_id
    const rawStatus = body.status
    const status = typeof rawStatus === 'string'
      ? (Object.values(UserStatus) as string[]).find(s => s.toLowerCase() === rawStatus.toLowerCase()) ?? rawStatus
      : rawStatus

    const data: any = {}
    if (status !== undefined) {
      if (!Object.values(UserStatus).includes(status)) {
        return NextResponse.json({ success: false, error: `Invalid status value. Valid statuses: ${Object.values(UserStatus).join(', ')}` }, { status: 400 })
      }
      data.status = status
    }
    if (first_name !== undefined) {
      if (!first_name) return NextResponse.json({ success: false, error: 'First Name is required' }, { status: 400 })
      data.first_name = first_name
    }
    if (last_name !== undefined) {
      if (!last_name) return NextResponse.json({ success: false, error: 'Last Name is required' }, { status: 400 })
      data.last_name = last_name
    }
    if (phone !== undefined) data.phone = phone

    if (roleId !== undefined) {
      // Only a Super Admin may grant the Super Admin role; org admins can only assign roles within their org's scope.
      if (Number(roleId) === 9 && !callerIsSuperAdmin) {
        return NextResponse.json({ success: false, error: 'Forbidden: Only Super Admin can assign the Super Admin role' }, { status: 403 })
      }
      data.role_id = BigInt(roleId)
    }

    if (branchId !== undefined) {
      if (branchId === null || branchId === '') {
        data.branch_id = null
      } else if (branchId === 'main') {
        const targetOrgId = target.organization_id
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

    const updated = await UserService.updateUserByAdmin(targetId, data)

    return NextResponse.json({ success: true, message: 'User updated successfully', data: serializeUser(updated) }, { status: 200 })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { decoded, error } = await authenticate(req)
    if (error) return error

    let targetId: bigint
    try {
      targetId = BigInt((await params).id)
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid user id' }, { status: 400 })
    }

    const callerRoleId = Number(decoded.role_id)
    const callerId = BigInt(decoded.id)
    const callerOrgId = decoded.organization_id ? BigInt(decoded.organization_id) : undefined

    const canManageUsers =
      PermissionService.isAdminOrHigher(callerRoleId) ||
      (callerOrgId
        ? await PermissionService.hasPermission(callerId, 'MANAGE', 'USERS', callerOrgId)
        : false)
    if (!canManageUsers) {
      return NextResponse.json({ success: false, error: 'Forbidden: Insufficient privileges to delete users' }, { status: 403 })
    }
    if (targetId === callerId) {
      return NextResponse.json({ success: false, error: 'You cannot delete your own account' }, { status: 400 })
    }

    const target = await UserService.getUserById(targetId)
    if (!target || target.is_deleted) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 })
    }

    if (!PermissionService.isSuperAdmin(callerRoleId)) {
      if (!callerOrgId || target.organization_id !== callerOrgId) {
        return NextResponse.json({ success: false, error: 'Forbidden: You can only delete users within your own organization' }, { status: 403 })
      }
      if (PermissionService.isSuperAdmin(Number(target.role_id))) {
        return NextResponse.json({ success: false, error: 'Forbidden: You cannot delete a Super Admin' }, { status: 403 })
      }
    }

    const { ArchiveService } = await import('@/services/archive.service')
    await ArchiveService.softDelete(
      target.organization_id ?? callerOrgId ?? BigInt(0),
      'user',
      targetId,
      callerId,
      'USER_DELETED',
    )

    return NextResponse.json({ success: true, message: 'User deleted' }, { status: 200 })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 })
  }
}
