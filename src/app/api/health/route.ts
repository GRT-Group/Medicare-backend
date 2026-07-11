
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'

export async function GET() {
  let prismaStatus = 'ok'
  let prismaError: string | null = null
  let supabaseStatus = 'ok'
  let supabaseError: string | null = null

  // Test Prisma Connection. `prisma` is a shared singleton (see
  // src/lib/prisma.ts) whose pooled connection should stay warm across
  // requests - calling $disconnect() here would tear that pool down after
  // every health check, forcing every subsequent request (health check or
  // real traffic) to pay a fresh connection-handshake cost to the remote
  // Supabase pooler. A plain query is enough to prove the connection works.
  try {
    await prisma.$queryRaw`SELECT NOW()`
  } catch (error) {
    prismaStatus = 'error'
    prismaError = (error as Error).message
  }

  // Test Supabase Connection
  // Note: this call is unauthenticated (no user session/cookie), so Row-Level-Security
  // is expected to deny it (Postgres error 42501 / PostgREST code that maps to "permission denied").
  // That is Supabase reachable-and-working, not an outage, so it shouldn't fail the health check.
  try {
    const cookieStore = await cookies()
    const supabase = createClient(cookieStore)
    const { error } = await supabase.from('Organization').select('id').limit(1)
    if (error && error.code !== 'PGRST302' && error.code !== '42501') {
      throw error
    }
  } catch (error) {
    supabaseStatus = 'error'
    supabaseError = (error as Error).message
  }

  return Response.json({
    status: 'ok',
    message: 'Medicare Backend is running',
    connections: {
      prisma: {
        status: prismaStatus,
        error: prismaError,
      },
      supabase: {
        status: supabaseStatus,
        error: supabaseError,
      }
    }
  }, { status: prismaStatus === 'ok' && supabaseStatus === 'ok' ? 200 : 500 })
}
