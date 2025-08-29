#!/usr/bin/env ts-node

/**
 * Glicko Ratings Data Integrity Verification Script
 * 
 * Verifies the integrity of Glicko ratings data given:
 * - 5-minute intervals
 * - 12 coins (BTC, ETH, XRP, SOL, ADA, DOGE, POL, AVAX, LINK, XLM, BNB, USDT)
 * - Date range: 2021-07-19 to 2025-07-19
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

interface IntegrityReport {
  expectedCoins: string[];
  actualCoins: string[];
  missingCoins: string[];
  extraCoins: string[];
  totalRecords: number;
  recordsPerCoin: Map<string, number>;
  dateRange: {
    earliestTimestamp?: Date;
    latestTimestamp?: Date;
    expectedDays: number;
    actualDays: number;
  };
  ratingValidation: {
    validRatings: number;
    invalidRatings: number;
    ratingRange: { min: number; max: number };
    rdRange: { min: number; max: number };
    volatilityRange: { min: number; max: number };
  };
}

class GlickoIntegrityVerifier {
  private prisma: PrismaClient;
  
  // Expected configuration
  private readonly EXPECTED_COINS = ['BTC', 'ETH', 'XRP', 'SOL', 'ADA', 'DOGE', 'POL', 'AVAX', 'LINK', 'XLM', 'BNB', 'USDT'];
  private readonly START_DATE = new Date('2021-07-19T00:00:00.000Z');
  private readonly END_DATE = new Date('2025-07-19T00:00:00.000Z');
  private readonly INTERVAL_MINUTES = 5;
  
  constructor() {
    this.prisma = new PrismaClient();
  }

  async initialize(): Promise<void> {
    try {
      await this.prisma.$connect();
      console.log('✅ Connected to database');
    } catch (error) {
      console.error('❌ Database connection failed:', error);
      throw error;
    }
  }

  /**
   * Calculate expected data points
   */
  private calculateExpectedDataPoints(): { totalDays: number; expectedRecordsPerCoin: number } {
    const totalDays = Math.ceil((this.END_DATE.getTime() - this.START_DATE.getTime()) / (1000 * 60 * 60 * 24));
    const intervalsPerDay = (24 * 60) / this.INTERVAL_MINUTES; // 288 intervals per day for 5-minute data
    const expectedRecordsPerCoin = Math.ceil(totalDays * intervalsPerDay);
    
    return { totalDays, expectedRecordsPerCoin };
  }

  /**
   * Verify table structure and basic data
   */
  async verifyTableStructure(): Promise<void> {
    console.log('🔍 Verifying Glicko ratings table structure...');
    
    try {
      // Check if table exists and get sample data
      const sampleRecord = await this.prisma.glickoRatings.findFirst();
      
      if (!sampleRecord) {
        console.log('⚠️ No records found in glicko_ratings table');
        return;
      }
      
      console.log('✅ Table exists with sample record:');
      console.log(`   Symbol: ${sampleRecord.symbol}`);
      console.log(`   Timestamp: ${sampleRecord.timestamp}`);
      console.log(`   Rating: ${sampleRecord.rating}`);
      console.log(`   RD: ${sampleRecord.ratingDeviation}`);
      console.log(`   Volatility: ${sampleRecord.volatility}`);
      console.log(`   Performance Score: ${sampleRecord.performanceScore}`);
      
    } catch (error) {
      console.error('❌ Error verifying table structure:', error);
      throw error;
    }
  }

  /**
   * Analyze coin coverage
   */
  async analyzeCoinCoverage(): Promise<{ actualCoins: string[]; missingCoins: string[]; extraCoins: string[] }> {
    console.log('\n📊 Analyzing coin coverage...');
    
    const actualCoins = await this.prisma.glickoRatings.findMany({
      select: { symbol: true },
      distinct: ['symbol'],
      orderBy: { symbol: 'asc' }
    });
    
    const actualCoinNames = actualCoins.map(record => record.symbol);
    const missingCoins = this.EXPECTED_COINS.filter(coin => !actualCoinNames.includes(coin));
    const extraCoins = actualCoinNames.filter(coin => !this.EXPECTED_COINS.includes(coin));
    
    console.log(`   Expected coins: ${this.EXPECTED_COINS.length} (${this.EXPECTED_COINS.join(', ')})`);
    console.log(`   Actual coins: ${actualCoinNames.length} (${actualCoinNames.join(', ')})`);
    
    if (missingCoins.length > 0) {
      console.log(`   ❌ Missing coins: ${missingCoins.join(', ')}`);
    } else {
      console.log(`   ✅ All expected coins present`);
    }
    
    if (extraCoins.length > 0) {
      console.log(`   ⚠️ Extra coins: ${extraCoins.join(', ')}`);
    }
    
    return { actualCoins: actualCoinNames, missingCoins, extraCoins };
  }

  /**
   * Analyze record counts and date coverage
   */
  async analyzeDataCoverage(): Promise<{
    totalRecords: number;
    recordsPerCoin: Map<string, number>;
    dateRange: { earliest?: Date; latest?: Date };
  }> {
    console.log('\n📈 Analyzing data coverage...');
    
    // Get total records
    const totalRecords = await this.prisma.glickoRatings.count();
    
    // Get records per coin
    const recordsPerCoinRaw = await this.prisma.glickoRatings.groupBy({
      by: ['symbol'],
      _count: { symbol: true },
      orderBy: { symbol: 'asc' }
    });
    
    const recordsPerCoin = new Map<string, number>();
    recordsPerCoinRaw.forEach(record => {
      recordsPerCoin.set(record.symbol, record._count.symbol);
    });
    
    // Get date range
    const dateRange = await this.prisma.glickoRatings.aggregate({
      _min: { timestamp: true },
      _max: { timestamp: true }
    });
    
    console.log(`   Total records: ${totalRecords.toLocaleString()}`);
    console.log(`   Records per coin:`);
    
    const { expectedRecordsPerCoin } = this.calculateExpectedDataPoints();
    
    for (const [coin, count] of recordsPerCoin) {
      const coverage = ((count / expectedRecordsPerCoin) * 100).toFixed(2);
      console.log(`     ${coin}: ${count.toLocaleString()} records (${coverage}% of expected)`);
    }
    
    if (dateRange._min.timestamp && dateRange._max.timestamp) {
      const actualDays = Math.ceil((dateRange._max.timestamp.getTime() - dateRange._min.timestamp.getTime()) / (1000 * 60 * 60 * 24));
      const { totalDays } = this.calculateExpectedDataPoints();
      
      console.log(`   Date range: ${dateRange._min.timestamp.toISOString()} to ${dateRange._max.timestamp.toISOString()}`);
      console.log(`   Actual days covered: ${actualDays} (expected: ${totalDays})`);
    }
    
    return {
      totalRecords,
      recordsPerCoin,
      dateRange: {
        earliest: dateRange._min.timestamp || undefined,
        latest: dateRange._max.timestamp || undefined
      }
    };
  }

  /**
   * Validate rating values
   */
  async validateRatings(): Promise<{
    validRatings: number;
    invalidRatings: number;
    ratingRange: { min: number; max: number };
    rdRange: { min: number; max: number };
    volatilityRange: { min: number; max: number };
  }> {
    console.log('\n🎯 Validating rating values...');
    
    // Get rating statistics
    const ratingStats = await this.prisma.glickoRatings.aggregate({
      _min: { 
        rating: true, 
        ratingDeviation: true, 
        volatility: true 
      },
      _max: { 
        rating: true, 
        ratingDeviation: true, 
        volatility: true 
      },
      _count: { rating: true }
    });
    
    // Check for invalid ratings (null, negative, or extreme values)
    const invalidRatings = await this.prisma.glickoRatings.count({
      where: {
        OR: [
          { rating: { lt: 0 } },
          { rating: { gt: 3000 } },
          { ratingDeviation: { lt: 0 } },
          { ratingDeviation: { gt: 500 } },
          { volatility: { lt: 0 } },
          { volatility: { gt: 2 } }
        ]
      }
    });
    
    const validRatings = ratingStats._count.rating - invalidRatings;
    
    console.log(`   Valid ratings: ${validRatings.toLocaleString()}`);
    console.log(`   Invalid ratings: ${invalidRatings.toLocaleString()}`);
    console.log(`   Rating range: ${ratingStats._min.rating} - ${ratingStats._max.rating}`);
    console.log(`   RD range: ${ratingStats._min.ratingDeviation} - ${ratingStats._max.ratingDeviation}`);
    console.log(`   Volatility range: ${ratingStats._min.volatility} - ${ratingStats._max.volatility}`);
    
    return {
      validRatings,
      invalidRatings,
      ratingRange: { 
        min: Number(ratingStats._min.rating || 0), 
        max: Number(ratingStats._max.rating || 0) 
      },
      rdRange: { 
        min: Number(ratingStats._min.ratingDeviation || 0), 
        max: Number(ratingStats._max.ratingDeviation || 0) 
      },
      volatilityRange: { 
        min: Number(ratingStats._min.volatility || 0), 
        max: Number(ratingStats._max.volatility || 0) 
      }
    };
  }

  /**
   * Check for data consistency issues
   */
  async checkDataConsistency(): Promise<void> {
    console.log('\n🔧 Checking data consistency...');
    
    // Check for duplicate records
    const duplicates = await this.prisma.$queryRaw<Array<{symbol: string, timestamp: Date, count: BigInt}>>`
      SELECT symbol, timestamp, COUNT(*) as count
      FROM "glicko_ratings" 
      GROUP BY symbol, timestamp 
      HAVING COUNT(*) > 1
      LIMIT 10
    `;
    
    if (duplicates.length > 0) {
      console.log(`   ❌ Found ${duplicates.length} duplicate timestamp/symbol combinations:`);
      duplicates.forEach(dup => {
        console.log(`     ${dup.symbol} at ${dup.timestamp}: ${dup.count} records`);
      });
    } else {
      console.log(`   ✅ No duplicate records found`);
    }
    
    // Check for gaps in data (example: missing timestamps for coins that should have continuous data)
    console.log('   📊 Checking for temporal gaps...');
    
    for (const coin of this.EXPECTED_COINS.slice(0, 3)) { // Check first 3 coins as sample
      const coinRecords = await this.prisma.glickoRatings.findMany({
        where: { symbol: coin },
        select: { timestamp: true },
        orderBy: { timestamp: 'asc' },
        take: 100 // Sample first 100 records
      });
      
      if (coinRecords.length > 1) {
        let gaps = 0;
        for (let i = 1; i < coinRecords.length; i++) {
          const timeDiff = coinRecords[i].timestamp.getTime() - coinRecords[i-1].timestamp.getTime();
          const expectedInterval = this.INTERVAL_MINUTES * 60 * 1000; // 5 minutes in ms
          
          if (timeDiff > expectedInterval * 2) { // Allow some tolerance
            gaps++;
          }
        }
        console.log(`     ${coin}: ${gaps} gaps detected in first 100 records`);
      }
    }
  }

  /**
   * Generate comprehensive integrity report
   */
  async generateIntegrityReport(): Promise<IntegrityReport> {
    console.log('🎯 Starting Glicko Ratings Data Integrity Verification...');
    console.log('=' .repeat(70));
    
    // Verify table structure
    await this.verifyTableStructure();
    
    // Analyze coin coverage
    const { actualCoins, missingCoins, extraCoins } = await this.analyzeCoinCoverage();
    
    // Analyze data coverage
    const { totalRecords, recordsPerCoin, dateRange } = await this.analyzeDataCoverage();
    
    // Validate rating values
    const ratingValidation = await this.validateRatings();
    
    // Check data consistency
    await this.checkDataConsistency();
    
    // Calculate expected vs actual metrics
    const { totalDays, expectedRecordsPerCoin } = this.calculateExpectedDataPoints();
    const actualDays = dateRange.earliest && dateRange.latest ? 
      Math.ceil((dateRange.latest.getTime() - dateRange.earliest.getTime()) / (1000 * 60 * 60 * 24)) : 0;
    
    const report: IntegrityReport = {
      expectedCoins: this.EXPECTED_COINS,
      actualCoins,
      missingCoins,
      extraCoins,
      totalRecords,
      recordsPerCoin,
      dateRange: {
        earliestTimestamp: dateRange.earliest,
        latestTimestamp: dateRange.latest,
        expectedDays: totalDays,
        actualDays
      },
      ratingValidation
    };
    
    return report;
  }

  /**
   * Print final integrity assessment
   */
  printFinalAssessment(report: IntegrityReport): void {
    console.log('\n' + '=' .repeat(70));
    console.log('📋 FINAL INTEGRITY ASSESSMENT');
    console.log('=' .repeat(70));
    
    const { expectedRecordsPerCoin } = this.calculateExpectedDataPoints();
    const totalExpectedRecords = expectedRecordsPerCoin * this.EXPECTED_COINS.length;
    const completeness = ((report.totalRecords / totalExpectedRecords) * 100).toFixed(2);
    
    console.log(`📊 Data Completeness: ${completeness}% (${report.totalRecords.toLocaleString()} / ${totalExpectedRecords.toLocaleString()} expected records)`);
    
    // Overall status
    const criticalIssues = report.missingCoins.length + report.ratingValidation.invalidRatings;
    const minorIssues = report.extraCoins.length;
    
    if (criticalIssues === 0 && minorIssues === 0) {
      console.log('✅ EXCELLENT: Data integrity is perfect');
    } else if (criticalIssues === 0) {
      console.log('✅ GOOD: Data integrity is solid with minor issues');
    } else if (criticalIssues < 5) {
      console.log('⚠️  ACCEPTABLE: Data integrity has some issues that should be addressed');
    } else {
      console.log('❌ POOR: Data integrity has significant issues requiring immediate attention');
    }
    
    // Issue summary
    if (criticalIssues > 0 || minorIssues > 0) {
      console.log(`\n🔍 Issue Summary:`);
      if (report.missingCoins.length > 0) {
        console.log(`   ❌ ${report.missingCoins.length} missing coins: ${report.missingCoins.join(', ')}`);
      }
      if (report.ratingValidation.invalidRatings > 0) {
        console.log(`   ❌ ${report.ratingValidation.invalidRatings} invalid rating values`);
      }
      if (report.extraCoins.length > 0) {
        console.log(`   ⚠️  ${report.extraCoins.length} unexpected coins: ${report.extraCoins.join(', ')}`);
      }
    }
    
    console.log(`\n📈 Coverage by Coin:`);
    for (const coin of this.EXPECTED_COINS) {
      const count = report.recordsPerCoin.get(coin) || 0;
      const coverage = ((count / expectedRecordsPerCoin) * 100).toFixed(1);
      const status = count > 0 ? '✅' : '❌';
      console.log(`   ${status} ${coin}: ${count.toLocaleString()} records (${coverage}%)`);
    }
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
    console.log('\n🧹 Database connection closed');
  }
}

/**
 * Main execution function
 */
async function main() {
  try {
    const verifier = new GlickoIntegrityVerifier();
    await verifier.initialize();
    
    const report = await verifier.generateIntegrityReport();
    verifier.printFinalAssessment(report);
    
    await verifier.cleanup();
  } catch (error) {
    console.error('💥 Integrity verification failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { GlickoIntegrityVerifier };