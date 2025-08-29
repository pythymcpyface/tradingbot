#!/usr/bin/env ts-node

/**
 * 5-Minute Glicko Ratings Integrity Verification
 * 
 * Verifies integrity assuming ratings should be calculated every 5 minutes:
 * - 5-minute intervals = 288 calculations per day
 * - 12 coins over 4 years (2021-07-19 to 2025-07-19)
 * - Expected: ~4.2 million entries total
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

class FiveMinuteIntegrityVerifier {
  private prisma: PrismaClient;
  
  private readonly EXPECTED_COINS = ['BTC', 'ETH', 'XRP', 'SOL', 'ADA', 'DOGE', 'POL', 'AVAX', 'LINK', 'XLM', 'BNB', 'USDT'];
  private readonly START_DATE = new Date('2021-07-19T00:00:00.000Z');
  private readonly END_DATE = new Date('2025-07-19T00:00:00.000Z');
  private readonly INTERVAL_MINUTES = 5;
  
  constructor() {
    this.prisma = new PrismaClient();
  }

  async initialize(): Promise<void> {
    await this.prisma.$connect();
    console.log('✅ Connected to database');
  }

  /**
   * Calculate expected 5-minute interval data points
   */
  private calculateExpected5MinuteEntries(): {
    totalDays: number;
    intervalsPerDay: number;
    expectedPerCoin: number;
    totalExpected: number;
  } {
    const totalMs = this.END_DATE.getTime() - this.START_DATE.getTime();
    const totalDays = Math.ceil(totalMs / (1000 * 60 * 60 * 24));
    const intervalsPerDay = (24 * 60) / this.INTERVAL_MINUTES; // 288 intervals per day
    const expectedPerCoin = Math.ceil(totalDays * intervalsPerDay);
    const totalExpected = expectedPerCoin * this.EXPECTED_COINS.length;
    
    return { totalDays, intervalsPerDay, expectedPerCoin, totalExpected };
  }

  /**
   * Analyze actual vs expected coverage
   */
  async analyzeActualCoverage(): Promise<void> {
    console.log('🎯 5-Minute Interval Analysis');
    console.log('=' .repeat(70));
    
    const { totalDays, intervalsPerDay, expectedPerCoin, totalExpected } = this.calculateExpected5MinuteEntries();
    
    console.log('📊 Expected Data (5-minute intervals):');
    console.log(`   Total days: ${totalDays.toLocaleString()}`);
    console.log(`   Intervals per day: ${intervalsPerDay} (every 5 minutes)`);
    console.log(`   Expected per coin: ${expectedPerCoin.toLocaleString()} entries`);
    console.log(`   Total expected: ${totalExpected.toLocaleString()} entries`);
    
    // Get actual data
    const actualTotal = await this.prisma.glickoRatings.count();
    const actualPerCoin = await this.prisma.glickoRatings.groupBy({
      by: ['symbol'],
      _count: { symbol: true },
      orderBy: { symbol: 'asc' }
    });
    
    console.log('\n📈 Actual Data:');
    console.log(`   Total actual: ${actualTotal.toLocaleString()} entries`);
    console.log(`   Coverage: ${((actualTotal / totalExpected) * 100).toFixed(2)}%`);
    
    console.log('\n📋 Per-Coin Analysis:');
    const coinMap = new Map(actualPerCoin.map(c => [c.symbol, c._count.symbol]));
    
    for (const coin of this.EXPECTED_COINS) {
      const actualCount = coinMap.get(coin) || 0;
      const coverage = ((actualCount / expectedPerCoin) * 100).toFixed(2);
      const missing = expectedPerCoin - actualCount;
      
      console.log(`   ${coin}:`);
      console.log(`     Actual: ${actualCount.toLocaleString()} entries`);
      console.log(`     Expected: ${expectedPerCoin.toLocaleString()} entries`);
      console.log(`     Coverage: ${coverage}%`);
      console.log(`     Missing: ${missing.toLocaleString()} entries`);
      console.log();
    }
  }

  /**
   * Check temporal intervals between ratings
   */
  async checkTemporalIntervals(): Promise<void> {
    console.log('⏰ Checking Temporal Intervals...');
    
    for (const coin of this.EXPECTED_COINS.slice(0, 3)) {
      console.log(`\n   ${coin} interval analysis:`);
      
      const ratings = await this.prisma.glickoRatings.findMany({
        where: { symbol: coin },
        select: { timestamp: true },
        orderBy: { timestamp: 'asc' },
        take: 100 // Sample first 100 for analysis
      });
      
      if (ratings.length >= 2) {
        const intervals: number[] = [];
        for (let i = 1; i < ratings.length; i++) {
          const intervalMinutes = (ratings[i].timestamp.getTime() - ratings[i-1].timestamp.getTime()) / (1000 * 60);
          intervals.push(intervalMinutes);
        }
        
        // Calculate statistics
        intervals.sort((a, b) => a - b);
        const min = intervals[0];
        const max = intervals[intervals.length - 1];
        const median = intervals[Math.floor(intervals.length / 2)];
        const avg = intervals.reduce((sum, val) => sum + val, 0) / intervals.length;
        
        // Count exact 5-minute intervals
        const fiveMinuteExact = intervals.filter(i => Math.abs(i - 5) < 0.1).length;
        const fiveMinutePercent = (fiveMinuteExact / intervals.length * 100).toFixed(1);
        
        console.log(`     Intervals analyzed: ${intervals.length}`);
        console.log(`     Min interval: ${min.toFixed(1)} minutes`);
        console.log(`     Max interval: ${max.toFixed(1)} minutes`);
        console.log(`     Average interval: ${avg.toFixed(1)} minutes`);
        console.log(`     Median interval: ${median.toFixed(1)} minutes`);
        console.log(`     Exact 5-minute intervals: ${fiveMinuteExact} (${fiveMinutePercent}%)`);
        
        // Assessment
        if (avg < 6) {
          console.log(`     ✅ Close to expected 5-minute intervals`);
        } else if (avg < 15) {
          console.log(`     ⚠️ Intervals longer than expected`);
        } else {
          console.log(`     ❌ Intervals much longer than expected 5 minutes`);
        }
      }
    }
  }

  /**
   * Identify potential gaps in 5-minute coverage
   */
  async identifyDataGaps(): Promise<void> {
    console.log('\n🔍 Identifying Data Gaps...');
    
    // Check for large gaps (> 1 hour) in the timeline
    for (const coin of this.EXPECTED_COINS.slice(0, 2)) {
      console.log(`\n   ${coin} gap analysis:`);
      
      const ratings = await this.prisma.glickoRatings.findMany({
        where: { symbol: coin },
        select: { timestamp: true },
        orderBy: { timestamp: 'asc' },
        take: 1000 // Larger sample
      });
      
      let largeGaps = 0;
      let totalGapTime = 0;
      
      for (let i = 1; i < ratings.length; i++) {
        const gapMinutes = (ratings[i].timestamp.getTime() - ratings[i-1].timestamp.getTime()) / (1000 * 60);
        if (gapMinutes > 60) { // Gaps larger than 1 hour
          largeGaps++;
          totalGapTime += gapMinutes;
        }
      }
      
      console.log(`     Large gaps (>1hr): ${largeGaps}`);
      console.log(`     Total gap time: ${(totalGapTime / 60).toFixed(1)} hours`);
      console.log(`     Average gap size: ${largeGaps > 0 ? (totalGapTime / largeGaps / 60).toFixed(1) : '0'} hours`);
    }
  }

  /**
   * Final assessment for 5-minute intervals
   */
  async generateFinalAssessment(): Promise<void> {
    const { totalExpected } = this.calculateExpected5MinuteEntries();
    const actualTotal = await this.prisma.glickoRatings.count();
    const coveragePercent = (actualTotal / totalExpected) * 100;
    
    console.log('\n' + '=' .repeat(70));
    console.log('📋 FINAL 5-MINUTE INTEGRITY ASSESSMENT');
    console.log('=' .repeat(70));
    
    console.log('🎯 Data Volume Assessment:');
    console.log(`   Expected (5-min intervals): ${totalExpected.toLocaleString()} entries`);
    console.log(`   Actual: ${actualTotal.toLocaleString()} entries`);
    console.log(`   Coverage: ${coveragePercent.toFixed(2)}%`);
    
    // Coverage assessment
    if (coveragePercent > 95) {
      console.log('   ✅ EXCELLENT: Near-complete 5-minute coverage');
    } else if (coveragePercent > 80) {
      console.log('   ✅ GOOD: Substantial 5-minute coverage');
    } else if (coveragePercent > 50) {
      console.log('   ⚠️ MODERATE: Partial coverage - significant gaps exist');
    } else if (coveragePercent > 10) {
      console.log('   ❌ POOR: Major gaps in 5-minute coverage');
    } else {
      console.log('   ❌ CRITICAL: Severe data shortage - system likely not working as intended');
    }
    
    console.log('\n🔍 Key Findings:');
    if (coveragePercent < 10) {
      console.log('   • Current data volume is FAR below 5-minute interval expectations');
      console.log('   • System appears to be batch processing rather than real-time 5-minute calculations');
      console.log('   • May need to reconfigure the Glicko calculation frequency');
    } else if (coveragePercent < 50) {
      console.log('   • Significant gaps exist in the 5-minute coverage');
      console.log('   • Some periods may be missing or system was offline');
    } else {
      console.log('   • Data volume is consistent with 5-minute interval expectations');
    }
    
    console.log('\n💡 Recommendations:');
    if (coveragePercent < 10) {
      console.log('   1. Verify if 5-minute intervals are actually required');
      console.log('   2. If yes, reconfigure the Glicko calculation script');
      console.log('   3. Consider the computational load of 5-minute calculations');
    } else if (coveragePercent < 80) {
      console.log('   1. Identify and fill temporal gaps in the data');
      console.log('   2. Verify system uptime during missing periods');
      console.log('   3. Consider data recovery from backups if available');
    } else {
      console.log('   1. Data integrity appears good for 5-minute intervals');
      console.log('   2. Continue monitoring for ongoing data consistency');
    }
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
    console.log('\n🧹 Database connection closed');
  }
}

async function main() {
  try {
    const verifier = new FiveMinuteIntegrityVerifier();
    await verifier.initialize();
    
    await verifier.analyzeActualCoverage();
    await verifier.checkTemporalIntervals();
    await verifier.identifyDataGaps();
    await verifier.generateFinalAssessment();
    
    await verifier.cleanup();
  } catch (error) {
    console.error('💥 5-minute integrity verification failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}