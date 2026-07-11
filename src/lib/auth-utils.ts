import jwt from 'jsonwebtoken'

// A hardcoded fallback here would mean anyone who reads this public source
// file could forge session tokens against a misconfigured deployment. Only
// allow the fallback outside production so local/dev setups without a .env
// still work.
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET environment variable must be set in production.')
}

export const JWT_SECRET = process.env.JWT_SECRET || 'dev_only_insecure_jwt_secret'

export type JwtPayload = {
  id: string
  email?: string
  role_id: string
  organization_id?: string
  [key: string]: any
}

export function getBearerToken(headers: Headers): string | null {
  const authHeader = headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const cookieHeader = headers.get('cookie')
    if (!cookieHeader) return null

    const cookies = Object.fromEntries(
      cookieHeader.split(';').map((part) => {
        const [rawKey, ...rawValue] = part.trim().split('=')
        return [decodeURIComponent(rawKey), decodeURIComponent(rawValue.join('='))]
      })
    )

    return cookies.medicare_token || null
  }

  return authHeader.split(' ')[1]
}

export function verifyBearerToken(headers: Headers): JwtPayload {
  const token = getBearerToken(headers)
  if (!token) {
    throw new Error('Unauthorized')
  }

  return jwt.verify(token, JWT_SECRET) as JwtPayload
}

export function isRoleId(roleId: bigint | number | string | undefined, expected: number) {
  return Number(roleId) === expected
}
