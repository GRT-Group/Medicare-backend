// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import { friendlyMessage } from '@/lib/api-error'
import { BranchService } from '@/services/branch.service'
import { prisma } from '@/lib/prisma'
import { PermissionService } from '@/services/permission.service'
import { getBearerToken, verifyBearerToken } from '@/lib/auth-utils'

function serializeBranch(branch: any) {
  return {
    ...branch,
    id: branch.id.toString(),
    organization_id: branch.organization_id.toString(),
    deleted_by_id: branch.deleted_by_id?.toString()
  }
}

async function authenticate(req: NextRequest) {
  const token = getBearerToken(req.headers)
  if (!token) {
    return { error: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }) }
  }
  try {
    const decoded = verifyBearerToken(req.headers)
    return { decoded }
  } catch {
    return { error: NextResponse.json({ success: false, error: 'Unauthorized: Invalid token' }, { status: 401 }) }
  }
}

async function canManageBranches(decoded: any) {
  const callerRoleId = Number(decoded.role_id)
  if (PermissionService.isAdminOrHigher(callerRoleId)) return true

  const roleId = BigInt(decoded.role_id)
  const userId = BigInt(decoded.id)

  const rolePerm = await prisma.rolePermission.findFirst({
    where: {
      role_id: roleId,
      Permission: { action: 'MANAGE', subject: 'BRANCHES' },
      status: 'ACTIVE'
    }
  })

  const userPerm = await prisma.userPermission.findFirst({
    where: {
      user_id: userId,
      Permission: { action: 'MANAGE', subject: 'BRANCHES' },
      status: 'ACTIVE'
    }
  })

  return (rolePerm && userPerm?.is_granted !== false) || (userPerm?.is_granted === true)
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { decoded, error } = await authenticate(req)
    if (error) return error

    let branchId: bigint
    try {
      branchId = BigInt((await params).id)
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid branch id' }, { status: 400 })
    }

    const branch = await BranchService.getBranchById(branchId)
    if (!branch) {
      return NextResponse.json({ success: false, error: 'Branch not found' }, { status: 404 })
    }

    const callerRoleId = Number(decoded.role_id)
    const callerOrgId = decoded.organization_id ? BigInt(decoded.organization_id) : undefined

    if (!PermissionService.isSuperAdmin(callerRoleId)) {
      if (!callerOrgId || branch.organization_id !== callerOrgId) {
        return NextResponse.json({ success: false, error: 'Forbidden: You can only manage branches within your own organization' }, { status: 403 })
      }
      if (!(await canManageBranches(decoded))) {
        return NextResponse.json({ success: false, error: 'Forbidden: You do not have permission to manage branches' }, { status: 403 })
      }
    }

    const body = await req.json()
    const { name, location, contactInfo, isMain, status } = body

    if (name !== undefined && !name) {
      return NextResponse.json({ success: false, error: 'Branch name is required' }, { status: 400 })
    }

    const updated = await BranchService.updateBranch(branchId, {
      name,
      location,
      contactInfo,
      isMain,
      status
    })

    return NextResponse.json({ success: true, message: 'Branch updated successfully', data: serializeBranch(updated) }, { status: 200 })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { decoded, error } = await authenticate(req)
    if (error) return error

    let branchId: bigint
    try {
      branchId = BigInt((await params).id)
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid branch id' }, { status: 400 })
    }

    const branch = await BranchService.getBranchById(branchId)
    if (!branch) {
      return NextResponse.json({ success: false, error: 'Branch not found' }, { status: 404 })
    }

    const callerRoleId = Number(decoded.role_id)
    const callerOrgId = decoded.organization_id ? BigInt(decoded.organization_id) : undefined
    const callerId = BigInt(decoded.id)

    if (!PermissionService.isSuperAdmin(callerRoleId)) {
      if (!callerOrgId || branch.organization_id !== callerOrgId) {
        return NextResponse.json({ success: false, error: 'Forbidden: You can only manage branches within your own organization' }, { status: 403 })
      }
      if (!(await canManageBranches(decoded))) {
        return NextResponse.json({ success: false, error: 'Forbidden: You do not have permission to manage branches' }, { status: 403 })
      }
    }

    const { ArchiveService } = await import('@/services/archive.service')
    await ArchiveService.softDelete(
      branch.organization_id,
      'branch',
      branchId,
      callerId,
      'BRANCH_DELETED',
    )

    return NextResponse.json({ success: true, message: 'Branch deleted' }, { status: 200 })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 })
  }
}
