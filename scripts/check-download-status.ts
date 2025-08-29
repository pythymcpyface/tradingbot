#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

async function checkDownloadStatus() {
  const prisma = new PrismaClient();
  
  try {
    console.log('📊 Klines Download Status Report');
    console.log('================================\n');
    
    await prisma.$connect();
    
    // Check progress file
    const progressFile = '.bulk-progress.json';
    let bulkProgress = null;
    
    if (fs.existsSync(progressFile)) {
      bulkProgress = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
      console.log('📋 BULK DOWNLOAD PROGRESS:');
      console.log(`   Completed: ${bulkProgress.completedSymbols}/${bulkProgress.totalSymbols} symbols (${((bulkProgress.completedSymbols/bulkProgress.totalSymbols)*100).toFixed(1)}%)`);
      console.log(`   Total Records Downloaded: ${bulkProgress.totalRecords.toLocaleString()}`);
      console.log(`   Failed Symbols: ${bulkProgress.failedSymbols.length}`);
      console.log(`   Started: ${new Date(bulkProgress.startTime).toLocaleString()}`);
      if (bulkProgress.estimatedCompletion) {
        console.log(`   ETA: ${new Date(bulkProgress.estimatedCompletion).toLocaleString()}`);
      }
      console.log('');
    }

    // Check actual database records
    const totalKlines = await prisma.klines.count();
    console.log(`📊 DATABASE STATUS:`);
    console.log(`   Total Klines in DB: ${totalKlines.toLocaleString()}`);
    
    // Check records per symbol
    const symbolCounts = await prisma.$queryRaw`
      SELECT symbol, COUNT(*) as count, 
             MIN("openTime") as earliest,
             MAX("openTime") as latest
      FROM klines 
      GROUP BY symbol 
      ORDER BY count DESC
    ` as any[];

    console.log('\n📈 RECORDS PER SYMBOL:');
    console.log('━'.repeat(60));
    console.log('Symbol'.padEnd(15) + 'Records'.padEnd(12) + 'Earliest'.padEnd(12) + 'Latest');
    console.log('━'.repeat(60));
    
    for (const row of symbolCounts) {
      const earliest = new Date(row.earliest).toISOString().split('T')[0];
      const latest = new Date(row.latest).toISOString().split('T')[0];
      console.log(
        row.symbol.padEnd(15) + 
        parseInt(row.count).toLocaleString().padEnd(12) + 
        earliest.padEnd(12) + 
        latest
      );
    }
    
    console.log('━'.repeat(60));
    console.log(`Total: ${symbolCounts.length} symbols with data`);

    // Expected symbols from .env
    const tradingPairs = process.env.TRADING_PAIRS?.split(',').map(s => s.trim()) || [];
    const symbolsWithData = new Set(symbolCounts.map(row => row.symbol));
    
    console.log('\n🎯 COMPLETION STATUS:');
    const missingSymbols = tradingPairs.filter(symbol => !symbolsWithData.has(symbol));
    const completeSymbols = tradingPairs.filter(symbol => symbolsWithData.has(symbol));
    
    console.log(`   ✅ Complete: ${completeSymbols.length}/${tradingPairs.length} symbols`);
    
    if (missingSymbols.length > 0) {
      console.log(`   ⏳ Missing: ${missingSymbols.length} symbols`);
      console.log(`      ${missingSymbols.join(', ')}`);
    } else {
      console.log('   🎉 ALL SYMBOLS DOWNLOADED!');
    }

    // Check if download is still running
    console.log('\n🔄 DOWNLOAD PROCESS:');
    if (bulkProgress && bulkProgress.completedSymbols < bulkProgress.totalSymbols) {
      console.log('   ⚡ Download appears to be in progress or paused');
      console.log('   🔧 To resume: npx tsx scripts/getKlines-bulk.ts "2024-01-01" "2025-01-01" "5m"');
    } else {
      console.log('   ✅ Download appears complete');
    }

  } catch (error) {
    console.error('❌ Error checking status:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkDownloadStatus().catch(console.error);