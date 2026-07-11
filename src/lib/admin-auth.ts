import { NextRequest } from 'next/server'
import { verifyBearerToken } from '@/lib/auth-utils'
import { PermissionService } from '@/services/permission.service'

export function resolveAdminId(req: NextRequest): { adminId: string | null; status?: 401 | 403; error?: string } {
  // The x-admin-id header used to be trusted outright — any caller could
  // self-assert an arbitrary admin identity with no verification. The real
  // trust decision now always comes from the signed bearer token; the
  // header (if present) is only accepted as a secondary check that must
  // match the token's own id.
  try {
    const decoded = verifyBearerToken(req.headers)
    if (!PermissionService.isSuperAdmin(decoded.role_id)) {
      return { adminId: null, status: 403, error: 'Forbidden: Only Super Admin can perform this action' }
    }

    const adminId = decoded.id || decoded.user_id
    if (!adminId) {
      return { adminId: null, status: 401, error: 'Unauthorized: Missing Admin ID' }
    }

    const headerAdminId = req.headers.get('x-admin-id')
    if (headerAdminId && headerAdminId !== String(adminId)) {
      return { adminId: null, status: 403, error: 'Forbidden: Admin identity mismatch' }
    }

    return { adminId: String(adminId) }
  } catch {
    return { adminId: null, status: 401, error: 'Unauthorized' }
  }
}
