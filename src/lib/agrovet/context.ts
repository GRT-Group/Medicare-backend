/**
 * Agrovet request context: the single entry point every agrovet API route uses
 * to authenticate, resolve the tenant/branch scope, enforce RBAC at the API
 * level, and gate by the tenant's subscription tier.
 *
 * This deliberately REUSES the existing primitives:
 *   - verifyBearerToken()      (src/lib/auth-utils)         -> identity
 *   - PermissionService        (src/services/permission)    -> RBAC engine
 *   - SubscriptionService      (src/services/subscription)  -> lifecycle access
 * and only adds the agrovet-specific glue (feature gating + branch scoping).
 * No second auth/permission/subscription system is introduced.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyBearerToken } from '@/lib/auth-utils'
import { PermissionService } from '@/services/permission.service'
import { SubscriptionService } from '@/services/subscription.service'
import { classifyError } from '@/lib/api-error'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export type AgrovetContext = {
  userId: bigint
  roleId: bigint
  organizationId: bigint
  /** Resolved branch scope for this request (from header or the user's home branch). */
  branchId: bigint | null
  isSuperAdmin: boolean
}

/**
 * Authenticate the caller and resolve their organization + branch scope.
 *
 * Multi-tenant isolation: the organization_id is taken from the SIGNED TOKEN,
 * never from a client-supplied header alone. If an x-organization-id header is
 * present it must match the token's org, otherwise the request is rejected —
 * this is what prevents cross-tenant data access.
 */
export async function resolveContext(req: NextRequest): Promise<AgrovetContext> {
  let decoded
  try {
    decoded = verifyBearerToken(req.headers)
  } catch {
    throw new ApiError(401, 'Unauthorized: valid bearer token required')
  }

  const userId = BigInt(decoded.id)
  const isSuperAdmin = PermissionService.isSuperAdmin(decoded.role_id)

  // Load the user fresh so status / org / role can't be spoofed via a stale token.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role_id: true, organization_id: true, branch_id: true, status: true },
  })
  if (!user) throw new ApiError(401, 'Unauthorized: user not found')
  if (user.status !== 'ACTIVE') throw new ApiError(403, `Forbidden: user status is ${user.status}`)

  const headerOrg = req.headers.get('x-organization-id')

  let organizationId: bigint
  if (isSuperAdmin) {
    // Super Admin may act within an explicit org context (header) or their own.
    organizationId = BigInt(headerOrg || user.organization_id || 0)
    if (!organizationId) throw new ApiError(400, 'Super Admin must supply x-organization-id')
  } else {
    if (!user.organization_id) throw new ApiError(403, 'Forbidden: user has no organization')
    organizationId = user.organization_id
    if (headerOrg && headerOrg !== String(organizationId)) {
      throw new ApiError(403, 'Forbidden: organization scope mismatch')
    }
  }

  // Branch scope: explicit header wins (validated below), else the user's home branch.
  const headerBranch = req.headers.get('x-branch-id')
  let branchId: bigint | null = headerBranch ? BigInt(headerBranch) : user.branch_id ?? null

  if (branchId) {
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organization_id: organizationId, is_deleted: false },
      select: { id: true },
    })
    if (!branch) throw new ApiError(403, 'Forbidden: branch not in your organization')
  }

  return { userId, roleId: user.role_id, organizationId, branchId, isSuperAdmin }
}

/**
 * Enforce that the caller holds a permission (ACTION on SUBJECT) at the API
 * level. Throws 403 otherwise. Super Admin bypasses (handled by the engine).
 */
export async function requirePermission(
  ctx: AgrovetContext,
  action: string,
  subject: string,
): Promise<void> {
  // Super Admin and org Administrators (role 2) implicitly hold every
  // permission within their scope, consistent with the rest of the app's
  // PermissionService.isAdminOrHigher() checks. Other roles must have the
  // explicit RolePermission grant.
  if (PermissionService.isAdminOrHigher(ctx.roleId)) return

  const ok = await PermissionService.hasPermission(ctx.userId, action, subject, ctx.organizationId)
  if (!ok) {
    throw new ApiError(403, `Forbidden: missing permission ${action}:${subject}`)
  }
}

/**
 * Gate a request on the tenant's subscription tier. `feature` is a key in the
 * plan's `features` JSON (e.g. "credit_management", "accounting",
 * "multi_branch", "advanced_analytics"). Super Admin bypasses.
 *
 * Also enforces the subscription lifecycle (ACTIVE/TRIAL) via the existing
 * SubscriptionService so suspended/expired tenants are blocked.
 */
export async function requireFeature(ctx: AgrovetContext, feature: string): Promise<void> {
  if (ctx.isSuperAdmin) return

  const access = await SubscriptionService.checkAccess(ctx.organizationId, 'CORE', false)
  if (!access.allowed) {
    throw new ApiError(402, access.reason || 'Subscription inactive')
  }

  const sub = await prisma.subscription.findUnique({
    where: { organization_id: ctx.organizationId },
    include: { subscription_plan: true },
  })
  const features = (sub?.subscription_plan?.features ?? {}) as Record<string, unknown>

  if (!features[feature]) {
    throw new ApiError(402, `Feature not available on your plan: ${feature}. Upgrade required.`)
  }
}

/**
 * Uniform error -> HTTP mapping for route catch blocks.
 *
 * ApiError (our own validation/auth errors) surfaces its message as-is. Anything
 * else — especially raw DB/connection failures — is passed through the shared
 * classifier so the end user sees a friendly "can't reach the server" message
 * (503) rather than a Prisma stack trace.
 */
export function toErrorResponse(error: unknown): { body: { error: string; code?: string }; status: number } {
  if (error instanceof ApiError) {
    return { body: { error: error.message }, status: error.status }
  }
  const res = classifyError(error)
  return { body: res.body, status: res.status }
}
