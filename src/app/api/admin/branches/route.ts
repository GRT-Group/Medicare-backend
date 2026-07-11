import { NextRequest, NextResponse } from 'next/server'
import { friendlyMessage } from '@/lib/api-error'
import { BranchService } from '@/services/branch.service'
import { getBearerToken, verifyBearerToken } from '@/lib/auth-utils'
import { PermissionService } from '@/services/permission.service'

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

    if (!PermissionService.isSuperAdmin(decoded.role_id)) {
       return NextResponse.json({ success: false, error: 'Forbidden: Only Super Admin can manage branches globally' }, { status: 403 })
    }

    const body = await req.json()
    const { organizationId, name, location, contactInfo, isMain } = body

    if (!organizationId || !name) {
      return NextResponse.json({ success: false, error: 'organizationId and name are required' }, { status: 400 })
    }

    const branch = await BranchService.createBranch({
      organizationId: BigInt(organizationId),
      name,
      location,
      contactInfo,
      isMain: isMain === true,
      createdById: BigInt(decoded.id)
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

    if (!PermissionService.isSuperAdmin(decoded.role_id)) {
      return NextResponse.json({ success: false, error: 'Forbidden: Only Super Admin can manage branches globally' }, { status: 403 })
    }

    const body = await req.json()
    const { id, name, location, contact_phone, contactInfo, status, isMain } = body

    if (!id) {
      return NextResponse.json({ success: false, error: 'Branch id is required' }, { status: 400 })
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

    if (!PermissionService.isSuperAdmin(decoded.role_id)) {
      return NextResponse.json({ success: false, error: 'Forbidden: Only Super Admin can manage branches globally' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) {
      return NextResponse.json({ success: false, error: 'Branch id is required in query parameters (?id=...)' }, { status: 400 })
    }

    await BranchService.deleteBranch(BigInt(id), BigInt(decoded.id))
    return NextResponse.json({ success: true, message: 'Branch deleted successfully' })
  } catch (error: any) {
    if (/not found/i.test(error?.message ?? '')) {
      return NextResponse.json({ success: false, error: 'Branch not found' }, { status: 404 })
    }
    if (/already deleted/i.test(error?.message ?? '')) {
      return NextResponse.json({ success: false, error: 'Branch is already deleted' }, { status: 409 })
    }
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 })
  }
}
