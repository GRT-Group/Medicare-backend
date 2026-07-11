import { prisma } from './src/lib/prisma';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

async function main() {
  try {
    console.log('Testing getSales query...');
    const sales = await prisma.sale.findMany({
      where: { organization_id: BigInt(1), deleted_at: null },
      include: {
        items: {
          include: { Product: true }
        },
        Customer: { select: { id: true, name: true, phone: true } },
        Branch: { select: { id: true, name: true } },
        User_Sale_created_by_idToUser: { select: { id: true, username: true, first_name: true, last_name: true } },
      },
      orderBy: { id: 'desc' },
      take: 1
    });
    console.log('Success! Found', sales.length, 'sales');
    if (sales.length > 0) {
      console.log('First sale keys:', Object.keys(sales[0]));
    }
  } catch (error: any) {
    console.error('ERROR:', error.message);
    console.error('Code:', error.code);
  } finally {
    await prisma.$disconnect();
  }
}

main();
