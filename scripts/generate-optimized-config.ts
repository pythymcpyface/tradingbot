import {
  PrismaClient
} from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface OptimizationConfig {
  [symbol: string]: {
    zScoreThreshold: number;
    movingAverages: number;
    profitPercent: number;
    stopLossPercent: number;
    expectedAlpha: number;
    maxDrawdown: number;
    profitFactor: number;
  };
}

async function main() {
  console.log('Generating optimized configuration per asset...');

  // Get all unique assets
  const assets = await prisma.optimizationResults.groupBy({
    by: ['baseAsset', 'quoteAsset'],
  });

  const config: OptimizationConfig = {};

  for (const asset of assets) {
    const symbol = `${asset.baseAsset}/${asset.quoteAsset}`;
    
    // Find best result for this asset meeting strict criteria
    const bestResult = await prisma.optimizationResults.findFirst({
      where: {
        baseAsset: asset.baseAsset,
        quoteAsset: asset.quoteAsset,
        profitFactor: { gte: 1.2 },
        maxDrawdown: { lte: 30 }, // Maximum 30% drawdown
        alpha: { gt: 0 },
        winRatio: { gte: 25 },
        totalTrades: { gt: 10 } // Ensure statistical significance
      },
      orderBy: [
        { alpha: 'desc' }, // Prioritize Alpha
        { profitFactor: 'desc' } // Then stability
      ]
    });

    if (bestResult) {
      console.log(`✅ Found optimized params for ${symbol}: Alpha=${bestResult.alpha}, PF=${bestResult.profitFactor}`);
      config[symbol] = {
        zScoreThreshold: bestResult.zScoreThreshold.toNumber(),
        movingAverages: bestResult.movingAverages,
        profitPercent: bestResult.profitPercent.toNumber(),
        stopLossPercent: bestResult.stopLossPercent.toNumber(),
        expectedAlpha: bestResult.alpha.toNumber(),
        maxDrawdown: bestResult.maxDrawdown.toNumber(),
        profitFactor: bestResult.profitFactor.toNumber()
      };
    } else {
      console.warn(`⚠️ No tradeable parameters found for ${symbol} (Criteria: PF>1.2, DD<30%, Win>25%)`);
      
      // Fallback: Try finding "safest" profitable set if strict criteria failed
      const safeFallback = await prisma.optimizationResults.findFirst({
        where: {
            baseAsset: asset.baseAsset,
            quoteAsset: asset.quoteAsset,
            profitFactor: { gte: 1.1 },
            alpha: { gt: 0 }
        },
        orderBy: { maxDrawdown: 'asc' } // Minimize risk
      });

      if (safeFallback) {
          console.log(`   ↳ Using conservative fallback for ${symbol}`);
          config[symbol] = {
            zScoreThreshold: safeFallback.zScoreThreshold.toNumber(),
            movingAverages: safeFallback.movingAverages,
            profitPercent: safeFallback.profitPercent.toNumber(),
            stopLossPercent: safeFallback.stopLossPercent.toNumber(),
            expectedAlpha: safeFallback.alpha.toNumber(),
            maxDrawdown: safeFallback.maxDrawdown.toNumber(),
            profitFactor: safeFallback.profitFactor.toNumber()
          };
      }
    }
  }

  const outputPath = path.join(__dirname, '../config/optimized-params.json');
  fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));
  console.log(`
🎉 Configuration written to ${outputPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
