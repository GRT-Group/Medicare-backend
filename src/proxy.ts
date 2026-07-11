import { NextRequest, NextResponse } from 'next/server'

/**
 * Global CORS handling for the API.
 *
 * The frontend runs on a different origin (e.g. localhost:5173 / a deployed
 * domain) from this backend. Without CORS headers the browser blocks every
 * cross-origin API call, which surfaces in the UI as
 * "Unable to connect to API (ConnectionRefused)". This proxy:
 *   - answers CORS preflight (OPTIONS) requests for /api/* with 204, and
 *   - stamps Access-Control-* headers on every /api/* response.
 *
 * Credentials are allowed and the request's Origin is reflected so cookie-based
 * auth keeps working. All the app's custom auth headers are whitelisted.
 */
const ALLOW_HEADERS = [
  'Content-Type',
  'Authorization',
  'x-organization-id',
  'x-branch-id',
  'x-user-id',
  'x-admin-id',
].join(', ')

const ALLOW_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS'

function withCors(res: NextResponse, origin: string | null): NextResponse {
  res.headers.set('Access-Control-Allow-Origin', origin || '*')
  res.headers.set('Access-Control-Allow-Credentials', 'true')
  res.headers.set('Access-Control-Allow-Methods', ALLOW_METHODS)
  res.headers.set('Access-Control-Allow-Headers', ALLOW_HEADERS)
  res.headers.set('Access-Control-Max-Age', '86400')
  res.headers.set('Vary', 'Origin')
  return res
}

export function proxy(req: NextRequest) {
  const origin = req.headers.get('origin')

  // Preflight: answer immediately, don't hit the route.
  if (req.method === 'OPTIONS') {
    return withCors(new NextResponse(null, { status: 204 }), origin)
  }

  // Let the request through, then add CORS headers to the response.
  return withCors(NextResponse.next(), origin)
}

// Only run on API routes.
export const config = {
  matcher: '/api/:path*',
}
