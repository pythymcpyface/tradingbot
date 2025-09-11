#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';

/**
 * Simple script to check the current state of Glicko ratings in the database
 * Focuses on:
 * 1. Total count of ratings records
 * 2. Available symbols with ratings
 * 3. Recent ratings for live trading symbols (BTCUSDT, BNBUSDT, ETHUSDT)
 */
async function checkRatingsStatus() {
  const prisma = new PrismaClient();
  
  try {
    await prisma.$connect();
    console.log('🔍 Glicko Ratings Status Check');
    console.log('==============================\n');
    
    // 1. Total count
    const totalCount = await prisma.glickoRatings.count();
    console.log(`📊 Total ratings records: ${totalCount.toLocaleString()}\n`);
    
    if (totalCount === 0) {
      console.log('❌ No Glicko ratings found in database');
      console.log('💡 Consider running: npx tsx scripts/calculateGlickoRatings.ts');
      return;
    }
    
    // 2. Available symbols
    const symbolsWithCounts = await prisma.glickoRatings.groupBy({
      by: ['symbol'],
      _count: {
        symbol: true
      },
      orderBy: {
        symbol: 'asc'
      }
    });
    
    console.log(`📈 Symbols with ratings (${symbolsWithCounts.length} total):`);
    for (const item of symbolsWithCounts) {
      console.log(`   ${item.symbol}: ${item._count.symbol} records`);
    }
    console.log();
    
    // 3. Check specific live trading symbols
    const liveSymbols = ['BTCUSDT', 'BNBUSDT', 'ETHUSDT'];
    console.log('🎯 Live Trading Symbols Status:');
    console.log('--------------------------------');
    
    for (const symbol of liveSymbols) {
      const recentRating = await prisma.glickoRatings.findFirst({
        where: { symbol },
        orderBy: { timestamp: 'desc' }
      });
      
      if (recentRating) {
        const hoursAgo = Math.floor((Date.now() - recentRating.timestamp.getTime()) / (1000 * 60 * 60));
        console.log(`✅ ${symbol}:`);
        console.log(`   Latest: ${recentRating.timestamp.toISOString().split('T')[0]} (${hoursAgo}h ago)`);
        console.log(`   Rating: ${parseFloat(recentRating.rating.toString()).toFixed(1)}`);
        console.log(`   Performance: ${parseFloat(recentRating.performanceScore.toString()).toFixed(2)}`);
      } else {
        console.log(`❌ ${symbol}: No ratings found`);
      }
    }
    
    // Date range summary
    if (totalCount > 0) {
      const [oldest, newest] = await Promise.all([
        prisma.glickoRatings.findFirst({ orderBy: { timestamp: 'asc' } }),
        prisma.glickoRatings.findFirst({ orderBy: { timestamp: 'desc' } })
      ]);
      
      if (oldest && newest) {
        console.log('\n📅 Date Range:');
        console.log(`   Oldest: ${oldest.timestamp.toISOString().split('T')[0]}`);
        console.log(`   Newest: ${newest.timestamp.toISOString().split('T')[0]}`);
        
        const daysDiff = Math.floor((newest.timestamp.getTime() - oldest.timestamp.getTime()) / (1000 * 60 * 60 * 24));
        console.log(`   Span: ${daysDiff} days`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error checking ratings status:', error);
    if (error instanceof Error) {
      console.error('Details:', error.message);
    }
  } finally {
    await prisma.$disconnect();
  }
}

checkRatingsStatus().catch(console.error);