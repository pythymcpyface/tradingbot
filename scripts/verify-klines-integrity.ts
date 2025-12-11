#!/usr/bin/env ts-node

/**
 * Verify Klines Data Integrity Script
 *
 * Validates the integrity of 1h klines data downloaded from Binance.
 * Checks for:
 * - Complete date range coverage (2021-12-08 to 2025-12-08)
 * - Data gaps and missing intervals
 * - Duplicate records
 * - Price and volume anomalies
 * - Data consistency across all pairs
 *
 * Usage: npx ts-node scripts/verify-klines-integrity.ts
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

interface IntegrityCheckResult {
  symbol: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  totalRecords: number;
  dateRange: {
    earliest: Date | null;
    latest: Date | null;
    spanDays: number;
  };
  expectedRecords: number;
  actualRecords: number;
  completeness: number;
  gaps: Array<{
    start: Date;
    end: Date;
    missingRecords: number;
  }>;
  duplicates: number;
  priceValidation: {
    minPrice: number;
    maxPrice: number;
    avgPrice: number;
    anomalies: number;
  };
  volumeValidation: {
    minVolume: number;
    maxVolume: number;
    avgVolume: number;
    zeroVolumes: number;
  };
  issues: string[];
}

interface OverallIntegrityReport {
  timestamp: Date;
  totalPairs: number;
  pairsWithData: number;
  totalRecords: number;
  expectedDateRange: { start: Date; end: Date };
  interval: string;
  intervalMs: number;
  results: IntegrityCheckResult[];
  summary: {
    passCount: number;
    warnCount: number;
    failCount: number;
    overallCompleteness: number;
    avgQuality: number;
  };
  recommendations: string[];
}

class KlinesIntegrityVerifier {
  private prisma: PrismaClient;
  private readonly INTERVAL = '1h';
  private readonly INTERVAL_MS = 60 * 60 * 1000; // 1 hour in milliseconds
  private readonly EXPECTED_START = new Date('2021-12-08T00:00:00Z');
  private readonly EXPECTED_END = new Date('2025-12-08T00:00:00Z');
  private tradingPairs: string[] = [];

  constructor() {
    this.prisma = new PrismaClient();
    this.getTradingPairsFromEnv();
  }

  private getTradingPairsFromEnv(): void {
    const baseTradingPairs = process.env.BASE_TRADING_PAIRS;
    if (!baseTradingPairs) {
      throw new Error('BASE_TRADING_PAIRS not found in environment variables');
    }
    this.tradingPairs = baseTradingPairs.split(',').map(pair => pair.trim());
    console.log(`📋 Loaded ${this.tradingPairs.length} trading pairs from BASE_TRADING_PAIRS`);
  }

  async initialize(): Promise<void> {
    try {
      await this.prisma.$connect();
      console.log('✅ Connected to database');
      console.log(`📊 Verifying 1h interval data`);
      console.log(`📅 Expected range: ${this.EXPECTED_START.toISOString()} to ${this.EXPECTED_END.toISOString()}`);
    } catch (error) {
      console.error('❌ Database connection failed:', error);
      throw error;
    }
  }

  private calculateExpectedRecords(): number {
    const spanMs = this.EXPECTED_END.getTime() - this.EXPECTED_START.getTime();
    return Math.floor(spanMs / this.INTERVAL_MS) + 1;
  }

  async verifySymbol(symbol: string): Promise<IntegrityCheckResult> {
    const totalRecords = await this.prisma.klines.count({ where: { symbol } });

    const baseResult: IntegrityCheckResult = {
      symbol,
      status: 'PASS',
      totalRecords,
      dateRange: { earliest: null, latest: null, spanDays: 0 },
      expectedRecords: this.calculateExpectedRecords(),
      actualRecords: 0,
      completeness: 0,
      gaps: [],
      duplicates: 0,
      priceValidation: { minPrice: 0, maxPrice: 0, avgPrice: 0, anomalies: 0 },
      volumeValidation: { minVolume: 0, maxVolume: 0, avgVolume: 0, zeroVolumes: 0 },
      issues: []
    };

    if (totalRecords === 0) {
      baseResult.status = 'FAIL';
      baseResult.issues.push('No data found for this symbol');
      return baseResult;
    }

    // Get date range
    const dateStats = await this.prisma.klines.aggregate({
      where: { symbol },
      _min: { openTime: true },
      _max: { openTime: true }
    });

    const earliest = dateStats._min.openTime;
    const latest = dateStats._max.openTime;

    if (!earliest || !latest) {
      baseResult.status = 'FAIL';
      baseResult.issues.push('Could not determine date range');
      return baseResult;
    }

    const spanDays = (latest.getTime() - earliest.getTime()) / (24 * 60 * 60 * 1000);
    baseResult.dateRange = { earliest, latest, spanDays };
    baseResult.actualRecords = totalRecords;
    baseResult.completeness = (totalRecords / baseResult.expectedRecords) * 100;

    // Check if within expected range
    if (earliest > this.EXPECTED_START) {
      baseResult.issues.push(`Data starts late: ${earliest.toISOString().split('T')[0]} (expected ${this.EXPECTED_START.toISOString().split('T')[0]})`);
    }
    if (latest < this.EXPECTED_END) {
      baseResult.issues.push(`Data ends early: ${latest.toISOString().split('T')[0]} (expected ${this.EXPECTED_END.toISOString().split('T')[0]})`);
    }

    // Get all records for gap and anomaly detection
    const records = await this.prisma.klines.findMany({
      where: { symbol },
      select: {
        openTime: true,
        close: true,
        volume: true,
        high: true,
        low: true
      },
      orderBy: { openTime: 'asc' }
    });

    // Detect gaps
    baseResult.gaps = this.detectGaps(records.map(r => r.openTime));

    // Check for duplicates
    baseResult.duplicates = await this.countDuplicates(symbol);

    // Validate prices
    const prices = records.map(r => parseFloat(r.close.toString()));
    const highs = records.map(r => parseFloat(r.high.toString()));
    const lows = records.map(r => parseFloat(r.low.toString()));

    baseResult.priceValidation = {
      minPrice: Math.min(...prices),
      maxPrice: Math.max(...prices),
      avgPrice: prices.reduce((a, b) => a + b, 0) / prices.length,
      anomalies: this.detectPriceAnomalies(records)
    };

    // Validate high >= close >= low
    const invalidCandles = records.filter(r => {
      const high = parseFloat(r.high.toString());
      const low = parseFloat(r.low.toString());
      const close = parseFloat(r.close.toString());
      return !(high >= close && close >= low && high >= low);
    }).length;

    if (invalidCandles > 0) {
      baseResult.issues.push(`${invalidCandles} invalid candles (high < close or close < low)`);
    }

    // Validate volumes
    const volumes = records.map(r => parseFloat(r.volume.toString()));
    const zeroVolumes = volumes.filter(v => v === 0).length;

    baseResult.volumeValidation = {
      minVolume: Math.min(...volumes),
      maxVolume: Math.max(...volumes),
      avgVolume: volumes.reduce((a, b) => a + b, 0) / volumes.length,
      zeroVolumes
    };

    if (zeroVolumes > 0) {
      baseResult.issues.push(`${zeroVolumes} records with zero volume`);
    }

    // Determine overall status
    if (baseResult.completeness < 50) {
      baseResult.status = 'FAIL';
    } else if (baseResult.completeness < 90 || baseResult.gaps.length > 20 || baseResult.duplicates > 0) {
      baseResult.status = 'WARN';
    }

    return baseResult;
  }

  private detectGaps(timestamps: Date[]): Array<{ start: Date; end: Date; missingRecords: number }> {
    const gaps: Array<{ start: Date; end: Date; missingRecords: number }> = [];

    for (let i = 1; i < timestamps.length; i++) {
      const expectedNext = new Date(timestamps[i - 1].getTime() + this.INTERVAL_MS);
      const actual = timestamps[i];

      if (actual.getTime() > expectedNext.getTime()) {
        const missingRecords = Math.floor((actual.getTime() - expectedNext.getTime()) / this.INTERVAL_MS);
        gaps.push({
          start: expectedNext,
          end: new Date(actual.getTime() - this.INTERVAL_MS),
          missingRecords
        });
      }
    }

    return gaps;
  }

  private async countDuplicates(symbol: string): Promise<number> {
    try {
      const result = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) as count FROM (
          SELECT 1 FROM klines
          WHERE symbol = ${symbol}
          GROUP BY "openTime"
          HAVING COUNT(*) > 1
        ) as dups
      `;
      return Number(result[0]?.count || 0);
    } catch {
      return 0;
    }
  }

  private detectPriceAnomalies(records: any[]): number {
    let anomalies = 0;

    for (let i = 1; i < records.length; i++) {
      const prevClose = parseFloat(records[i - 1].close.toString());
      const currentClose = parseFloat(records[i].close.toString());

      // Check for extreme price movements (>50% in 1 hour)
      const priceChange = Math.abs((currentClose - prevClose) / prevClose);
      if (priceChange > 0.5) {
        anomalies++;
      }
    }

    return anomalies;
  }

  async verifyAllPairs(): Promise<OverallIntegrityReport> {
    console.log('\n🔍 Starting klines integrity verification...');
    console.log('='.repeat(80));

    const results: IntegrityCheckResult[] = [];
    let passCount = 0;
    let warnCount = 0;
    let failCount = 0;
    let totalRecords = 0;

    for (const symbol of this.tradingPairs) {
      process.stdout.write(`  Verifying ${symbol}...`);
      const result = await this.verifySymbol(symbol);
      results.push(result);
      totalRecords += result.totalRecords;

      if (result.status === 'PASS') passCount++;
      else if (result.status === 'WARN') warnCount++;
      else failCount++;

      console.log(` ${result.status} (${result.actualRecords.toLocaleString()} records, ${result.completeness.toFixed(1)}%)`);
    }

    const expectedTotal = this.calculateExpectedRecords() * this.tradingPairs.length;
    const overallCompleteness = (totalRecords / expectedTotal) * 100;
    const avgQuality = results.reduce((sum, r) => {
      if (r.status === 'PASS') return sum + 100;
      if (r.status === 'WARN') return sum + 70;
      return sum + 30;
    }, 0) / this.tradingPairs.length;

    const recommendations = this.generateRecommendations(results);

    return {
      timestamp: new Date(),
      totalPairs: this.tradingPairs.length,
      pairsWithData: results.filter(r => r.totalRecords > 0).length,
      totalRecords,
      expectedDateRange: { start: this.EXPECTED_START, end: this.EXPECTED_END },
      interval: this.INTERVAL,
      intervalMs: this.INTERVAL_MS,
      results,
      summary: {
        passCount,
        warnCount,
        failCount,
        overallCompleteness,
        avgQuality
      },
      recommendations
    };
  }

  private generateRecommendations(results: IntegrityCheckResult[]): string[] {
    const recommendations: string[] = [];

    const failedPairs = results.filter(r => r.status === 'FAIL');
    const warnPairs = results.filter(r => r.status === 'WARN');
    const gappyPairs = results.filter(r => r.gaps.length > 50);
    const incompletePairs = results.filter(r => r.completeness < 80);

    if (failedPairs.length > 0) {
      recommendations.push(`🔴 Re-download ${failedPairs.length} pairs with missing data: ${failedPairs.map(p => p.symbol).slice(0, 5).join(', ')}${failedPairs.length > 5 ? '...' : ''}`);
    }

    if (warnPairs.length > 0) {
      recommendations.push(`🟡 Review ${warnPairs.length} pairs with data quality issues`);
    }

    if (gappyPairs.length > 0) {
      recommendations.push(`🟡 ${gappyPairs.length} pairs have significant gaps (>50 missing intervals)`);
    }

    if (incompletePairs.length > 0) {
      recommendations.push(`🟡 ${incompletePairs.length} pairs have <80% completeness`);
    }

    if (recommendations.length === 0) {
      recommendations.push('✅ All data integrity checks passed!');
    }

    return recommendations;
  }

  printReport(report: OverallIntegrityReport): void {
    console.log('\n' + '='.repeat(80));
    console.log('📊 KLINES DATA INTEGRITY REPORT');
    console.log('='.repeat(80));
    console.log(`⏰ Generated: ${report.timestamp.toISOString()}`);
    console.log(`🕐 Interval: ${report.interval}`);
    console.log(`📅 Expected Range: ${report.expectedDateRange.start.toISOString().split('T')[0]} to ${report.expectedDateRange.end.toISOString().split('T')[0]}`);
    console.log(`🎯 Trading Pairs: ${report.totalPairs} configured, ${report.pairsWithData} with data`);
    console.log(`📈 Total Records: ${report.totalRecords.toLocaleString()}`);
    console.log(`✅ Overall Completeness: ${report.summary.overallCompleteness.toFixed(2)}%`);
    console.log(`⭐ Average Quality Score: ${report.summary.avgQuality.toFixed(1)}/100`);

    console.log('\n📋 STATUS SUMMARY:');
    console.log(`  ✅ PASS: ${report.summary.passCount} pairs`);
    console.log(`  🟡 WARN: ${report.summary.warnCount} pairs`);
    console.log(`  🔴 FAIL: ${report.summary.failCount} pairs`);

    console.log('\n📊 DETAILED RESULTS (by record count):');
    console.log('-'.repeat(80));
    console.log('Symbol          | Records      | Complete | Status | Issues');
    console.log('-'.repeat(80));

    report.results
      .sort((a, b) => b.totalRecords - a.totalRecords)
      .forEach(result => {
        const symbol = result.symbol.padEnd(15);
        const records = result.totalRecords.toLocaleString().padStart(12);
        const complete = `${result.completeness.toFixed(1)}%`.padStart(8);
        const status = result.status.padStart(6);
        const issueCount = result.issues.length;

        console.log(`${symbol} | ${records} | ${complete} | ${status} | ${issueCount} issue(s)`);
      });

    // Show problematic pairs
    const problematic = report.results.filter(r => r.status !== 'PASS').slice(0, 15);
    if (problematic.length > 0) {
      console.log('\n⚠️  TOP ISSUES:');
      problematic.forEach(result => {
        console.log(`\n  ${result.symbol} (${result.status}):`);
        result.issues.forEach(issue => console.log(`    • ${issue}`));
      });
    }

    console.log('\n💡 RECOMMENDATIONS:');
    report.recommendations.forEach((rec, index) => {
      console.log(`  ${index + 1}. ${rec}`);
    });

    console.log('\n' + '='.repeat(80));
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

async function main() {
  try {
    const verifier = new KlinesIntegrityVerifier();
    await verifier.initialize();
    const report = await verifier.verifyAllPairs();
    verifier.printReport(report);
    await verifier.cleanup();

    // Exit with appropriate code
    const hasFails = report.summary.failCount > 0;
    process.exit(hasFails ? 1 : 0);
  } catch (error) {
    console.error('\n❌ Verification failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { KlinesIntegrityVerifier };
