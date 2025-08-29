#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';

async function checkGlickoData() {
  const prisma = new PrismaClient();
  
  try {
    await prisma.$connect();
    console.log('📊 Glicko Ratings Table Analysis');
    console.log('================================\n');
    
    const totalCount = await prisma.glickoRatings.count();
    console.log(`Total records: ${totalCount.toLocaleString()}\n`);
    
    if (totalCount === 0) {
      console.log('❌ No data in glicko_ratings table');
      console.log('🔧 Run: npx ts-node scripts/calculateGlickoRatings.ts to generate ratings');
      return;
    }
    
    const allRecords = await prisma.glickoRatings.findMany({
      orderBy: { createdAt: 'desc' }
    });
    
    console.log('📋 All Records:');
    console.log('━'.repeat(120));
    console.log('Symbol      Rating    RD      Volatility Performance Timestamp   Created');
    console.log('━'.repeat(120));
    
    for (const record of allRecords) {
      console.log(
        record.symbol.padEnd(12) +
        parseFloat(record.rating.toString()).toFixed(1).padEnd(10) +
        parseFloat(record.ratingDeviation.toString()).toFixed(2).padEnd(8) +
        parseFloat(record.volatility.toString()).toFixed(4).padEnd(11) +
        parseFloat(record.performanceScore.toString()).toFixed(2).padEnd(12) +
        record.timestamp.toISOString().split('T')[0].padEnd(12) +
        record.createdAt.toISOString().split('T')[0]
      );
    }
    
    // Group by symbol
    const symbolGroups = new Map<string, typeof allRecords>();
    for (const record of allRecords) {
      if (!symbolGroups.has(record.symbol)) {
        symbolGroups.set(record.symbol, []);
      }
      symbolGroups.get(record.symbol)!.push(record);
    }
    
    console.log('\n📈 Summary by Symbol:');
    console.log('━'.repeat(90));
    console.log('Symbol      Count   Avg Rating  Avg RD    Avg Perf  Date');
    console.log('━'.repeat(90));
    
    for (const [symbol, records] of symbolGroups.entries()) {
      const avgRating = records.reduce((sum, r) => sum + parseFloat(r.rating.toString()), 0) / records.length;
      const avgRD = records.reduce((sum, r) => sum + parseFloat(r.ratingDeviation.toString()), 0) / records.length;
      const avgPerf = records.reduce((sum, r) => sum + parseFloat(r.performanceScore.toString()), 0) / records.length;
      
      const date = records[0].timestamp.toISOString().split('T')[0];
      
      console.log(
        symbol.padEnd(12) +
        records.length.toString().padEnd(8) +
        avgRating.toFixed(1).padEnd(12) +
        avgRD.toFixed(1).padEnd(10) +
        avgPerf.toFixed(2).padEnd(10) +
        date
      );
    }
    
    console.log('\n📊 Summary:');
    console.log(`• Total symbols: ${symbolGroups.size}`);
    console.log(`• Total records: ${allRecords.length}`);
    
    if (allRecords.length > 0) {
      const earliestDate = new Date(Math.min(...allRecords.map(r => r.timestamp.getTime()))).toISOString().split('T')[0];
      const latestDate = new Date(Math.max(...allRecords.map(r => r.timestamp.getTime()))).toISOString().split('T')[0];
      console.log(`• Date range: ${earliestDate} to ${latestDate}`);
      
      const minRating = Math.min(...allRecords.map(r => parseFloat(r.rating.toString()))).toFixed(1);
      const maxRating = Math.max(...allRecords.map(r => parseFloat(r.rating.toString()))).toFixed(1);
      console.log(`• Rating range: ${minRating} to ${maxRating}`);
      
      const avgVolatility = (allRecords.reduce((sum, r) => sum + parseFloat(r.volatility.toString()), 0) / allRecords.length).toFixed(4);
      console.log(`• Average volatility: ${avgVolatility}`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkGlickoData().catch(console.error);