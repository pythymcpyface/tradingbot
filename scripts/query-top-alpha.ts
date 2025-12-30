import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  
  const results = await prisma.optimizationResults.findMany({
    orderBy: { alpha: 'desc' },
    take: 20,
    select: {
      baseAsset: true,
      quoteAsset: true,
      zScoreThreshold: true,
      movingAverages: true,
      profitPercent: true,
      stopLossPercent: true,
      alpha: true,
      sharpeRatio: true,
      totalReturn: true,
      totalTrades: true,
      startTime: true,
      endTime: true
    }
  });

  console.log('\n🏆 TOP 20 PARAMETER SETS BY ALPHA');
  console.log('='.repeat(100));
  console.log(`${'PAIR'.padEnd(10)} | ${'ALPHA'.padEnd(10)} | ${'SHARPE'.padEnd(8)} | ${'RETURN'.padEnd(10)} | ${'TRADES'.padEnd(8)} | ${'PARAMS (Z/MA/P/S)'}`);
  console.log('-'.repeat(100));

  for (const r of results) {
    const params = `${Number(r.zScoreThreshold)} / ${r.movingAverages} / ${Number(r.profitPercent)}% / ${Number(r.stopLossPercent)}%`;
    console.log(
      `${r.baseAsset}/${r.quoteAsset}`.padEnd(10) + ' | ' +
      `${Number(r.alpha).toFixed(2)}%`.padEnd(10) + ' | ' +
      `${Number(r.sharpeRatio).toFixed(2)}`.padEnd(8) + ' | ' +
      `${Number(r.totalReturn).toFixed(2)}%`.padEnd(10) + ' | ' +
      `${r.totalTrades}`.padEnd(8) + ' | ' +
      params
    );
  }
  
  await prisma.$disconnect();
}

main();
