// @ts-nocheck
import { prisma } from '@/lib/prisma';
import { CashSessionStatus } from '@prisma/client';

/**
 * Cashier shifts (backed by the CashSession table). Public API speaks
 * "shift" language: every shift carries who opened it (opened_by) and who
 * closed it (closed_by) with resolved usernames, alongside the raw
 * user_id / organization_id for programmatic use.
 */

function username(u: any | null | undefined) {
  if (!u) return null;
  return `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.email || null;
}

function serializeShift(session: any) {
  const {
    User_CashSession_user_idToUser: opener,
    User_CashSession_closed_by_idToUser: closer,
    ...shift
  } = session;

  return {
    ...shift,
    opened_by: opener
      ? { id: session.user_id, username: username(opener), email: opener.email }
      : null,
    closed_by: closer
      ? { id: session.closed_by_id, username: username(closer), email: closer.email }
      : null,
  };
}

/**
 * Resolves a period filter to an [from, to] range over opened_at.
 * - daily:   the single day `date` falls in
 * - weekly:  Monday..Sunday of the week `date` falls in
 * - monthly: the calendar month `date` falls in
 * `date` defaults to today when only `period` is given.
 */
function resolvePeriodRange(period?: string, dateStr?: string): { from: Date; to: Date } | null {
  if (!period) return null;

  const anchor = dateStr ? new Date(dateStr) : new Date();
  if (isNaN(anchor.getTime())) throw new Error('Invalid date for period filter');

  const from = new Date(anchor);
  const to = new Date(anchor);

  switch (period.toLowerCase()) {
    case 'daily':
      from.setHours(0, 0, 0, 0);
      to.setHours(23, 59, 59, 999);
      return { from, to };
    case 'weekly': {
      // Monday-start week containing the anchor.
      const day = from.getDay(); // 0=Sun..6=Sat
      const diffToMonday = day === 0 ? 6 : day - 1;
      from.setDate(from.getDate() - diffToMonday);
      from.setHours(0, 0, 0, 0);
      to.setTime(from.getTime());
      to.setDate(to.getDate() + 6);
      to.setHours(23, 59, 59, 999);
      return { from, to };
    }
    case 'monthly':
      from.setDate(1);
      from.setHours(0, 0, 0, 0);
      to.setMonth(to.getMonth() + 1, 0); // last day of anchor's month
      to.setHours(23, 59, 59, 999);
      return { from, to };
    default:
      throw new Error('period must be one of: daily, weekly, monthly');
  }
}

export class CashSessionService {
  static async getSessions(organizationId: bigint, opts: {
    branchId?: bigint;
    userId?: bigint;
    period?: string;
    date?: string;
    from?: string;
    to?: string;
  } = {}) {
    const where: any = { organization_id: organizationId, deleted_at: null };
    if (opts.branchId) where.branch_id = opts.branchId;
    if (opts.userId) where.user_id = opts.userId;

    // period=daily|weekly|monthly (+date anchor) wins; otherwise explicit
    // from/to bounds are honored if provided.
    const range = resolvePeriodRange(opts.period, opts.date);
    if (range) {
      where.opened_at = { gte: range.from, lte: range.to };
    } else if (opts.from || opts.to) {
      where.opened_at = {};
      if (opts.from) {
        const from = new Date(opts.from);
        if (isNaN(from.getTime())) throw new Error('Invalid "from" date');
        where.opened_at.gte = from;
      }
      if (opts.to) {
        const to = new Date(opts.to);
        if (isNaN(to.getTime())) throw new Error('Invalid "to" date');
        where.opened_at.lte = to;
      }
    }

    const sessions = await prisma.cashSession.findMany({
      where,
      include: {
        User_CashSession_user_idToUser: { select: { first_name: true, last_name: true, email: true } },
        User_CashSession_closed_by_idToUser: { select: { first_name: true, last_name: true, email: true } },
      },
      orderBy: { opened_at: 'desc' }
    });

    return {
      period: range ? { type: opts.period.toLowerCase(), from: range.from, to: range.to } : null,
      count: sessions.length,
      shifts: sessions.map(serializeShift),
    };
  }

  static async openSession(organizationId: bigint, data: {
    user_id: bigint;
    branch_id?: bigint;
    opening_balance: number;
  }) {
    // Ensure user doesn't already have an open shift
    const existing = await prisma.cashSession.findFirst({
      where: {
        user_id: data.user_id,
        status: 'OPEN',
        deleted_at: null
      }
    });

    if (existing) {
      throw new Error('User already has an open shift.');
    }

    return prisma.$transaction(async (tx) => {
      const session = await tx.cashSession.create({
        data: {
          organization_id: organizationId,
          user_id: data.user_id,
          branch_id: data.branch_id,
          opening_balance: data.opening_balance,
          status: 'OPEN',
        },
        include: {
          User_CashSession_user_idToUser: { select: { first_name: true, last_name: true, email: true } },
          User_CashSession_closed_by_idToUser: { select: { first_name: true, last_name: true, email: true } },
        }
      });

      await tx.auditLog.create({
        data: {
          organization_id: organizationId,
          branch_id: data.branch_id,
          user_id: data.user_id,
          module: 'FINANCE',
          action: 'OPEN_CASH_SESSION',
          table_affected: 'CashSession',
          record_id: session.id.toString(),
          after: { opening_balance: data.opening_balance } as any
        }
      });

      return serializeShift(session);
    });
  }

  static async closeSession(sessionId: bigint, organizationId: bigint, data: {
    closing_balance: number;
  }, adminId: bigint) {
    return prisma.$transaction(async (tx) => {
      // findFirstOrThrow, not findUniqueOrThrow: { id, organization_id }
      // isn't a unique key pair on this model, so findUnique rejects it.
      const session = await tx.cashSession.findFirstOrThrow({
        where: { id: sessionId, organization_id: organizationId }
      });

      if (session.status !== 'OPEN') {
        throw new Error('Shift is not open.');
      }

      // Calculate expected balance
      // Expected = opening_balance + sum(CASH sales by user since opened_at)
      const cashSales = await tx.sale.aggregate({
        _sum: { total_amount: true },
        where: {
          organization_id: organizationId,
          created_by_id: session.user_id,
          payment_method: 'CASH',
          status: 'COMPLETED',
          timestamp: { gte: session.opened_at }
        }
      });

      const totalCashSales = Number(cashSales._sum.total_amount || 0);

      const expectedBalance = Number(session.opening_balance) + totalCashSales;
      const difference = data.closing_balance - expectedBalance;

      const status: CashSessionStatus = difference === 0 ? 'CLOSED' : 'DISCREPANCY';

      const updatedSession = await tx.cashSession.update({
        where: { id: sessionId },
        data: {
          closing_balance: data.closing_balance,
          expected_balance: expectedBalance,
          difference,
          status,
          closed_at: new Date(),
          // Who closed the shift — previously never recorded even though
          // the column existed, so "closed by" could not be shown anywhere.
          closed_by_id: adminId,
        },
        include: {
          User_CashSession_user_idToUser: { select: { first_name: true, last_name: true, email: true } },
          User_CashSession_closed_by_idToUser: { select: { first_name: true, last_name: true, email: true } },
        }
      });

      await tx.auditLog.create({
        data: {
          organization_id: organizationId,
          branch_id: session.branch_id,
          user_id: adminId,
          module: 'FINANCE',
          action: 'CLOSE_CASH_SESSION',
          table_affected: 'CashSession',
          record_id: session.id.toString(),
          after: { closing_balance: data.closing_balance, difference, status } as any
        }
      });

      return serializeShift(updatedSession);
    });
  }

  static async updateSession(sessionId: bigint, organizationId: bigint, data: {
    opening_balance?: number;
    closing_balance?: number;
    status?: CashSessionStatus;
  }, adminId: bigint) {
    const session = await prisma.cashSession.findFirst({
      where: { id: sessionId, organization_id: organizationId, deleted_at: null }
    });
    if (!session) throw new Error('Shift not found');

    return prisma.$transaction(async (tx) => {
      const updated = await tx.cashSession.update({
        where: { id: sessionId },
        data: {
          ...(data.opening_balance !== undefined && { opening_balance: data.opening_balance }),
          ...(data.closing_balance !== undefined && { closing_balance: data.closing_balance }),
          ...(data.status !== undefined && { status: data.status }),
        },
        include: {
          User_CashSession_user_idToUser: { select: { first_name: true, last_name: true, email: true } },
          User_CashSession_closed_by_idToUser: { select: { first_name: true, last_name: true, email: true } },
        }
      });

      await tx.auditLog.create({
        data: {
          organization_id: organizationId,
          branch_id: session.branch_id,
          user_id: adminId,
          module: 'FINANCE',
          action: 'UPDATE_CASH_SESSION',
          table_affected: 'CashSession',
          record_id: session.id.toString(),
          after: data as any
        }
      });

      return serializeShift(updated);
    });
  }

  static async deleteSession(sessionId: bigint, organizationId: bigint, adminId: bigint) {
    const session = await prisma.cashSession.findFirst({
      where: { id: sessionId, organization_id: organizationId, deleted_at: null }
    });
    if (!session) throw new Error('Shift not found');

    return prisma.$transaction(async (tx) => {
      await tx.cashSession.update({
        where: { id: sessionId },
        data: {
          deleted_at: new Date(),
          is_deleted: true,
          deleted_by_id: adminId
        }
      });

      await tx.auditLog.create({
        data: {
          organization_id: organizationId,
          branch_id: session.branch_id,
          user_id: adminId,
          module: 'FINANCE',
          action: 'DELETE_CASH_SESSION',
          table_affected: 'CashSession',
          record_id: session.id.toString(),
          after: { is_deleted: true } as any
        }
      });

      return { success: true };
    });
  }
}
