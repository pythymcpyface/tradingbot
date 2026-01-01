
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// Load the optimized configuration
const configPath = path.join(__dirname, '../config/optimized-params.json');
const optimizedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

async function checkStability(symbol: string, params: any) {
  const [base, quote] = symbol.split('/');
  
  // Define "Neighborhood" - small variations around the optimal
  // We query for results that are within these ranges
  const neighborCriteria = {
    baseAsset: base,
    quoteAsset: quote,
    zScoreThreshold: { gte: params.zScoreThreshold - 0.2, lte: params.zScoreThreshold + 0.2 },
    movingAverages: { gte: params.movingAverages - 2, lte: params.movingAverages + 2 },
    // Profit/Stop loss can vary slightly, but usually they are discrete steps in grid search.
    // Let's assume we want to see if similar TP/SL works.
    profitPercent: { gte: params.profitPercent - 1, lte: params.profitPercent + 1 },
    stopLossPercent: { gte: params.stopLossPercent - 0.5, lte: params.stopLossPercent + 0.5 }
  };

  const neighbors = await prisma.optimizationResults.findMany({
    where: neighborCriteria,
    select: {
      alpha: true,
      totalReturn: true,
      sharpeRatio: true,
      profitFactor: true,
      maxDrawdown: true,
      winRatio: true
    }
  });

  const count = neighbors.length;
  if (count <= 1) {
    return { status: 'UNKNOWN', reason: 'No neighbors found (Sparse Data)', count };
  }

  // Calculate Stats
  const alphas = neighbors.map(n => n.alpha.toNumber());
  const maxAlpha = Math.max(...alphas);
  const minAlpha = Math.min(...alphas);
  const avgAlpha = alphas.reduce((a, b) => a + b, 0) / count;
  
  // Standard Deviation
  const variance = alphas.reduce((a, b) => a + Math.pow(b - avgAlpha, 2), 0) / count;
  const stdDev = Math.sqrt(variance);
  
  // Coefficient of Variation (CV) = StdDev / Mean
  const cv = stdDev / Math.abs(avgAlpha);

  // Check for crash
  const profitableNeighbors = neighbors.filter(n => n.profitFactor.toNumber() > 1.0).length;
  const stabilityRatio = profitableNeighbors / count;

  let status = 'ROBUST';
  let reason = '';

  if (stabilityRatio < 0.7) {
    status = 'FRAGILE';
    reason = `Only ${(stabilityRatio * 100).toFixed(0)}% of neighbors are profitable`;
  } else if (cv > 0.5) {
    status = 'VOLATILE'; // Performance varies wildly
    reason = `High variance in Alpha (CV: ${cv.toFixed(2)})`;
  } else if (params.expectedAlpha > maxAlpha * 0.95 && avgAlpha < params.expectedAlpha * 0.6) {
     status = 'PEAKY'; // The chosen one is much better than average
     reason = `Selected param is a sharp peak (Avg Alpha: ${avgAlpha.toFixed(2)} vs Selected: ${params.expectedAlpha.toFixed(2)})`;
  }

  return {
    status,
    reason,
    count,
    avgAlpha: avgAlpha.toFixed(2),
    stdDev: stdDev.toFixed(2),
    stabilityRatio: (stabilityRatio * 100).toFixed(0) + '%'
  };
}

async function main() {

  console.log('Analyzing parameter stability (Overfitting Check)...\n');

  

  const targetAssets = [
    'SOL/USDT', 'ETH/USDT', 'AVAX/USDT', 'LINK/USDT', 'DOT/USDT', // Majors
    'AAVE/USDT', 'NEAR/USDT', 'BNB/USDT', // Others
    'ETH/BTC', 'SOL/BTC' // Pairs
  ];

  console.table(
    await Promise.all(targetAssets.map(async (symbol) => {
        const params = optimizedConfig[symbol];
        if (!params) return { symbol, status: 'N/A - Config Missing' };

        const result = await checkStability(symbol, params);
        return {
            symbol,
            status: result.status,
            reason: result.reason,
            neighbors: result.count,
            avgAlpha: result.avgAlpha,
            stability: result.stabilityRatio
        };
    }))
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
