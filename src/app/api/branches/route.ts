// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import { friendlyMessage } from '@/lib/api-error'
import { BranchService } from '@/services/branch.service'
import { prisma } from '@/lib/prisma'
import { PermissionService } from '@/services/permission.service'
import { getBearerToken, verifyBearerToken } from '@/lib/auth-utils'

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

    const organizationId = decoded.organization_id
    if (!organizationId) {
      return NextResponse.json({ success: false, error: 'User does not belong to an organization' }, { status: 403 })
    }

    // Verify user has MANAGE_BRANCHES permission
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

    const hasPermission = (rolePerm && userPerm?.is_granted !== false) || (userPerm?.is_granted === true)
    
    // Super Admins bypass
    const callerRoleId = Number(decoded.role_id)
    if (!PermissionService.isAdminOrHigher(callerRoleId) && !hasPermission) {
       return NextResponse.json({ success: false, error: 'Forbidden: You do not have permission to manage branches' }, { status: 403 })
    }

    const body = await req.json()
    const { name, location, contactInfo, isMain } = body

    if (!name) {
      return NextResponse.json({ success: false, error: 'Branch name is required' }, { status: 400 })
    }

    const branch = await BranchService.createBranch({
      organizationId: BigInt(organizationId),
      name,
      location,
      contactInfo,
      isMain: isMain === true,
      createdById: userId
    })

    return NextResponse.json({ 
      success: true, 
      message: 'Branch created successfully',
      data: {
        ...branch,
        id: branch.id.toString(),
        organization_id: branch.organization_id.toString(),
        deleted_by_id: branch.deleted_by_id?.toString()
      }
    }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 })
  }
}

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

    const organizationId = decoded.organization_id
    if (!organizationId && !PermissionService.isSuperAdmin(decoded.role_id)) {
      return NextResponse.json({ success: false, error: 'User does not belong to an organization' }, { status: 403 })
    }

    let targetOrgId = organizationId
    
    // If Super Admin, they can pass organizationId in query params
    if (PermissionService.isSuperAdmin(decoded.role_id)) {
      const { searchParams } = new URL(req.url)
      const qOrgId = searchParams.get('organizationId')
      if (qOrgId) targetOrgId = qOrgId
    }

    if (!targetOrgId) {
      return NextResponse.json({ success: false, error: 'Missing organizationId' }, { status: 400 })
    }

    const branches = await BranchService.getBranchesByOrganization(BigInt(targetOrgId))

    const serialized = branches.map(b => ({
      ...b,
      id: b.id.toString(),
      organization_id: b.organization_id.toString(),
      deleted_by_id: b.deleted_by_id?.toString()
    }))

    return NextResponse.json({ success: true, data: serialized })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 })
  }
}

async function requireManageBranches(req: NextRequest) {
  const token = getBearerToken(req.headers)
  if (!token) return { error: 'Unauthorized', status: 401 } as const

  let decoded
  try {
    decoded = verifyBearerToken(req.headers)
  } catch {
    return { error: 'Unauthorized: Invalid token', status: 401 } as const
  }

  const organizationId = decoded.organization_id
  if (!organizationId) {
    return { error: 'User does not belong to an organization', status: 403 } as const
  }

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

  const hasPermission = (rolePerm && userPerm?.is_granted !== false) || (userPerm?.is_granted === true)
  const callerRoleId = Number(decoded.role_id)
  if (!PermissionService.isAdminOrHigher(callerRoleId) && !hasPermission) {
    return { error: 'Forbidden: You do not have permission to manage branches', status: 403 } as const
  }

  return { decoded, organizationId } as const
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await requireManageBranches(req)
    if ('error' in auth) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    }

    const body = await req.json()
    const { id, name, location, contact_phone, contactInfo, status, isMain } = body
    if (!id) {
      return NextResponse.json({ success: false, error: 'Branch id is required' }, { status: 400 })
    }

    // Scope the update to the caller's own organization so one tenant can't
    // edit another tenant's branch by guessing an id.
    const existing = await prisma.branch.findFirst({ where: { id: BigInt(id), organization_id: BigInt(auth.organizationId) } })
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Branch not found' }, { status: 404 })
    }

    const branch = await BranchService.updateBranch(BigInt(id), {
      name,
      location,
      contactInfo: contactInfo ?? contact_phone,
      isMain,
      status
    })

    return NextResponse.json({
      success: true,
      message: 'Branch updated successfully',
      data: {
        ...branch,
        id: branch.id.toString(),
        organization_id: branch.organization_id.toString(),
        deleted_by_id: branch.deleted_by_id?.toString()
      }
    })
  } catch (error: any) {
    if (error.code === 'P2025') {
      return NextResponse.json({ success: false, error: 'Branch not found' }, { status: 404 })
    }
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireManageBranches(req)
    if ('error' in auth) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    }

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) {
      return NextResponse.json({ success: false, error: 'Branch id is required in query parameters (?id=...)' }, { status: 400 })
    }

    const existing = await prisma.branch.findFirst({ where: { id: BigInt(id), organization_id: BigInt(auth.organizationId) } })
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Branch not found' }, { status: 404 })
    }

    await BranchService.deleteBranch(BigInt(id), BigInt(auth.decoded.id))
    return NextResponse.json({ success: true, message: 'Branch deleted successfully' })
  } catch (error: any) {
    if (/already deleted/i.test(error?.message ?? '')) {
      return NextResponse.json({ success: false, error: 'Branch is already deleted' }, { status: 409 })
    }
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 })
  }
}
