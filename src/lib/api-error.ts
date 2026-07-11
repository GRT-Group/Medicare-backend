import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { LmbtechConfigError, LmbtechGatewayError } from '@/services/lmbtech.service'

/**
 * Converts any thrown error into a clean, user-facing API response.
 *
 * The goal: the frontend (and therefore the end user) never sees a raw Prisma
 * stack trace or an internal connection string. Database/connection failures are
 * mapped to a friendly "service temporarily unavailable" message with HTTP 503,
 * so the frontend can show a proper "network / server unreachable" notice
 * instead of a scary technical dump.
 */

const CONNECTION_CODES = new Set(['P1000', 'P1001', 'P1002', 'P1008', 'P1017'])

function isConnectionError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && CONNECTION_CODES.has(err.code)) return true
  if (err instanceof Prisma.PrismaClientInitializationError) return true
  const msg = err instanceof Error ? err.message : String(err)
  return (
    /Server has closed the connection/i.test(msg) ||
    /Can't reach database server/i.test(msg) ||
    /Connection terminated/i.test(msg) ||
    /ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(msg) ||
    /Timed out fetching a new connection/i.test(msg)
  )
}

export type ApiErrorBody = { success: false; error: string; code?: string }

/**
 * Classify any thrown error into a clean { body, status } — the single source
 * of truth used by both apiError() (returns a NextResponse) and route helpers
 * that need the plain object.
 */
export function classifyError(err: unknown, fallbackStatus = 500): { body: ApiErrorBody; status: number } {
  // Database / network unreachable -> friendly 503.
  if (isConnectionError(err)) {
    return {
      body: {
        success: false,
        error: 'We are having trouble reaching the server right now. Please check your connection and try again in a moment.',
        code: 'SERVICE_UNAVAILABLE',
      },
      status: 503,
    }
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return { body: { success: false, error: 'That record already exists.', code: 'DUPLICATE' }, status: 409 }
    if (err.code === 'P2025') return { body: { success: false, error: 'The requested record was not found.', code: 'NOT_FOUND' }, status: 404 }
    if (err.code === 'P2003') return { body: { success: false, error: 'This action conflicts with related records.', code: 'CONSTRAINT' }, status: 409 }
  }

  // LMBTech not configured on this server is an ops/setup problem, never the
  // tenant's fault — 503, and never expose the missing env var names to them
  // (that's in the server log via the console.error below, for us to fix).
  if (err instanceof LmbtechConfigError) {
    console.error('[LMBTECH CONFIG ERROR]', err.message)
    return {
      body: {
        success: false,
        error: 'Mobile Money payment is temporarily unavailable. Please try another payment method or contact support.',
        code: 'MOMO_NOT_CONFIGURED',
      },
      status: 503,
    }
  }

  // LMBTech itself rejected/failed the request. A 4xx usually means our
  // request was malformed (should be rare — validated before we call them) or
  // this specific transaction was rejected; a 5xx/network failure means their
  // service is down. Either way the tenant gets one calm, actionable message
  // rather than the gateway's raw response body.
  if (err instanceof LmbtechGatewayError) {
    console.error('[LMBTECH GATEWAY ERROR]', err.message)
    return {
      body: {
        success: false,
        error: 'Mobile Money payment could not be initiated right now. Please check the phone number and try again, or use another payment method.',
        code: 'MOMO_GATEWAY_ERROR',
      },
      status: 502,
    }
  }

  // Readable validation messages pass through; internals never leak.
  const message = err instanceof Error ? err.message : 'Something went wrong. Please try again.'
  const safe = message && message.length < 300 && !/prisma|invocation|__TURBOPACK/i.test(message)
    ? message
    : 'Something went wrong. Please try again.'

  // Errors thrown via badRequest() carry their own HTTP status (e.g. 400 for
  // "Insufficient stock"), so business-rule rejections don't masquerade as 500s.
  const explicitStatus = typeof (err as any)?.status === 'number' ? (err as any).status : undefined
  const status = explicitStatus ?? fallbackStatus

  // A 5xx here is an unexpected server bug — log the real error server-side
  // (the client only ever sees the sanitized message) so it can be diagnosed
  // from the dev/production logs instead of vanishing into "Something went
  // wrong".
  if (status >= 500) {
    console.error('[API 500]', err)
  }

  return { body: { success: false, error: safe }, status }
}

/**
 * Build an Error tagged with HTTP 400, for business-rule/validation failures
 * thrown from services ("Insufficient stock", "Credit limit exceeded", ...).
 * classifyError()/apiError() pick up the status so the client gets a 400
 * with the readable message instead of a generic 500.
 */
export function badRequest(message: string): Error & { status: number } {
  const e = new Error(message) as Error & { status: number }
  e.status = 400
  return e
}

/**
 * Return a single-line, end-user-friendly message for any thrown error.
 *
 * Use in catch blocks that build their own NextResponse and just need a clean
 * string in the `error` field:
 *   } catch (error) { return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 }) }
 *
 * - Real network / database-unreachable failures become a plain
 *   "trouble reaching the server" line (never a raw "Network Error").
 * - Prisma stack traces and internal invocation dumps are stripped.
 * - Readable validation messages (e.g. "Email is required") pass through as-is.
 * Always one line — newlines are collapsed to spaces.
 */
export function friendlyMessage(err: unknown): string {
  const { body } = classifyError(err)
  return body.error.replace(/\s*\n+\s*/g, ' ').trim()
}

/**
 * Build a standardized error response. Use in a route's catch block:
 *   } catch (e) { return apiError(e) }
 */
export function apiError(err: unknown, fallbackStatus = 500): NextResponse<ApiErrorBody> {
  const { body, status } = classifyError(err, fallbackStatus)
  return NextResponse.json(body, { status })
}
