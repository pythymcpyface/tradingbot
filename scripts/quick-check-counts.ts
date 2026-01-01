import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Checking table counts...');
  const klines = await prisma.klines.count();
  const glickoRatings = await prisma.glickoRatings.count();
  const zScoreHistory = await prisma.zScoreHistory.count();
  const productionOrders = await prisma.productionOrders.count();
  const backtestOrders = await prisma.backtestOrders.count();
  const backtestRuns = await prisma.backtestRuns.count();
  const optimizationResults = await prisma.optimizationResults.count();

  console.log({
    klines,
    glickoRatings,
    zScoreHistory,
    productionOrders,
    backtestOrders,
    backtestRuns,
    optimizationResults
  });
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
