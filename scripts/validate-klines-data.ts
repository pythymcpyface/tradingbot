#!/usr/bin/env ts-node

/**
 * Validate Klines Data Script
 * 
 * This script validates the klines data in the database for trading pairs from .env
 * with a specific interval (default: 5m). It checks data completeness, gaps,
 * duplicates, and provides comprehensive statistics.
 * 
 * Usage: npx ts-node scripts/validate-klines-data.ts [interval]
 * Example: npx ts-node scripts/validate-klines-data.ts 5m
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

interface ValidationResult {
  symbol: string;
  totalRecords: number;
  dateRange: {
    earliest: Date | null;
    latest: Date | null;
    spanDays: number;
  };
  expectedRecords: number;
  completeness: number; // percentage
  gaps: Array<{
    start: Date;
    end: Date;
    missingIntervals: number;
  }>;
  duplicates: number;
  priceStatistics: {
    minPrice: number;
    maxPrice: number;
    avgPrice: number;
    priceRange: number;
  };
  volumeStatistics: {
    minVolume: number;
    maxVolume: number;
    avgVolume: number;
    totalVolume: number;
  };
  dataQuality: {
    score: number; // 0-100
    issues: string[];
  };
}

interface OverallValidation {
  totalPairs: number;
  validatedPairs: number;
  totalRecords: number;
  overallCompleteness: number;
  interval: string;
  intervalMs: number;
  summary: ValidationResult[];
  recommendations: string[];
}

class KlinesDataValidator {
  private prisma: PrismaClient;
  private interval: string;
  private intervalMs: number;
  private tradingPairs: string[];

  constructor(interval: string = '5m') {
    this.prisma = new PrismaClient();
    this.interval = interval;
    this.intervalMs = this.getIntervalInMs(interval);
    this.tradingPairs = this.getTradingPairsFromEnv();
  }

  /**
   * Get trading pairs from environment variable
   */
  private getTradingPairsFromEnv(): string[] {
    const tradingPairsEnv = process.env.TRADING_PAIRS;
    if (!tradingPairsEnv) {
      throw new Error('TRADING_PAIRS not found in environment variables');
    }
    return tradingPairsEnv.split(',').map(pair => pair.trim());
  }

  /**
   * Convert interval string to milliseconds
   */
  private getIntervalInMs(interval: string): number {
    const intervalMap: { [key: string]: number } = {
      '1m': 60 * 1000,
      '3m': 3 * 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '2h': 2 * 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '8h': 8 * 60 * 60 * 1000,
      '12h': 12 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
      '3d': 3 * 24 * 60 * 60 * 1000,
      '1w': 7 * 24 * 60 * 60 * 1000,
      '1M': 30 * 24 * 60 * 60 * 1000
    };

    if (!intervalMap[interval]) {
      throw new Error(`Unsupported interval: ${interval}`);
    }

    return intervalMap[interval];
  }

  async initialize(): Promise<void> {
    try {
      await this.prisma.$connect();
      console.log('✅ Connected to database');
      console.log(`📊 Validating interval: ${this.interval} (${this.intervalMs}ms)`);
      console.log(`🎯 Trading pairs from .env: ${this.tradingPairs.length} pairs`);
    } catch (error) {
      console.error('❌ Database connection failed:', error);
      throw error;
    }
  }

  /**
   * Validate data for a single symbol
   */
  async validateSymbol(symbol: string): Promise<ValidationResult> {
    console.log(`\n🔍 Validating ${symbol}...`);

    // Get basic record count
    const totalRecords = await this.prisma.klines.count({
      where: { symbol }
    });

    if (totalRecords === 0) {
      return {
        symbol,
        totalRecords: 0,
        dateRange: { earliest: null, latest: null, spanDays: 0 },
        expectedRecords: 0,
        completeness: 0,
        gaps: [],
        duplicates: 0,
        priceStatistics: { minPrice: 0, maxPrice: 0, avgPrice: 0, priceRange: 0 },
        volumeStatistics: { minVolume: 0, maxVolume: 0, avgVolume: 0, totalVolume: 0 },
        dataQuality: { score: 0, issues: ['No data found'] }
      };
    }

    // Get date range
    const dateStats = await this.prisma.klines.aggregate({
      where: { symbol },
      _min: { openTime: true },
      _max: { openTime: true }
    });

    const earliest = dateStats._min.openTime;
    const latest = dateStats._max.openTime;
    const spanDays = earliest && latest 
      ? (latest.getTime() - earliest.getTime()) / (24 * 60 * 60 * 1000)
      : 0;

    // Calculate expected records based on date range
    const expectedRecords = spanDays > 0 
      ? Math.floor((spanDays * 24 * 60 * 60 * 1000) / this.intervalMs)
      : 0;

    const completeness = expectedRecords > 0 
      ? (totalRecords / expectedRecords) * 100 
      : 0;

    // Get all records for detailed analysis (limit to avoid memory issues)
    const records = await this.prisma.klines.findMany({
      where: { symbol },
      select: {
        openTime: true,
        close: true,
        volume: true
      },
      orderBy: { openTime: 'asc' },
      take: 50000 // Limit for performance
    });

    // Find gaps
    const gaps = this.findGaps(records.map(r => r.openTime));

    // Check for duplicates
    const duplicates = await this.countDuplicates(symbol);

    // Calculate price statistics
    const prices = records.map(r => parseFloat(r.close.toString()));
    const priceStatistics = {
      minPrice: Math.min(...prices),
      maxPrice: Math.max(...prices),
      avgPrice: prices.reduce((sum, p) => sum + p, 0) / prices.length,
      priceRange: Math.max(...prices) - Math.min(...prices)
    };

    // Calculate volume statistics
    const volumes = records.map(r => parseFloat(r.volume.toString()));
    const volumeStatistics = {
      minVolume: Math.min(...volumes),
      maxVolume: Math.max(...volumes),
      avgVolume: volumes.reduce((sum, v) => sum + v, 0) / volumes.length,
      totalVolume: volumes.reduce((sum, v) => sum + v, 0)
    };

    // Calculate data quality score
    const dataQuality = this.calculateDataQuality({
      completeness,
      gaps: gaps.length,
      duplicates,
      totalRecords
    });

    console.log(`  📊 Records: ${totalRecords.toLocaleString()} / ${expectedRecords.toLocaleString()} (${completeness.toFixed(1)}%)`);
    console.log(`  📅 Range: ${earliest?.toISOString().split('T')[0]} to ${latest?.toISOString().split('T')[0]} (${spanDays.toFixed(1)} days)`);
    console.log(`  ⚠️  Gaps: ${gaps.length}, Duplicates: ${duplicates}`);

    return {
      symbol,
      totalRecords,
      dateRange: { earliest, latest, spanDays },
      expectedRecords,
      completeness,
      gaps,
      duplicates,
      priceStatistics,
      volumeStatistics,
      dataQuality
    };
  }

  /**
   * Find gaps in the time series data
   */
  private findGaps(timestamps: Date[]): Array<{ start: Date; end: Date; missingIntervals: number }> {
    const gaps: Array<{ start: Date; end: Date; missingIntervals: number }> = [];
    
    for (let i = 1; i < timestamps.length; i++) {
      const expectedNext = new Date(timestamps[i - 1].getTime() + this.intervalMs);
      const actual = timestamps[i];
      
      if (actual.getTime() > expectedNext.getTime()) {
        const missingIntervals = Math.floor((actual.getTime() - expectedNext.getTime()) / this.intervalMs);
        gaps.push({
          start: expectedNext,
          end: new Date(actual.getTime() - this.intervalMs),
          missingIntervals
        });
      }
    }
    
    return gaps;
  }

  /**
   * Count duplicate records for a symbol
   */
  async countDuplicates(symbol: string): Promise<number> {
    const duplicateQuery = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count 
      FROM (
        SELECT symbol, "openTime"
        FROM klines 
        WHERE symbol = ${symbol}
        GROUP BY symbol, "openTime"
        HAVING COUNT(*) > 1
      ) duplicates
    `;

    return Number(duplicateQuery[0]?.count || 0);
  }

  /**
   * Calculate data quality score (0-100)
   */
  private calculateDataQuality(metrics: {
    completeness: number;
    gaps: number;
    duplicates: number;
    totalRecords: number;
  }): { score: number; issues: string[] } {
    let score = 100;
    const issues: string[] = [];

    // Completeness penalty
    if (metrics.completeness < 95) {
      score -= (95 - metrics.completeness) * 0.5;
      issues.push(`Low completeness: ${metrics.completeness.toFixed(1)}%`);
    }

    // Gaps penalty
    if (metrics.gaps > 0) {
      score -= Math.min(metrics.gaps * 2, 20);
      issues.push(`${metrics.gaps} data gaps found`);
    }

    // Duplicates penalty
    if (metrics.duplicates > 0) {
      score -= Math.min(metrics.duplicates * 5, 25);
      issues.push(`${metrics.duplicates} duplicate records`);
    }

    // Low data volume penalty
    if (metrics.totalRecords < 100) {
      score -= 30;
      issues.push('Very low data volume');
    }

    return {
      score: Math.max(0, Math.round(score)),
      issues: issues.length > 0 ? issues : ['Data quality is good']
    };
  }

  /**
   * Run comprehensive validation for all trading pairs
   */
  async validateAllPairs(): Promise<OverallValidation> {
    console.log('🚀 Starting comprehensive klines data validation...');
    console.log('=' .repeat(70));

    const results: ValidationResult[] = [];
    let totalRecords = 0;
    let validatedPairs = 0;

    for (const symbol of this.tradingPairs) {
      try {
        const result = await this.validateSymbol(symbol);
        results.push(result);
        totalRecords += result.totalRecords;
        if (result.totalRecords > 0) validatedPairs++;
      } catch (error) {
        console.error(`❌ Error validating ${symbol}:`, error);
        results.push({
          symbol,
          totalRecords: 0,
          dateRange: { earliest: null, latest: null, spanDays: 0 },
          expectedRecords: 0,
          completeness: 0,
          gaps: [],
          duplicates: 0,
          priceStatistics: { minPrice: 0, maxPrice: 0, avgPrice: 0, priceRange: 0 },
          volumeStatistics: { minVolume: 0, maxVolume: 0, avgVolume: 0, totalVolume: 0 },
          dataQuality: { score: 0, issues: [`Validation error: ${error}`] }
        });
      }
    }

    // Calculate overall completeness
    const totalExpected = results.reduce((sum, r) => sum + r.expectedRecords, 0);
    const overallCompleteness = totalExpected > 0 ? (totalRecords / totalExpected) * 100 : 0;

    // Generate recommendations
    const recommendations = this.generateRecommendations(results);

    return {
      totalPairs: this.tradingPairs.length,
      validatedPairs,
      totalRecords,
      overallCompleteness,
      interval: this.interval,
      intervalMs: this.intervalMs,
      summary: results,
      recommendations
    };
  }

  /**
   * Generate recommendations based on validation results
   */
  private generateRecommendations(results: ValidationResult[]): string[] {
    const recommendations: string[] = [];
    
    const missingPairs = results.filter(r => r.totalRecords === 0);
    const lowQualityPairs = results.filter(r => r.dataQuality.score < 70);
    const gappyPairs = results.filter(r => r.gaps.length > 10);
    const duplicatePairs = results.filter(r => r.duplicates > 0);

    if (missingPairs.length > 0) {
      recommendations.push(`Download data for ${missingPairs.length} missing pairs: ${missingPairs.map(p => p.symbol).slice(0, 5).join(', ')}${missingPairs.length > 5 ? '...' : ''}`);
    }

    if (lowQualityPairs.length > 0) {
      recommendations.push(`Review ${lowQualityPairs.length} pairs with quality issues`);
    }

    if (gappyPairs.length > 0) {
      recommendations.push(`Fill data gaps for ${gappyPairs.length} pairs with significant gaps`);
    }

    if (duplicatePairs.length > 0) {
      recommendations.push(`Remove duplicates from ${duplicatePairs.length} pairs`);
    }

    if (recommendations.length === 0) {
      recommendations.push('Data quality looks good! No immediate actions required.');
    }

    return recommendations;
  }

  /**
   * Generate detailed report
   */
  generateReport(validation: OverallValidation): void {
    console.log('\n📊 KLINES DATA VALIDATION REPORT');
    console.log('=' .repeat(70));
    console.log(`🕐 Interval: ${validation.interval} (${validation.intervalMs}ms)`);
    console.log(`🎯 Trading Pairs: ${validation.totalPairs} configured, ${validation.validatedPairs} with data`);
    console.log(`📈 Total Records: ${validation.totalRecords.toLocaleString()}`);
    console.log(`✅ Overall Completeness: ${validation.overallCompleteness.toFixed(2)}%`);

    console.log('\n📋 PER-PAIR SUMMARY:');
    console.log('-'.repeat(70));
    console.log('Symbol       | Records    | Completeness | Quality | Issues');
    console.log('-'.repeat(70));

    validation.summary
      .sort((a, b) => b.totalRecords - a.totalRecords)
      .forEach(result => {
        const symbol = result.symbol.padEnd(12);
        const records = result.totalRecords.toLocaleString().padStart(10);
        const completeness = `${result.completeness.toFixed(1)}%`.padStart(12);
        const quality = `${result.dataQuality.score}`.padStart(7);
        const issues = result.dataQuality.issues.length;
        
        console.log(`${symbol} | ${records} | ${completeness} | ${quality} | ${issues}`);
      });

    console.log('\n🎯 TOP ISSUES:');
    const issueGroups = validation.summary
      .filter(r => r.dataQuality.score < 90)
      .slice(0, 10);

    issueGroups.forEach(result => {
      console.log(`  ${result.symbol}: ${result.dataQuality.issues.join(', ')}`);
    });

    console.log('\n💡 RECOMMENDATIONS:');
    validation.recommendations.forEach((rec, index) => {
      console.log(`  ${index + 1}. ${rec}`);
    });

    console.log('\n📊 STATISTICS:');
    const withData = validation.summary.filter(r => r.totalRecords > 0);
    const avgCompleteness = withData.reduce((sum, r) => sum + r.completeness, 0) / withData.length;
    const avgQuality = withData.reduce((sum, r) => sum + r.dataQuality.score, 0) / withData.length;
    
    console.log(`  - Average Completeness: ${avgCompleteness.toFixed(2)}%`);
    console.log(`  - Average Quality Score: ${avgQuality.toFixed(1)}/100`);
    console.log(`  - Pairs with >95% completeness: ${withData.filter(r => r.completeness > 95).length}`);
    console.log(`  - Pairs with quality score >80: ${withData.filter(r => r.dataQuality.score > 80).length}`);
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
    console.log('\n🧹 Database connection closed');
  }
}

/**
 * Parse command line arguments
 */
function parseArguments(): { interval: string } {
  const args = process.argv.slice(2);
  const interval = args[0] || '5m';

  // Validate interval
  const validIntervals = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'];
  if (!validIntervals.includes(interval)) {
    console.error(`❌ Invalid interval: ${interval}`);
    console.error(`Valid intervals: ${validIntervals.join(', ')}`);
    process.exit(1);
  }

  return { interval };
}

/**
 * Main execution function
 */
async function main() {
  try {
    const { interval } = parseArguments();
    const validator = new KlinesDataValidator(interval);

    await validator.initialize();
    const validation = await validator.validateAllPairs();
    validator.generateReport(validation);

    console.log('\n🎉 Validation completed successfully!');
    
    await validator.cleanup();

  } catch (error) {
    console.error('\n❌ Validation failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { KlinesDataValidator };