import { NextRequest, NextResponse } from 'next/server'
import { friendlyMessage } from '@/lib/api-error'
import { verifyBearerToken } from '@/lib/auth-utils'
import { PermissionService } from '@/services/permission.service'
import { OrganizationService } from '@/services/organization.service'
import { storeFile } from '@/lib/file-storage'

const LOGO_BUCKET = 'organization-logos'
const MAX_FILE_BYTES = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

/**
 * POST /api/organizations/logo — multipart upload (`file` field).
 * Uploads the image via storeFile (Supabase Storage, falling back to local
 * disk if Supabase isn't configured/fails) and persists the resulting URL as
 * Organization.logo_url, so the DB only ever stores a URL (never raw image
 * bytes), matching the convention used by Product.image_url elsewhere.
 *
 * Organization is resolved from the caller's own token by default (no need for
 * the frontend to know/pass the raw id) — `?id=` is only needed for a Super
 * Admin uploading a logo on behalf of another organization.
 */
export async function POST(req: NextRequest) {
  try {
    let decoded
    try {
      decoded = verifyBearerToken(req.headers)
    } catch {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const queryId = req.nextUrl.searchParams.get('id')
    const isSuperAdmin = PermissionService.isSuperAdmin(decoded.role_id)

    let id: string | null
    if (queryId) {
      if (!isSuperAdmin && queryId !== String(decoded.organization_id)) {
        return NextResponse.json({ success: false, error: 'Forbidden: cannot upload a logo for another organization' }, { status: 403 })
      }
      id = queryId
    } else {
      id = decoded.organization_id ? String(decoded.organization_id) : null
    }

    if (!id) {
      return NextResponse.json({ success: false, error: 'Organization ID is required (no organization on this account — pass ?id=... )' }, { status: 400 })
    }

    const form = await req.formData()
    const file = form.get('file')
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'file is required (multipart/form-data field named "file")' }, { status: 400 })
    }

    const ext = ALLOWED_TYPES[file.type]
    if (!ext) {
      return NextResponse.json({ success: false, error: `Unsupported image type "${file.type}". Use PNG, JPEG, WEBP, or SVG.` }, { status: 400 })
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ success: false, error: 'Image must be 5MB or smaller.' }, { status: 400 })
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    const filename = `${id}/logo-${Date.now()}.${ext}`

    const { url: logoUrl } = await storeFile(LOGO_BUCKET, filename, bytes, file.type)

    const organization = await OrganizationService.updateOrganization(id, { logo_url: logoUrl })

    return NextResponse.json({
      success: true,
      message: 'Logo uploaded successfully',
      data: { logo_url: logoUrl, organization },
    }, { status: 200 })
  } catch (error: any) {
    if (error.code === 'P2025') {
      return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 404 })
    }
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 })
  }
}
