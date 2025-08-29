#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

async function checkDataPatterns() {
  const prisma = new PrismaClient();
  
  try {
    await prisma.$connect();
    
    const symbols = ['BTCUSDT', 'ETHUSDT', 'ADABNB', 'LINKETH', 'XLMBTC', 'TRXBNB', 'TRXBTC'];
    
    console.log('📊 Data Pattern Analysis');
    console.log('='.repeat(80));
    console.log('Symbol       | Records    | Earliest Date     | Latest Date       | Span Days');
    console.log('-'.repeat(80));
    
    for (const symbol of symbols) {
      const stats = await prisma.klines.aggregate({
        where: { symbol },
        _count: { symbol: true },
        _min: { openTime: true },
        _max: { openTime: true }
      });
      
      const recordCount = stats._count.symbol;
      const earliest = stats._min.openTime;
      const latest = stats._max.openTime;
      const spanDays = earliest && latest 
        ? ((latest.getTime() - earliest.getTime()) / (24 * 60 * 60 * 1000)).toFixed(0)
        : '0';
      
      const earliestStr = earliest ? earliest.toISOString().split('T')[0] : 'N/A';
      const latestStr = latest ? latest.toISOString().split('T')[0] : 'N/A';
      
      console.log(
        `${symbol.padEnd(12)} | ${recordCount.toString().padStart(10)} | ${earliestStr} | ${latestStr} | ${spanDays.padStart(8)}`
      );
    }
    
    // Check for recent data availability
    console.log('\n🔍 Recent Data Check (Last 30 days):');
    console.log('-'.repeat(50));
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    for (const symbol of symbols) {
      const recentCount = await prisma.klines.count({
        where: {
          symbol,
          openTime: {
            gte: thirtyDaysAgo
          }
        }
      });
      
      const expectedRecords = 30 * 24 * 12; // 30 days * 24 hours * 12 intervals per hour (5min)
      const completeness = ((recentCount / expectedRecords) * 100).toFixed(1);
      
      console.log(`${symbol.padEnd(12)}: ${recentCount.toString().padStart(5)} / ${expectedRecords} (${completeness}%)`);
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkDataPatterns().catch(console.error);