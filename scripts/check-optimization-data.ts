#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    
    // Get sample data
    const results = await prisma.optimizationResults.findMany({
      take: 10,
      select: {
        baseAsset: true,
        quoteAsset: true,
        annualizedReturn: true,
        zScoreThreshold: true,
        profitPercent: true,
        stopLossPercent: true
      }
    });
    
    console.log('Sample optimization results:');
    console.table(results);
    
    // Get count by asset
    const assetCounts = await prisma.optimizationResults.groupBy({
      by: ['baseAsset', 'quoteAsset'],
      _count: true
    });
    
    console.log('\nResults by asset pair:');
    assetCounts.forEach(ac => {
      console.log(`${ac.baseAsset}/${ac.quoteAsset}: ${ac._count} results`);
    });
    
  } finally {
    await prisma.$disconnect();
  }
}

main();