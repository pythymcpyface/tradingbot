import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface RobustResult {
  symbol: string;
  clusterKey: string;
  params: {
    z: number;
    ma: number;
    tp: number;
    sl: number;
  };
  stats: {
    stability: number; // 0-1
    avgAlpha: number;
    avgProfitFactor: number;
    avgAnnualizedReturn: number;
    sampleSize: number;
  };
}

async function main() {
  console.log('🚀 Starting Full Market Robustness Scan...');
  console.log('Criteria: ProfitFactor > 1.2 | Stability > 70% | Positive Avg Alpha\n');

  // 1. Find all assets with at least one viable candidate
  const viableAssets = await prisma.optimizationResults.groupBy({
    by: ['baseAsset', 'quoteAsset'],
    where: {
      profitFactor: { gt: 1.2 },
      alpha: { gt: 0 }
    }
  });

  console.log(`Found ${viableAssets.length} assets with potential candidates. Analyzing neighborhoods...\n`);

  const safeStrategies: RobustResult[] = [];

  for (const asset of viableAssets) {
    const symbol = `${asset.baseAsset}/${asset.quoteAsset}`;
    
    // Get all candidates for this asset to seed clusters
    const candidates = await prisma.optimizationResults.findMany({
      where: {
        baseAsset: asset.baseAsset,
        quoteAsset: asset.quoteAsset,
        profitFactor: { gt: 1.1 }, // Slightly looser for seeding
        totalTrades: { gt: 10 }
      }
    });

    if (candidates.length < 5) continue; // Not enough data to cluster

    // Cluster Map: Key -> { count, sums... }
    const clusters = new Map<string, {
      zSum: number, maSum: number, tpSum: number, slSum: number, count: number
    }>();

    // Grouping
    for (const c of candidates) {
        const zCenter = Math.round(c.zScoreThreshold.toNumber() * 2) / 2; // Nearest 0.5
        const maCenter = Math.round(c.movingAverages / 4) * 4; // Nearest 4
        const key = `${zCenter}|${maCenter}`;
        
        const current = clusters.get(key) || { zSum:0, maSum:0, tpSum:0, slSum:0, count:0 };
        current.zSum += zCenter;
        current.maSum += maCenter;
        current.tpSum += c.profitPercent.toNumber();
        current.slSum += c.stopLossPercent.toNumber();
        current.count++;
        clusters.set(key, current);
    }

    // Evaluate each cluster
    for (const [key, data] of clusters.entries()) {
        if (data.count < 3) continue; // Ignore tiny clusters

        const zCenter = parseFloat(key.split('|')[0]);
        const maCenter = parseFloat(key.split('|')[1]);

        // Query the "Neighborhood" (including losers)
        const rangeStats = await prisma.optimizationResults.aggregate({
            _avg: {
                alpha: true,
                profitFactor: true,
                annualizedReturn: true,
                winRatio: true
            },
            _count: { _all: true },
            where: {
                baseAsset: asset.baseAsset,
                quoteAsset: asset.quoteAsset,
                zScoreThreshold: { gte: zCenter - 0.25, lte: zCenter + 0.25 },
                movingAverages: { gte: maCenter - 2, lte: maCenter + 2 }
            }
        });

        const profitableCount = await prisma.optimizationResults.count({
            where: {
                baseAsset: asset.baseAsset,
                quoteAsset: asset.quoteAsset,
                zScoreThreshold: { gte: zCenter - 0.25, lte: zCenter + 0.25 },
                movingAverages: { gte: maCenter - 2, lte: maCenter + 2 },
                profitFactor: { gt: 1.0 }
            }
        });

        const stability = profitableCount / rangeStats._count._all;
        const avgAlpha = rangeStats._avg.alpha?.toNumber() || -999;
        const avgReturn = rangeStats._avg.annualizedReturn?.toNumber() || 0;
        const avgPF = rangeStats._avg.profitFactor?.toNumber() || 0;

        // Strict filters for "Safety"
        if (stability >= 0.70 && avgAlpha > 5 && avgPF > 1.15) {
            safeStrategies.push({
                symbol,
                clusterKey: key,
                params: {
                    z: zCenter,
                    ma: maCenter,
                    tp: parseFloat((data.tpSum / data.count).toFixed(1)), // Avg TP of winners
                    sl: parseFloat((data.slSum / data.count).toFixed(1))  // Avg SL of winners
                },
                stats: {
                    stability,
                    avgAlpha,
                    avgProfitFactor: avgPF,
                    avgAnnualizedReturn: avgReturn,
                    sampleSize: rangeStats._count._all
                }
            });
        }
    }
  }

  // Sort by Stability then Alpha
  safeStrategies.sort((a, b) => b.stats.stability - a.stats.stability || b.stats.avgAlpha - a.stats.avgAlpha);

  console.log('--- 🛡️ SAFE STRATEGIES FOUND 🛡️ ---\n');
  
  const summaryTable = safeStrategies.map(s => ({
    Pair: s.symbol,
    'Stability': (s.stats.stability * 100).toFixed(0) + '%',
    'Exp. Alpha': s.stats.avgAlpha.toFixed(1),
    'Exp. Return': s.stats.avgAnnualizedReturn.toFixed(1) + '%',
    'Avg PF': s.stats.avgProfitFactor.toFixed(2),
    'Params': `Z:${s.params.z} MA:${s.params.ma} TP:${s.params.tp} SL:${s.params.sl}`
  }));

  console.table(summaryTable);

  const outputPath = path.join(__dirname, '../analysis/safe-strategies-summary.json');
  fs.writeFileSync(outputPath, JSON.stringify(safeStrategies, null, 2));
  console.log(`\nDetailed report written to ${outputPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
