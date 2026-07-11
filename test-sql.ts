import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const batch = await prisma.productBatch.findFirst();
  if (!batch) {
    console.log('No batch found');
    return;
  }
  
  console.log('Original batch:', batch.id, batch.quantity_remaining);
  
  const valuesSql = `($1::bigint, $2::int)`;
  const params = [batch.id, batch.quantity_remaining - 1];
  
  const result = await prisma.$executeRawUnsafe(
    `UPDATE "ProductBatch" AS pb
     SET quantity_remaining = v.qty, updated_at = now()
     FROM (VALUES ${valuesSql}) AS v(id, qty)
     WHERE pb.id = v.id`,
    ...params
  );
  
  console.log('Update result:', result);
  
  const updatedBatch = await prisma.productBatch.findUnique({ where: { id: batch.id } });
  console.log('Updated batch:', updatedBatch?.id, updatedBatch?.quantity_remaining);
}

main().catch(console.error).finally(() => prisma.$disconnect());
