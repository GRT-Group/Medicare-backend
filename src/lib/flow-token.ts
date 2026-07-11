import jwt from 'jsonwebtoken'
import { JWT_SECRET } from '@/lib/auth-utils'

// Short-lived tokens proving "this browser just completed register/login (or
// a prior flow step) for this specific user" — required by the pre-session
// steps (subscribe, verify-otp, resend-otp) so a code/userId alone is never
// enough to progress the flow. Distinct from the long-lived session JWT
// issued after OTP verification (see AuthService.verifyLoginOtp).

export type FlowStep = 'subscribe' | 'verify-otp'

export interface FlowTokenPayload {
  purpose: 'auth_flow'
  step: FlowStep
  userId: string
  organizationId?: string
}

const FLOW_TOKEN_TTL_SECONDS = 15 * 60

export function issueFlowToken(params: {
  userId: bigint | string
  organizationId?: bigint | string | null
  step: FlowStep
}): string {
  const payload: FlowTokenPayload = {
    purpose: 'auth_flow',
    step: params.step,
    userId: String(params.userId),
    ...(params.organizationId ? { organizationId: String(params.organizationId) } : {}),
  }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: FLOW_TOKEN_TTL_SECONDS })
}

export class FlowTokenError extends Error {}

/**
 * Verifies a flow token for a given step. Throws FlowTokenError with a
 * user-safe message on any failure (missing, expired, wrong step, forged).
 */
export function verifyFlowToken(token: string | null | undefined, expectedStep: FlowStep): FlowTokenPayload {
  if (!token) {
    throw new FlowTokenError('Your session has expired. Please start again.')
  }

  let decoded: any
  try {
    decoded = jwt.verify(token, JWT_SECRET)
  } catch {
    throw new FlowTokenError('Your session has expired. Please start again.')
  }

  if (decoded?.purpose !== 'auth_flow' || decoded?.step !== expectedStep || !decoded?.userId) {
    throw new FlowTokenError('Your session has expired. Please start again.')
  }

  return decoded as FlowTokenPayload
}

export function getFlowToken(headers: Headers): string | null {
  return headers.get('x-flow-token')
}
