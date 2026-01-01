import {
  PrismaClient
} from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Fetching optimization results...');

  // 1. Get top results by Alpha
  const topAlphaResults = await prisma.optimizationResults.findMany({
    take: 50,
    orderBy: {
      alpha: 'desc',
    },
    include: {
        backtestRun: true
    }
  });

  console.log('\n--- Top 50 Results by Alpha ---');
  console.table(topAlphaResults.map(r => ({
    pair: `${r.baseAsset}/${r.quoteAsset}`,
    alpha: r.alpha.toNumber().toFixed(4),
    sharpe: r.sharpeRatio.toNumber().toFixed(4),
    calmar: r.calmarRatio?.toNumber().toFixed(4) || 'N/A',
    return: r.totalReturn.toNumber().toFixed(2) + '%',
    trades: r.totalTrades,
    winRate: r.winRatio.toNumber().toFixed(2) + '%',
    params: `Z:${r.zScoreThreshold}, MA:${r.movingAverages}, TP:${r.profitPercent}, SL:${r.stopLossPercent}`
  })));

  // 2. Aggregate stats by parameter set to find robust parameters
  // We'll fetch a larger batch for this aggregation
  const allResults = await prisma.optimizationResults.findMany({
    take: 2000,
    orderBy: {
      alpha: 'desc', // Focus on high alpha area
    }
  });

  const paramStats = new Map<string, {
    count: number,
    sumAlpha: number,
    sumSharpe: number,
    sumCalmar: number,
    positiveAlphaCount: number
  }>();

  for (const r of allResults) {
    const paramKey = `Z:${r.zScoreThreshold}|MA:${r.movingAverages}|TP:${r.profitPercent}|SL:${r.stopLossPercent}`;
    
    const stats = paramStats.get(paramKey) || { count: 0, sumAlpha: 0, sumSharpe: 0, sumCalmar: 0, positiveAlphaCount: 0 };
    stats.count++;
    stats.sumAlpha += r.alpha.toNumber();
    stats.sumSharpe += r.sharpeRatio.toNumber();
    stats.sumCalmar += r.calmarRatio?.toNumber() || 0;
    if (r.alpha.toNumber() > 0) stats.positiveAlphaCount++;
    
    paramStats.set(paramKey, stats);
  }

  // Convert map to array and sort by avg alpha
  const aggregated = Array.from(paramStats.entries()).map(([key, stats]) => ({
    params: key,
    count: stats.count,
    avgAlpha: stats.sumAlpha / stats.count,
    avgSharpe: stats.sumSharpe / stats.count,
    avgCalmar: stats.sumCalmar / stats.count,
    consistency: (stats.positiveAlphaCount / stats.count) * 100
  })).filter(x => x.count > 1); // Only consider params that appear more than once (across different pairs/timeframes)

  aggregated.sort((a, b) => b.avgAlpha - a.avgAlpha);

  console.log('\n--- Top Parameter Sets by Average Alpha (across pairs) ---');
  console.table(aggregated.slice(0, 20).map(r => ({
    params: r.params,
    count: r.count,
    avgAlpha: r.avgAlpha.toFixed(4),
    avgSharpe: r.avgSharpe.toFixed(4),
    consistency: r.consistency.toFixed(1) + '%'
  })));

}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
