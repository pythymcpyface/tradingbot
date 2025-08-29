#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

interface GapAnalysis {
  symbol: string;
  expectedRecords: number;
  actualRecords: number;
  completionPercent: number;
  earliestData: Date | null;
  latestData: Date | null;
  missingDays: number;
  hasData: boolean;
  gaps: {
    start: Date;
    end: Date;
    durationDays: number;
  }[];
}

async function identifyKlinesGaps() {
  const prisma = new PrismaClient();
  
  try {
    console.log('🔍 Analyzing Klines Data Gaps');
    console.log('============================\n');
    
    await prisma.$connect();

    // Configuration from parameters
    const startDate = new Date('2021-07-19T00:00:00Z');
    const endDate = new Date('2025-07-19T23:59:59Z');
    const interval = '5m'; // 5-minute intervals
    
    // Get trading pairs from .env
    const tradingPairsEnv = process.env.TRADING_PAIRS;
    if (!tradingPairsEnv) {
      throw new Error('TRADING_PAIRS not found in .env file');
    }
    
    const expectedPairs = tradingPairsEnv.split(',').map(pair => pair.trim());
    
    console.log('📅 EXPECTED DATA RANGE:');
    console.log(`   Start Date: ${startDate.toISOString().split('T')[0]}`);
    console.log(`   End Date: ${endDate.toISOString().split('T')[0]}`);
    console.log(`   Interval: ${interval}`);
    console.log(`   Duration: ${Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))} days`);
    console.log('');

    // Calculate expected number of 5-minute intervals
    const totalMinutes = (endDate.getTime() - startDate.getTime()) / (1000 * 60);
    const expectedRecordsPer5Min = Math.floor(totalMinutes / 5);
    
    console.log(`📊 EXPECTED RECORDS PER SYMBOL: ${expectedRecordsPer5Min.toLocaleString()}`);
    console.log(`📋 EXPECTED TRADING PAIRS: ${expectedPairs.length}`);
    console.log(`   ${expectedPairs.join(', ')}`);
    console.log('');

    // Get actual data from database
    const symbolStats = await prisma.$queryRaw`
      SELECT 
        symbol,
        COUNT(*) as count,
        MIN("openTime") as earliest,
        MAX("openTime") as latest
      FROM klines 
      GROUP BY symbol 
      ORDER BY symbol
    ` as any[];

    const symbolsWithData = new Set(symbolStats.map((s: any) => s.symbol));
    
    console.log('📈 CURRENT DATA STATUS:');
    console.log('━'.repeat(80));
    console.log('Symbol'.padEnd(12) + 'Records'.padEnd(12) + 'Complete%'.padEnd(10) + 'Earliest'.padEnd(12) + 'Latest'.padEnd(12) + 'Status');
    console.log('━'.repeat(80));

    const gapAnalysis: GapAnalysis[] = [];
    
    // Analyze each expected trading pair
    for (const symbol of expectedPairs) {
      const symbolData = symbolStats.find((s: any) => s.symbol === symbol);
      
      let analysis: GapAnalysis;
      
      if (!symbolData) {
        // No data at all
        analysis = {
          symbol,
          expectedRecords: expectedRecordsPer5Min,
          actualRecords: 0,
          completionPercent: 0,
          earliestData: null,
          latestData: null,
          missingDays: Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)),
          hasData: false,
          gaps: [{
            start: startDate,
            end: endDate,
            durationDays: Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
          }]
        };
        
        console.log(
          symbol.padEnd(12) +
          '0'.padEnd(12) +
          '0.0%'.padEnd(10) +
          'None'.padEnd(12) +
          'None'.padEnd(12) +
          '❌ No Data'
        );
      } else {
        // Has some data
        const actualRecords = parseInt(symbolData.count);
        const earliestData = new Date(symbolData.earliest);
        const latestData = new Date(symbolData.latest);
        const completionPercent = (actualRecords / expectedRecordsPer5Min) * 100;
        
        // Calculate missing days
        let missingDays = 0;
        const gaps: { start: Date; end: Date; durationDays: number }[] = [];
        
        // Gap before data starts
        if (earliestData > startDate) {
          const gapDays = Math.ceil((earliestData.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
          missingDays += gapDays;
          gaps.push({
            start: startDate,
            end: earliestData,
            durationDays: gapDays
          });
        }
        
        // Gap after data ends
        if (latestData < endDate) {
          const gapDays = Math.ceil((endDate.getTime() - latestData.getTime()) / (1000 * 60 * 60 * 24));
          missingDays += gapDays;
          gaps.push({
            start: latestData,
            end: endDate,
            durationDays: gapDays
          });
        }
        
        analysis = {
          symbol,
          expectedRecords: expectedRecordsPer5Min,
          actualRecords,
          completionPercent,
          earliestData,
          latestData,
          missingDays,
          hasData: true,
          gaps
        };
        
        const status = completionPercent > 95 ? '✅ Complete' : 
                      completionPercent > 50 ? '⚠️ Partial' : '🔴 Minimal';
        
        console.log(
          symbol.padEnd(12) +
          actualRecords.toLocaleString().padEnd(12) +
          `${completionPercent.toFixed(1)}%`.padEnd(10) +
          earliestData.toISOString().split('T')[0].padEnd(12) +
          latestData.toISOString().split('T')[0].padEnd(12) +
          status
        );
      }
      
      gapAnalysis.push(analysis);
    }

    console.log('━'.repeat(80));
    
    // Summary statistics
    const totalActualRecords = gapAnalysis.reduce((sum, a) => sum + a.actualRecords, 0);
    const totalExpectedRecords = expectedRecordsPer5Min * expectedPairs.length;
    const overallCompletion = (totalActualRecords / totalExpectedRecords) * 100;
    
    const symbolsWithData_count = gapAnalysis.filter(a => a.hasData).length;
    const symbolsComplete = gapAnalysis.filter(a => a.completionPercent > 95).length;
    const symbolsPartial = gapAnalysis.filter(a => a.completionPercent > 0 && a.completionPercent <= 95).length;
    const symbolsMissing = gapAnalysis.filter(a => a.completionPercent === 0).length;

    console.log('\n📊 SUMMARY STATISTICS:');
    console.log('━'.repeat(40));
    console.log(`Total Expected Records: ${totalExpectedRecords.toLocaleString()}`);
    console.log(`Total Actual Records:   ${totalActualRecords.toLocaleString()}`);
    console.log(`Overall Completion:     ${overallCompletion.toFixed(1)}%`);
    console.log('');
    console.log(`Symbols Status:`);
    console.log(`  ✅ Complete (>95%):   ${symbolsComplete}/${expectedPairs.length}`);
    console.log(`  ⚠️ Partial (1-95%):   ${symbolsPartial}/${expectedPairs.length}`);
    console.log(`  ❌ Missing (0%):      ${symbolsMissing}/${expectedPairs.length}`);

    // Detailed gap analysis
    console.log('\n🕳️  DETAILED GAP ANALYSIS:');
    console.log('━'.repeat(50));
    
    const symbolsNeedingData = gapAnalysis.filter(a => a.completionPercent < 95);
    
    if (symbolsNeedingData.length === 0) {
      console.log('🎉 No gaps found! All symbols have complete data coverage.');
    } else {
      for (const analysis of symbolsNeedingData) {
        console.log(`\n📍 ${analysis.symbol}:`);
        console.log(`   Missing: ${(analysis.expectedRecords - analysis.actualRecords).toLocaleString()} records (${(100 - analysis.completionPercent).toFixed(1)}%)`);
        
        if (analysis.gaps.length > 0) {
          console.log(`   Gaps:`);
          for (const gap of analysis.gaps) {
            console.log(`     • ${gap.start.toISOString().split('T')[0]} to ${gap.end.toISOString().split('T')[0]} (${gap.durationDays} days)`);
          }
        }
      }
    }

    // Generate download commands for missing data
    console.log('\n🔧 RECOMMENDED ACTIONS:');
    console.log('━'.repeat(30));
    
    if (symbolsMissing > 0) {
      console.log('\n1️⃣ MISSING SYMBOLS (Priority: High):');
      const missingSymbols = gapAnalysis.filter(a => a.completionPercent === 0).map(a => a.symbol);
      console.log(`   Symbols: ${missingSymbols.join(', ')}`);
      console.log('   Command: npx tsx scripts/getKlines-bulk.ts "2021-07-19" "2025-07-19" "5m" --batch-size 5');
    }
    
    if (symbolsPartial > 0) {
      console.log('\n2️⃣ PARTIAL SYMBOLS (Priority: Medium):');
      const partialSymbols = gapAnalysis.filter(a => a.completionPercent > 0 && a.completionPercent < 95);
      for (const analysis of partialSymbols) {
        console.log(`   ${analysis.symbol}: ${analysis.completionPercent.toFixed(1)}% complete`);
        if (analysis.earliestData && analysis.latestData) {
          console.log(`     Has: ${analysis.earliestData.toISOString().split('T')[0]} to ${analysis.latestData.toISOString().split('T')[0]}`);
          console.log(`     Needs: 2021-07-19 to ${analysis.earliestData.toISOString().split('T')[0]} AND ${analysis.latestData.toISOString().split('T')[0]} to 2025-07-19`);
        }
      }
    }

    if (overallCompletion < 100) {
      console.log('\n🚀 BULK DOWNLOAD COMMAND:');
      console.log('   npx tsx scripts/getKlines-bulk.ts "2021-07-19" "2025-07-19" "5m" --clear-progress --batch-size 3');
      console.log('\n⚡ RESUME EXISTING DOWNLOAD:');
      console.log('   npx tsx scripts/getKlines-bulk.ts "2021-07-19" "2025-07-19" "5m"');
    } else {
      console.log('🎉 All data is complete! Ready for backtesting.');
    }

  } catch (error) {
    console.error('❌ Error analyzing gaps:', error);
  } finally {
    await prisma.$disconnect();
  }
}

identifyKlinesGaps().catch(console.error);