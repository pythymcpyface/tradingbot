#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';

async function checkSpecificParameters() {
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    
    console.log('🔍 Searching for any results with zScore=8, profit=10%, stopLoss=15%\n');
    
    // Check all possible variations
    const results = await prisma.optimizationResults.findMany({
      where: {
        zScoreThreshold: 8,
        profitPercent: 10,
        stopLossPercent: 15
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
        totalTrades: true,
        id: true
      },
      orderBy: { startTime: 'asc' }
    });
    
    console.log(`Found ${results.length} total results (including those with <= 5 trades):`);
    console.log('');
    
    if (results.length > 0) {
      console.log('ID   | Asset Pair | MA | Return% | Drawdown% | Start Date | End Date   | Trades');
      console.log('-'.repeat(85));
      
      results.forEach(result => {
        const pair = `${result.baseAsset}/${result.quoteAsset}`;
        const startDate = result.startTime.toISOString().split('T')[0];
        const endDate = result.endTime.toISOString().split('T')[0];
        const returnPct = parseFloat(result.annualizedReturn.toString()).toFixed(1);
        const drawdown = parseFloat(result.maxDrawdown.toString()).toFixed(1);
        
        console.log(`${result.id.toString().padEnd(4)} | ${pair.padEnd(10)} | ${result.movingAverages.toString().padEnd(2)} | ${returnPct.padEnd(7)} | ${drawdown.padEnd(9)} | ${startDate} | ${endDate} | ${result.totalTrades}`);
      });
      
      console.log('\n📊 Grouping Analysis:');
      
      // Group by different criteria to understand the issue
      const groupByCriteria = [
        {
          name: 'Current queryTopCalmarRatios.ts logic (without asset pair)',
          keyFn: (r: any) => `${r.zScoreThreshold}_${r.profitPercent}_${r.stopLossPercent}_${r.movingAverages}`
        },
        {
          name: 'With asset pair included',
          keyFn: (r: any) => `${r.zScoreThreshold}_${r.profitPercent}_${r.stopLossPercent}_${r.movingAverages}_${r.baseAsset}_${r.quoteAsset}`
        },
        {
          name: 'With time period included',
          keyFn: (r: any) => `${r.zScoreThreshold}_${r.profitPercent}_${r.stopLossPercent}_${r.movingAverages}_${r.baseAsset}_${r.quoteAsset}_${r.startTime.toISOString().split('T')[0]}`
        }
      ];
      
      groupByCriteria.forEach(criteria => {
        const groups = new Map();
        for (const result of results) {
          const key = criteria.keyFn(result);
          if (!groups.has(key)) {
            groups.set(key, []);
          }
          groups.get(key).push(result);
        }
        
        console.log(`\n${criteria.name}:`);
        console.log(`  ${groups.size} unique groups`);
        for (const [key, groupResults] of groups.entries()) {
          console.log(`    ${key}: ${groupResults.length} results`);
        }
      });
    }
    
  } finally {
    await prisma.$disconnect();
  }
}

checkSpecificParameters().catch(console.error);