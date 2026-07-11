import { NextRequest, NextResponse } from 'next/server'
import { friendlyMessage } from '@/lib/api-error'
import { OrganizationService } from '@/services/organization.service'
import { AuthService } from '@/services/auth.service'
import { verifyBearerToken } from '@/lib/auth-utils'

export async function GET(req: NextRequest) {
  try {
    // This listed every organization on the platform (or any org by id) to
    // an unauthenticated caller. The only real caller of this route
    // (OnboardingPage.tsx) is itself behind a login-required route, so it
    // always has a session token available - requiring one here doesn't
    // break that flow, it just stops the same data being fetchable by
    // anyone who knows the URL.
    try {
      verifyBearerToken(req.headers)
    } catch {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const id = req.nextUrl.searchParams.get('id')

    // If an ID is provided, fetch a single organization
    if (id) {
      const organization = await OrganizationService.getOrganizationById(id)
      if (!organization) {
        return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 404 })
      }
      return NextResponse.json({ success: true, data: organization })
    }

    // Otherwise fetch all organizations
    const organizations = await OrganizationService.getAllOrganizations()
    return NextResponse.json({ success: true, data: organizations })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: friendlyMessage(error) },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // -------------------------------------------------------------
    // IF THIS IS AN ADD_USER ACTION:
    // -------------------------------------------------------------
    if (body.action === 'ADD_USER') {
      const { orgId, firstName, lastName, email, phone, roleId } = body

      // In a real app, verify that the requester is an Admin of this organization.
      const adminIdStr = req.headers.get('x-user-id')
      if (!adminIdStr) {
        return NextResponse.json({ success: false, error: 'Unauthorized. Missing x-user-id header.' }, { status: 401 })
      }
      const adminId = BigInt(adminIdStr)

      if (!orgId || !firstName || !lastName || !email || !roleId) {
        return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 })
      }

      const newUser = await AuthService.addUserToOrganization({
        organizationId: BigInt(orgId),
        adminId,
        firstName,
        lastName,
        email,
        phone,
        roleId: BigInt(roleId)
      })

      return NextResponse.json({
        success: true,
        message: 'User added successfully. An email with their auto-generated password has been sent.',
        data: {
          userId: newUser.id.toString(),
          email: newUser.email
        }
      }, { status: 201 })
    }

    // -------------------------------------------------------------
    // IF THIS IS A VERIFY ACTION:
    // -------------------------------------------------------------
    if (body.action === 'VERIFY') {
      const { id } = body
      if (!id) return NextResponse.json({ success: false, error: 'Missing organization ID' }, { status: 400 })
      
      const org = await OrganizationService.verifyOrganization(id)
      return NextResponse.json({ 
        success: true, 
        message: 'Organization verified', 
        organization: { 
          ...org, 
          id: org.id.toString(), 
          organization_type_id: org.organization_type_id.toString() 
        } 
      }, { status: 200 })
    }

    // -------------------------------------------------------------
    // OTHERWISE, THIS IS A REGULAR CREATE ORGANIZATION ACTION:
    // -------------------------------------------------------------
    const { name, organization_type_id, code, phone, email, country, currency, timezone, logo_url, business_certificate_url } = body;

    // Basic validation
    if (!name || !organization_type_id || !code || !phone || !email) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: name, organization_type_id, code, phone, email' },
        { status: 400 }
      )
    }

    const organization = await OrganizationService.createOrganization({
      name,
      organization_type_id,
      code,
      phone,
      email,
      country,
      currency,
      timezone,
      logo_url,
      business_certificate_url,
    })

    return NextResponse.json({ success: true, data: organization }, { status: 201 })
  } catch (error: any) {
    // Handle Prisma unique constraint error for 'code'
    if (error.code === 'P2002') {
      return NextResponse.json(
        { success: false, error: 'An organization with this code already exists.' },
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
      return NextResponse.json({ success: false, error: 'Organization ID is required in the query parameters (?id=...)' }, { status: 400 })
    }

    const body = await req.json()

    // logo_url must be a real hosted URL (from POST /api/organizations/logo),
    // never inline image data — storing base64/raw bytes here would bloat the
    // row and most <img> consumers on the frontend expect a URL anyway.
    if (typeof body.logo_url === 'string' && body.logo_url && !/^https?:\/\//i.test(body.logo_url)) {
      return NextResponse.json({
        success: false,
        error: 'logo_url must be a hosted image URL. Upload the image via POST /api/organizations/logo first.',
      }, { status: 400 })
    }

    // Assuming body can contain organization_type_id instead of type

    const organization = await OrganizationService.updateOrganization(id, body)
    return NextResponse.json({ success: true, data: organization })
  } catch (error: any) {
    if (error.code === 'P2025') {
      return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 404 })
    }
    if (error.code === 'P2002') {
      return NextResponse.json({ success: false, error: 'An organization with this code already exists.' }, { status: 409 })
    }
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) {
      return NextResponse.json({ success: false, error: 'Organization ID is required in the query parameters (?id=...)' }, { status: 400 })
    }

    // Prefer the authenticated caller's id; never fall back to a fake id like
    // 0 - deleted_by_id is a foreign key to a real User, so 0 triggers a
    // constraint error and the delete fails outright. Absent = null.
    let deleterId: bigint | null = null
    try {
      const decoded = verifyBearerToken(req.headers)
      if (decoded?.id) deleterId = BigInt(decoded.id)
    } catch {
      const hdr = req.headers.get('x-user-id')
      if (hdr) deleterId = BigInt(hdr)
    }

    await OrganizationService.deleteOrganization(BigInt(id), deleterId)
    return NextResponse.json({ success: true, message: 'Organization deleted successfully' })
  } catch (error: any) {
    // softDelete throws a plain "... not found / already deleted" Error (no
    // Prisma code) - surface as a clean 404 rather than a 500.
    if (error.code === 'P2025' || /not found|already deleted/i.test(error?.message ?? '')) {
      return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 404 })
    }
    if (error.code === 'P2003') {
      return NextResponse.json({ success: false, error: 'This organization has related records and cannot be deleted.' }, { status: 409 })
    }
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 })
  }
}
