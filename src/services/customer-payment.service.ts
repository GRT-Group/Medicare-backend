// @ts-nocheck
import { prisma } from '@/lib/prisma';
import { PaymentMethod } from '@prisma/client';
import { badRequest } from '@/lib/api-error';
import { CustomerNotifyService } from '@/services/customer-notify.service';

export class CustomerPaymentService {
  static async getPayments(organizationId: bigint, customerId?: bigint) {
    const where: any = { organization_id: organizationId, deleted_at: null };
    if (customerId) where.customer_id = customerId;

    const payments = await prisma.customerPayment.findMany({
      where,
      include: {
        Customer: { select: { name: true, phone: true } },
        User_CustomerPayment_created_by_idToUser: { select: { first_name: true, last_name: true } },
      },
      orderBy: { timestamp: 'desc' }
    });

    return payments.map(({ Customer, User_CustomerPayment_created_by_idToUser, ...payment }) => ({
      ...payment,
      customer: Customer,
      created_by: User_CustomerPayment_created_by_idToUser
    }));
  }

  static async makePayment(organizationId: bigint, data: {
    customer_id: bigint;
    amount: number;
    payment_method: PaymentMethod;
    reference?: string;
  }, adminId: bigint) {
    if (!Number.isFinite(data.amount) || data.amount <= 0) {
      throw badRequest('amount must be a positive number');
    }

    const result = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: data.customer_id, organization_id: organizationId, deleted_at: null }
      });
      if (!customer) throw badRequest('Customer not found in this organization');

      // 1. Update Customer Balance (reduce the balance owed)
      const newBalance = Number(customer.current_balance) - data.amount;

      await tx.customer.update({
        where: { id: data.customer_id },
        data: { current_balance: newBalance }
      });

      // 1b. Apply the payment against this customer's actual unpaid sales
      // (oldest first) so each sale's own remaining_balance/amount_paid
      // reflects the payment — otherwise Sales History/Reports (which read
      // per-sale remaining_balance, not the customer's aggregate balance)
      // would keep showing every sale as unpaid forever.
      let amountToAllocate = data.amount;
      if (amountToAllocate > 0) {
        const unpaidSales = await tx.sale.findMany({
          where: {
            customer_id: data.customer_id,
            organization_id: organizationId,
            deleted_at: null,
            status: { not: 'CANCELLED' },
            remaining_balance: { gt: 0 },
          },
          orderBy: { timestamp: 'asc' },
        });

        for (const sale of unpaidSales) {
          if (amountToAllocate <= 0) break;

          const saleBalance = Number(sale.remaining_balance);
          const applied = Math.min(saleBalance, amountToAllocate);

          await tx.sale.update({
            where: { id: sale.id },
            data: {
              amount_paid: Number(sale.amount_paid) + applied,
              remaining_balance: saleBalance - applied,
            },
          });

          amountToAllocate -= applied;
        }
      }

      // 2. Create Payment Record
      const payment = await tx.customerPayment.create({
        data: {
          organization_id: organizationId,
          customer_id: data.customer_id,
          amount: data.amount,
          payment_method: data.payment_method,
          reference: data.reference,
          created_by_id: adminId
        }
      });

      // 3. Create Cashbook Entry (Money IN)
      await tx.cashbook.create({
        data: {
          organization_id: organizationId,
          transaction_type: 'IN',
          category: 'CUSTOMER_PAYMENT',
          amount: data.amount,
          description: `Payment from customer ${customer.name}`,
          reference_id: payment.id.toString(),
          created_by_id: adminId
        }
      });

      // 4. Audit Log
      await tx.auditLog.create({
        data: {
          organization_id: organizationId,
          user_id: adminId,
          module: 'FINANCE',
          action: 'CUSTOMER_PAYMENT',
          table_affected: 'CustomerPayment',
          record_id: payment.id.toString(),
          after: { amount: data.amount, new_balance: newBalance } as any
        }
      });

      return { payment, newBalance, customerName: customer.name };
    });

    // Tell the customer their payment was received (amount + remaining).
    // Fire-and-forget AFTER commit so a messaging outage never fails the payment.
    CustomerNotifyService.notifyPayment(organizationId, data.customer_id, {
      amount: data.amount,
      new_balance: result.newBalance,
      reference: data.reference,
    }).catch(() => {});

    return { ...result.payment, new_balance: result.newBalance };
  }
}
