#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkOptimizations() {
  console.log('🔍 Checking optimization_results table...');
  
  try {
    // Get basic table info
    const countResult = await prisma.$queryRaw`SELECT COUNT(*) as count FROM optimization_results`;
    const count = (countResult as any)[0].count;
    console.log('📊 Total records:', count);
    
    // Get sample records to see structure
    const sample = await prisma.$queryRaw`
      SELECT * FROM optimization_results 
      ORDER BY "createdAt" DESC 
      LIMIT 3
    ` as any[];
    
    console.log('\n📋 Sample records:');
    sample.forEach((record, i) => {
      console.log(`${i+1}. ${record.baseAsset}/${record.quoteAsset} - Z=${record.zScoreThreshold}, MA=${record.movingAverages}, P=${record.profitPercent}%, S=${record.stopLossPercent}%`);
      console.log(`   Return: ${Number(record.totalReturn).toFixed(2)}%, Sharpe: ${Number(record.sharpeRatio).toFixed(3)}, Trades: ${record.totalTrades}`);
      console.log(`   Created: ${record.createdAt}`);
    });
    
    // Get unique assets
    const assets = await prisma.$queryRaw`
      SELECT DISTINCT "baseAsset", "quoteAsset"
      FROM optimization_results 
      ORDER BY "baseAsset"
    ` as any[];
    
    console.log('\n💱 Trading pairs:', assets.map(a => `${a.baseAsset}/${a.quoteAsset}`).join(', '));
    
    // Get parameter ranges
    const paramRanges = await prisma.$queryRaw`
      SELECT 
        MIN("zScoreThreshold") as min_zscore,
        MAX("zScoreThreshold") as max_zscore,
        MIN("movingAverages") as min_ma,
        MAX("movingAverages") as max_ma,
        MIN("profitPercent") as min_profit,
        MAX("profitPercent") as max_profit,
        MIN("stopLossPercent") as min_stop,
        MAX("stopLossPercent") as max_stop
      FROM optimization_results
    ` as any[];
    
    console.log('\n📈 Parameter ranges:', paramRanges[0]);
    
    // Get recent activity
    const recentActivity = await prisma.$queryRaw`
      SELECT 
        DATE("createdAt") as test_date,
        COUNT(*) as tests_run,
        COUNT(DISTINCT CONCAT("baseAsset", '/', "quoteAsset")) as unique_pairs
      FROM optimization_results
      GROUP BY DATE("createdAt")
      ORDER BY test_date DESC
      LIMIT 7
    ` as any[];
    
    console.log('\n📅 Recent testing activity:');
    recentActivity.forEach(day => {
      console.log(`${day.test_date}: ${day.tests_run} tests on ${day.unique_pairs} pairs`);
    });
    
    // Get best performers
    const topPerformers = await prisma.$queryRaw`
      SELECT 
        CONCAT("baseAsset", '/', "quoteAsset") as pair,
        "zScoreThreshold" as zscore,
        "profitPercent" as profit,
        "stopLossPercent" as stop,
        "totalReturn" as return,
        "sharpeRatio" as sharpe,
        "totalTrades" as trades
      FROM optimization_results
      WHERE "totalReturn" IS NOT NULL
      ORDER BY "totalReturn" DESC
      LIMIT 5
    ` as any[];
    
    console.log('\n🏆 Top 5 performing combinations:');
    topPerformers.forEach((combo, i) => {
      console.log(`${i+1}. ${combo.pair} Z=${combo.zscore}, P=${combo.profit}%, S=${combo.stop}%`);
      console.log(`   Return: ${Number(combo.return).toFixed(2)}%, Sharpe: ${Number(combo.sharpe).toFixed(3)}, Trades: ${combo.trades}`);
    });
    
  } catch (error) {
    console.error('❌ Error checking optimization table:', error);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  checkOptimizations().catch(console.error);
}