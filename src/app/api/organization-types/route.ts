import { NextRequest, NextResponse } from 'next/server'
import { apiError, friendlyMessage } from '@/lib/api-error'
import { OrganizationTypeService } from '@/services/organization-type.service'
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    // If an ID is provided, fetch a single organization type
    if (id) {
      const organizationType = await OrganizationTypeService.getOrganizationTypeById(id)
      if (!organizationType) {
        return NextResponse.json({ success: false, error: 'Organization Type not found' }, { status: 404 })
      }
      return NextResponse.json({ success: true, data: JSON.parse(JSON.stringify(organizationType, (k, v) => typeof v === 'bigint' ? v.toString() : v)) })
    }
    // Otherwise fetch all organization types
    const organizationTypes = await OrganizationTypeService.getAllOrganizationTypes()
    return NextResponse.json({ success: true, data: JSON.parse(JSON.stringify(organizationTypes, (k, v) => typeof v === 'bigint' ? v.toString() : v)) })
  } catch (error: any) {
    return apiError(error)
  }
}
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, description, status } = body

    // Basic validation
    if (!name) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: name' },
        { status: 400 }
      )
    }

    const organizationType = await OrganizationTypeService.createOrganizationType({
      name,
      description,
      status: status || 'ACTIVE',
    })

    const serialized = JSON.parse(JSON.stringify(organizationType, (_, v) => typeof v === 'bigint' ? v.toString() : v))
    return NextResponse.json({ success: true, data: serialized }, { status: 201 })
  } catch (error: any) {
    // Handle Prisma unique constraint error
    if (error.code === 'P2002') {
      return NextResponse.json(
        { success: false, error: 'An organization type with this ID or name already exists.' },
        { status: 409 }
      )
    }
    
    return NextResponse.json(
      { success: false, error: friendlyMessage(error) },
      { status: 500 }
    )
  }
}

export async function PUT(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) {
      return NextResponse.json({ success: false, error: 'Organization Type ID is required in the query parameters (?id=...)' }, { status: 400 })
    }

    const body = await req.json()
    const organizationType = await OrganizationTypeService.updateOrganizationType(id, body)
    
    const serialized = JSON.parse(JSON.stringify(organizationType, (_, v) => typeof v === 'bigint' ? v.toString() : v))
    return NextResponse.json({ success: true, data: serialized })
  } catch (error: any) {
    if (error.code === 'P2025') {
      return NextResponse.json({ success: false, error: 'Organization Type not found' }, { status: 404 })
    }
    if (error.code === 'P2002') {
      return NextResponse.json({ success: false, error: 'An organization type with this name already exists.' }, { status: 409 })
    }
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) {
      return NextResponse.json({ success: false, error: 'Organization Type ID is required in the query parameters (?id=...)' }, { status: 400 })
    }

    // Extract deleted_by_id from query if present. Never fall back to a fake
    // id like 0 - deleted_by_id is a foreign key to a real User, so 0 would
    // trigger a constraint error. Absent = null (nullable column).
    const deleted_by_id = req.nextUrl.searchParams.get('deleted_by_id') || undefined

    await OrganizationTypeService.deleteOrganizationType(BigInt(id), deleted_by_id ? BigInt(deleted_by_id) : null)
    return NextResponse.json({ success: true, message: 'Organization Type deleted successfully' })
  } catch (error: any) {
    // softDelete throws a plain "... not found" Error (no Prisma code) when the
    // row is missing or already deleted - surface that as a clean 404.
    if (error.code === 'P2025' || /not found|already deleted/i.test(error?.message ?? '')) {
      return NextResponse.json({ success: false, error: 'Organization Type not found' }, { status: 404 })
    }
    if (error.code === 'P2003') {
      return NextResponse.json({ success: false, error: 'This organization type is in use by one or more organizations and cannot be deleted.' }, { status: 409 })
    }
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 })
  }
}
