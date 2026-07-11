import { PrismaClient, Prisma } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Transient connection errors that are safe to retry. These surface when the
 * database (or Supabase pooler) drops a pooled connection between requests:
 *   P1001 - can't reach database server
 *   P1002 - server timed out
 *   P1017 - server has closed the connection
 * plus the raw "Server has closed the connection" message some engine paths emit.
 */
const RETRYABLE_CODES = new Set(['P1001', 'P1002', 'P1017']);
function isTransient(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && RETRYABLE_CODES.has(err.code)) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /Server has closed the connection/i.test(msg) ||
    /Can't reach database server/i.test(msg) ||
    /Connection terminated/i.test(msg) ||
    /Timed out fetching a new connection/i.test(msg)
  );
}

function createPrisma(): PrismaClient {
  const client = new PrismaClient();

  // Transparently retry transient connection failures (up to 3 attempts with a
  // short backoff) so a dropped pooled connection doesn't surface as a 500 to
  // the frontend. Applies to every model/operation across all org types.
  return client.$extends({
    query: {
      async $allOperations({ args, query }) {
        let lastErr: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            return await query(args);
          } catch (err) {
            lastErr = err;
            if (!isTransient(err)) throw err;
            // 150ms, 300ms backoff
            await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
          }
        }
        throw lastErr;
      },
    },
  }) as unknown as PrismaClient;
}

export const prisma = globalForPrisma.prisma ?? createPrisma();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};
