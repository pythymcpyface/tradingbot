#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

async function debugParameterCount() {
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    
    // Check the specific parameter combination mentioned: 8/10%/15%
    console.log('🔍 Checking parameter combination: zScore=8, profit=10%, stopLoss=15%\n');
    
    const results = await prisma.optimizationResults.findMany({
      where: {
        zScoreThreshold: 8,
        profitPercent: 10,
        stopLossPercent: 15,
        totalTrades: { gt: 5 }
      },
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
        endTime: true,
        totalTrades: true
      },
      orderBy: { annualizedReturn: 'desc' }
    });
    
    console.log(`Found ${results.length} results with parameters 8/10%/15%:`);
    console.log('');
    
    if (results.length > 0) {
      console.log('Asset Pair | MA | Return% | Drawdown% | Period | Trades');
      console.log('-'.repeat(60));
      
      results.forEach(result => {
        const pair = `${result.baseAsset}/${result.quoteAsset}`;
        const period = result.startTime.toISOString().split('T')[0];
        const returnPct = parseFloat(result.annualizedReturn.toString()).toFixed(1);
        const drawdown = parseFloat(result.maxDrawdown.toString()).toFixed(1);
        
        console.log(`${pair.padEnd(10)} | ${result.movingAverages.toString().padEnd(2)} | ${returnPct.padEnd(7)} | ${drawdown.padEnd(9)} | ${period} | ${result.totalTrades}`);
      });
    }
    
    // Now show how the current grouping key would work vs how it should work
    console.log('\n📊 Current vs Correct Grouping Analysis:');
    console.log('');
    
    // Current grouping (missing asset pair info)
    const currentGroupKey = `8_10_15_${results.length > 0 ? results[0].movingAverages : 'N/A'}`;
    console.log(`Current grouping key (INCORRECT): "${currentGroupKey}"`);
    console.log(`This would group ALL ${results.length} results into 1 group`);
    
    console.log('');
    
    // Correct grouping (including asset pair)
    const groupsByAssetPair = new Map();
    for (const result of results) {
      const correctKey = `${result.zScoreThreshold}_${result.profitPercent}_${result.stopLossPercent}_${result.movingAverages}_${result.baseAsset}_${result.quoteAsset}`;
      if (!groupsByAssetPair.has(correctKey)) {
        groupsByAssetPair.set(correctKey, []);
      }
      groupsByAssetPair.get(correctKey).push(result);
    }
    
    console.log(`Correct grouping (including asset pairs): ${groupsByAssetPair.size} groups`);
    for (const [key, groupResults] of groupsByAssetPair.entries()) {
      const [zScore, profit, stop, ma, base, quote] = key.split('_');
      console.log(`  ${base}/${quote} (MA=${ma}): ${groupResults.length} results`);
    }
    
  } finally {
    await prisma.$disconnect();
  }
}

debugParameterCount().catch(console.error);