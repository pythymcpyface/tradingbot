#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';

async function findHighCountParameters() {
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    
    // Get all results and group them manually to find high-count parameter combinations
    const allResults = await prisma.optimizationResults.findMany({
      where: { totalTrades: { gt: 5 } },
      select: {
        baseAsset: true,
        quoteAsset: true,
        zScoreThreshold: true,
        profitPercent: true,
        stopLossPercent: true,
        movingAverages: true,
        annualizedReturn: true,
        maxDrawdown: true,
        startTime: true,
        totalTrades: true
      }
    });
    
    // Group by parameters ONLY (without asset pair - this is the current incorrect logic)
    const incorrectGroups = new Map();
    for (const result of allResults) {
      const key = `${result.zScoreThreshold}_${result.profitPercent}_${result.stopLossPercent}_${result.movingAverages}`;
      if (!incorrectGroups.has(key)) {
        incorrectGroups.set(key, []);
      }
      incorrectGroups.get(key).push(result);
    }
    
    // Find the top parameter combinations by count
    const sortedIncorrect = Array.from(incorrectGroups.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 10);
    
    console.log('🚨 CURRENT (INCORRECT) GROUPING - Top 10 parameter combinations:');
    console.log('Parameters | Count | Asset Pairs Included');
    console.log('-'.repeat(60));
    
    for (const [key, results] of sortedIncorrect) {
      const [zScore, profit, stop, ma] = key.split('_');
      const assetPairs = new Set(results.map((r: any) => `${r.baseAsset}/${r.quoteAsset}`));
      const params = `${zScore}/${profit}%/${stop}%/MA${ma}`;
      console.log(`${params.padEnd(18)} | ${results.length.toString().padEnd(5)} | ${Array.from(assetPairs).join(', ')}`);
    }
    
    console.log('\n✅ CORRECT GROUPING - Same parameters grouped by asset pair:');
    
    // Let's look at the first high-count parameter set and break it down correctly
    const [firstKey, firstResults] = sortedIncorrect[0];
    const [zScore, profit, stop, ma] = firstKey.split('_');
    
    console.log(`\nDetailed analysis for ${zScore}/${profit}%/${stop}%/MA${ma}:`);
    
    const correctGroups = new Map();
    for (const result of firstResults) {
      const correctKey = `${result.baseAsset}_${result.quoteAsset}`;
      if (!correctGroups.has(correctKey)) {
        correctGroups.set(correctKey, []);
      }
      correctGroups.get(correctKey).push(result);
    }
    
    console.log(`Instead of 1 group with ${firstResults.length} results, it should be ${correctGroups.size} groups:`);
    for (const [assetKey, results] of correctGroups.entries()) {
      const [base, quote] = assetKey.split('_');
      console.log(`  ${base}/${quote}: ${results.length} results`);
    }
    
  } finally {
    await prisma.$disconnect();
  }
}

findHighCountParameters().catch(console.error);