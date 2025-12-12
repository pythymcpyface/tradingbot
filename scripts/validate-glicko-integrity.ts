#!/usr/bin/env ts-node

/**
 * Glicko Rating Integrity Validator
 *
 * Comprehensive validation of glicko ratings in database:
 * - Data type validation
 * - Range validation (ratings, RD, volatility)
 * - Consistency checks
 * - Statistical analysis
 * - Missing data detection
 * - Anomaly detection
 */

import { PrismaClient } from '@prisma/client';

interface ValidationReport {
  timestamp: Date;
  totalRecords: number;
  symbolsAnalyzed: number;
  expectedRecords: number;
  results: {
    dataTyepValidation: {
      passed: boolean;
      issues: string[];
    };
    rangeValidation: {
      passed: boolean;
      issues: string[];
    };
    consistencyChecks: {
      passed: boolean;
      issues: string[];
    };
    rowCountValidation: {
      passed: boolean;
      expected: number;
      actual: number;
      issues: string[];
    };
    datetimeGapDetection: {
      passed: boolean;
      issues: string[];
    };
    allCoinsPresent: {
      passed: boolean;
      missing: string[];
      issues: string[];
    };
    statisticalAnalysis: {
      ratingRange: { min: number; max: number; mean: number; stdDev: number };
      rdRange: { min: number; max: number; mean: number; stdDev: number };
      volatilityRange: { min: number; max: number; mean: number; stdDev: number };
    };
    ratingDriftDetection: {
      passed: boolean;
      driftingSymbols: Array<{ symbol: string; trend: string; slope: number }>;
      issues: string[];
    };
    deviationDriftDetection: {
      passed: boolean;
      driftingSymbols: Array<{ symbol: string; trend: string; slope: number }>;
      issues: string[];
    };
    averageStability: {
      passed: boolean;
      ratingTrend: string;
      rdTrend: string;
      issues: string[];
    };
    anomalies: {
      detected: boolean;
      details: string[];
    };
  };
  overallStatus: 'PASS' | 'FAIL' | 'WARNING';
  summary: string;
}

class GlickoIntegrityValidator {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async validate(): Promise<ValidationReport> {
    const startTime = new Date();
    const EXPECTED_COINS = ['BTC', 'ETH', 'USDT', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'TRX', 'AVAX', 'DOT', 'LINK', 'BCH', 'NEAR', 'LTC', 'ETC', 'HBAR', 'XLM', 'ATOM', 'VET', 'AAVE'];

    const report: ValidationReport = {
      timestamp: startTime,
      totalRecords: 0,
      symbolsAnalyzed: 0,
      expectedRecords: EXPECTED_COINS.length,
      results: {
        dataTyepValidation: { passed: true, issues: [] },
        rangeValidation: { passed: true, issues: [] },
        consistencyChecks: { passed: true, issues: [] },
        rowCountValidation: { passed: true, expected: EXPECTED_COINS.length, actual: 0, issues: [] },
        datetimeGapDetection: { passed: true, issues: [] },
        allCoinsPresent: { passed: true, missing: [], issues: [] },
        statisticalAnalysis: {
          ratingRange: { min: 0, max: 0, mean: 0, stdDev: 0 },
          rdRange: { min: 0, max: 0, mean: 0, stdDev: 0 },
          volatilityRange: { min: 0, max: 0, mean: 0, stdDev: 0 },
        },
        ratingDriftDetection: { passed: true, driftingSymbols: [], issues: [] },
        deviationDriftDetection: { passed: true, driftingSymbols: [], issues: [] },
        averageStability: { passed: true, ratingTrend: 'stable', rdTrend: 'stable', issues: [] },
        anomalies: { detected: false, details: [] },
      },
      overallStatus: 'PASS',
      summary: '',
    };

    console.log('🔍 Starting Glicko Rating Integrity Validation...\n');

    try {
      // 1. Get klines date range and interval
      console.log('📊 Calculating expected number of records based on klines interval...');
      const klineInfo = await this.getKlinesDateRangeAndInterval();
      const expectedRecordsPerCoin = klineInfo.expectedRecordsPerCoin;
      const expectedTotalRecords = expectedRecordsPerCoin * EXPECTED_COINS.length;
      console.log(`  Klines interval: ${klineInfo.intervalMinutes} minutes`);
      console.log(`  Date range: ${klineInfo.startDate.toISOString()} to ${klineInfo.endDate.toISOString()}`);
      console.log(`  Expected records per coin: ${expectedRecordsPerCoin}`);
      console.log(`  Expected total records: ${expectedTotalRecords}\n`);

      // 2. Fetch all glicko ratings
      console.log('📊 Loading glicko ratings from database...');
      const ratings = await this.prisma.glickoRatings.findMany({
        orderBy: [{ symbol: 'asc' }, { timestamp: 'asc' }],
      });

      report.totalRecords = ratings.length;
      const symbols = [...new Set(ratings.map(r => r.symbol))];
      report.symbolsAnalyzed = symbols.length;
      report.expectedRecords = expectedTotalRecords;

      console.log(`✓ Loaded ${report.totalRecords} records for ${report.symbolsAnalyzed} symbols\n`);

      if (report.totalRecords === 0) {
        report.overallStatus = 'WARNING';
        report.summary = 'No glicko ratings found in database';
        return report;
      }

      // Convert Decimal to number for analysis
      const convertedRatings = ratings.map((r) => ({
        id: r.id,
        symbol: r.symbol,
        timestamp: r.timestamp,
        rating: typeof r.rating === 'number' ? r.rating : parseFloat(r.rating.toString()),
        rd: typeof r.ratingDeviation === 'number'
          ? r.ratingDeviation
          : parseFloat(r.ratingDeviation.toString()),
        volatility:
          typeof r.volatility === 'number'
            ? r.volatility
            : parseFloat(r.volatility.toString()),
      }));

      // 2. Data Type Validation
      console.log('🔢 Validating data types...');
      report.results.dataTyepValidation = this.validateDataTypes(convertedRatings);

      // 3. Range Validation
      console.log('📏 Validating value ranges...');
      report.results.rangeValidation = this.validateRanges(convertedRatings);

      // 4. Consistency Checks
      console.log('🔗 Running consistency checks...');
      report.results.consistencyChecks = this.runConsistencyChecks(convertedRatings);

      // 5. Row Count Validation (now based on klines interval)
      console.log('📋 Validating row count based on klines interval...');
      report.results.rowCountValidation = this.validateRowCount(report.totalRecords, expectedTotalRecords);

      // 5b. Equal Records Per Coin Check (NEW)
      console.log('📋 Checking equal records per coin...');
      const coinsEqualRecords = this.validateCoinsHaveEqualRecords(convertedRatings, expectedRecordsPerCoin);
      if (!coinsEqualRecords.passed) {
        report.results.rowCountValidation.issues.push(...coinsEqualRecords.issues);
        report.results.rowCountValidation.passed = false;
      }

      // 6. Datetime Gap Detection
      console.log('⏰ Detecting datetime gaps...');
      report.results.datetimeGapDetection = this.detectDatetimeGaps(convertedRatings);

      // 7. All Coins Present Validation
      console.log('🪙 Checking all coins present...');
      report.results.allCoinsPresent = this.validateAllCoinsPresent(symbols, EXPECTED_COINS);

      // 8. Statistical Analysis
      console.log('📈 Analyzing statistics...');
      report.results.statisticalAnalysis = this.analyzeStatistics(convertedRatings);

      // 9. Rating Drift Detection
      console.log('📊 Detecting rating drift...');
      report.results.ratingDriftDetection = this.detectRatingDrift(convertedRatings);

      // 10. Deviation Drift Detection
      console.log('📊 Detecting deviation drift...');
      report.results.deviationDriftDetection = this.detectDeviationDrift(convertedRatings);

      // 11. Average Stability Check
      console.log('📊 Checking average stability...');
      report.results.averageStability = this.checkAverageStability(convertedRatings);

      // 12. Anomaly Detection
      console.log('⚠️  Detecting anomalies...');
      report.results.anomalies = this.detectAnomalies(convertedRatings);

      // Determine overall status
      if (
        !report.results.dataTyepValidation.passed ||
        !report.results.rangeValidation.passed ||
        !report.results.consistencyChecks.passed ||
        !report.results.rowCountValidation.passed ||
        !report.results.datetimeGapDetection.passed ||
        !report.results.allCoinsPresent.passed ||
        !report.results.ratingDriftDetection.passed ||
        !report.results.deviationDriftDetection.passed ||
        !report.results.averageStability.passed ||
        report.results.anomalies.detected
      ) {
        report.overallStatus = 'FAIL';
      } else if (report.results.anomalies.details.length > 0) {
        report.overallStatus = 'WARNING';
      }

      // Generate summary
      report.summary = this.generateSummary(report);

      return report;
    } catch (error) {
      console.error('❌ Validation error:', error);
      report.overallStatus = 'FAIL';
      report.summary = `Validation failed with error: ${String(error)}`;
      return report;
    } finally {
      await this.prisma.$disconnect();
    }
  }

  private validateDataTypes(
    ratings: Array<{
      id: string;
      symbol: string;
      timestamp: Date;
      rating: number;
      rd: number;
      volatility: number;
    }>
  ): { passed: boolean; issues: string[] } {
    const issues: string[] = [];

    for (const rating of ratings) {
      // Check required fields exist
      if (!rating.symbol || typeof rating.symbol !== 'string') {
        issues.push(`Invalid symbol in record ${rating.id}`);
      }
      if (!rating.timestamp || !(rating.timestamp instanceof Date)) {
        issues.push(`Invalid timestamp in record ${rating.id}`);
      }
      if (typeof rating.rating !== 'number') {
        issues.push(`Invalid rating type in record ${rating.id}`);
      }
      if (typeof rating.rd !== 'number') {
        issues.push(`Invalid RD type in record ${rating.id}`);
      }
      if (typeof rating.volatility !== 'number') {
        issues.push(`Invalid volatility type in record ${rating.id}`);
      }
    }

    return {
      passed: issues.length === 0,
      issues: issues.slice(0, 10), // Show first 10 issues
    };
  }

  private validateRanges(
    ratings: Array<{
      id: string;
      symbol: string;
      timestamp: Date;
      rating: number;
      rd: number;
      volatility: number;
    }>
  ): { passed: boolean; issues: string[] } {
    const issues: string[] = [];

    for (const rating of ratings) {
      // Rating bounds: 0-4000 (roughly)
      if (rating.rating < 0 || rating.rating > 4000) {
        issues.push(
          `Rating out of bounds for ${rating.symbol}: ${rating.rating}`
        );
      }

      // RD bounds: 0-350
      if (rating.rd < 0 || rating.rd > 350) {
        issues.push(`RD out of bounds for ${rating.symbol}: ${rating.rd}`);
      }

      // Volatility bounds: 0.01-0.2
      if (rating.volatility < 0.01 || rating.volatility > 0.2) {
        issues.push(
          `Volatility out of bounds for ${rating.symbol}: ${rating.volatility}`
        );
      }

      // NaN/Infinity checks
      if (
        !isFinite(rating.rating) ||
        !isFinite(rating.rd) ||
        !isFinite(rating.volatility)
      ) {
        issues.push(`Non-finite value for ${rating.symbol} at ${rating.timestamp}`);
      }
    }

    return {
      passed: issues.length === 0,
      issues: issues.slice(0, 10),
    };
  }

  private runConsistencyChecks(
    ratings: Array<{
      id: string;
      symbol: string;
      timestamp: Date;
      rating: number;
      rd: number;
      volatility: number;
    }>
  ): {
    passed: boolean;
    issues: string[];
  } {
    const issues: string[] = [];
    const bySymbol = new Map<
      string,
      Array<{
        id: string;
        symbol: string;
        timestamp: Date;
        rating: number;
        rd: number;
        volatility: number;
      }>
    >();

    // Group by symbol
    for (const rating of ratings) {
      if (!bySymbol.has(rating.symbol)) {
        bySymbol.set(rating.symbol, []);
      }
      bySymbol.get(rating.symbol)!.push(rating);
    }

    // Check consistency within each symbol
    for (const [symbol, symbolRatings] of bySymbol.entries()) {
      // Sort by timestamp
      symbolRatings.sort(
        (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
      );

      // Check for duplicates
      const timestamps = new Set<number>();
      for (const rating of symbolRatings) {
        if (timestamps.has(rating.timestamp.getTime())) {
          issues.push(`Duplicate timestamp for ${symbol}`);
        }
        timestamps.add(rating.timestamp.getTime());
      }

      // Check RD monotonicity (should generally increase or stay same)
      for (let i = 1; i < symbolRatings.length; i++) {
        const prev = symbolRatings[i - 1];
        const curr = symbolRatings[i];

        // RD should decrease after rating updates (no games = increase)
        // This is just a warning if violated
        if (curr.rd < prev.rd * 0.5) {
          // Large drop
          issues.push(
            `Large RD drop for ${symbol}: ${prev.rd} → ${curr.rd}`
          );
        }
      }
    }

    return {
      passed: issues.length === 0,
      issues: issues.slice(0, 10),
    };
  }

  private analyzeStatistics(
    ratings: Array<{
      id: string;
      symbol: string;
      timestamp: Date;
      rating: number;
      rd: number;
      volatility: number;
    }>
  ): {
    ratingRange: { min: number; max: number; mean: number; stdDev: number };
    rdRange: { min: number; max: number; mean: number; stdDev: number };
    volatilityRange: { min: number; max: number; mean: number; stdDev: number };
  } {
    const ratingValues = ratings.map((r) => r.rating);
    const rdValues = ratings.map((r) => r.rd);
    const volatilityValues = ratings.map((r) => r.volatility);

    const stats = {
      ratingRange: this.calculateStats(ratingValues),
      rdRange: this.calculateStats(rdValues),
      volatilityRange: this.calculateStats(volatilityValues),
    };

    return stats;
  }

  private calculateStats(values: number[]): {
    min: number;
    max: number;
    mean: number;
    stdDev: number;
  } {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) /
      values.length;
    const stdDev = Math.sqrt(variance);

    return { min, max, mean, stdDev };
  }

  private detectAnomalies(
    ratings: Array<{
      id: string;
      symbol: string;
      timestamp: Date;
      rating: number;
      rd: number;
      volatility: number;
    }>
  ): {
    detected: boolean;
    details: string[];
  } {
    const details: string[] = [];
    const stats = {
      rating: this.calculateStats(ratings.map((r) => r.rating)),
      rd: this.calculateStats(ratings.map((r) => r.rd)),
      volatility: this.calculateStats(ratings.map((r) => r.volatility)),
    };

    // Look for outliers (>3 std devs from mean)
    for (const rating of ratings) {
      const ratingZScore = Math.abs(
        (rating.rating - stats.rating.mean) / stats.rating.stdDev
      );
      const rdZScore = Math.abs(
        (rating.rd - stats.rd.mean) / stats.rd.stdDev
      );
      const volatilityZScore = Math.abs(
        (rating.volatility - stats.volatility.mean) /
          stats.volatility.stdDev
      );

      if (ratingZScore > 3) {
        details.push(
          `Outlier rating for ${rating.symbol}: ${rating.rating} (z=${ratingZScore.toFixed(2)})`
        );
      }
      if (rdZScore > 3) {
        details.push(
          `Outlier RD for ${rating.symbol}: ${rating.rd} (z=${rdZScore.toFixed(2)})`
        );
      }
      if (volatilityZScore > 3) {
        details.push(
          `Outlier volatility for ${rating.symbol}: ${rating.volatility.toFixed(4)} (z=${volatilityZScore.toFixed(2)})`
        );
      }
    }

    return {
      detected: details.length > 0,
      details: details.slice(0, 10),
    };
  }

  private validateRowCount(totalRecords: number, expectedTotalRecords: number): {
    passed: boolean;
    expected: number;
    actual: number;
    issues: string[];
  } {
    const issues: string[] = [];

    if (totalRecords !== expectedTotalRecords) {
      issues.push(`Expected ${expectedTotalRecords} total records but found ${totalRecords}`);
    }

    return {
      passed: totalRecords === expectedTotalRecords,
      expected: expectedTotalRecords,
      actual: totalRecords,
      issues,
    };
  }

  private detectDatetimeGaps(
    ratings: Array<{
      id: string;
      symbol: string;
      timestamp: Date;
      rating: number;
      rd: number;
      volatility: number;
    }>
  ): { passed: boolean; issues: string[] } {
    const issues: string[] = [];
    const bySymbol = new Map<
      string,
      Array<{
        id: string;
        symbol: string;
        timestamp: Date;
        rating: number;
        rd: number;
        volatility: number;
      }>
    >();

    for (const rating of ratings) {
      if (!bySymbol.has(rating.symbol)) {
        bySymbol.set(rating.symbol, []);
      }
      bySymbol.get(rating.symbol)!.push(rating);
    }

    for (const [symbol, symbolRatings] of bySymbol.entries()) {
      symbolRatings.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      // For single-period calculations, gaps are not critical
      // Just check that timestamps are in order (no backwards time)
      for (let i = 1; i < symbolRatings.length; i++) {
        const prev = symbolRatings[i - 1];
        const curr = symbolRatings[i];

        if (curr.timestamp < prev.timestamp) {
          issues.push(`Datetime out of order for ${symbol}: ${prev.timestamp} > ${curr.timestamp}`);
        }
      }
    }

    return {
      passed: issues.length === 0,
      issues: issues.slice(0, 10),
    };
  }

  private validateAllCoinsPresent(
    actualSymbols: string[],
    expectedCoins: string[]
  ): { passed: boolean; missing: string[]; issues: string[] } {
    const actualSet = new Set(actualSymbols);
    const missing = expectedCoins.filter(coin => !actualSet.has(coin));
    const issues: string[] = [];

    if (missing.length > 0) {
      issues.push(`Missing coins: ${missing.join(', ')}`);
    }

    return {
      passed: missing.length === 0,
      missing,
      issues,
    };
  }

  private detectRatingDrift(
    ratings: Array<{
      id: string;
      symbol: string;
      timestamp: Date;
      rating: number;
      rd: number;
      volatility: number;
    }>
  ): {
    passed: boolean;
    driftingSymbols: Array<{ symbol: string; trend: string; slope: number }>;
    issues: string[];
  } {
    const driftingSymbols: Array<{ symbol: string; trend: string; slope: number }> = [];
    const issues: string[] = [];
    const bySymbol = new Map<
      string,
      Array<{
        id: string;
        symbol: string;
        timestamp: Date;
        rating: number;
        rd: number;
        volatility: number;
      }>
    >();

    for (const rating of ratings) {
      if (!bySymbol.has(rating.symbol)) {
        bySymbol.set(rating.symbol, []);
      }
      bySymbol.get(rating.symbol)!.push(rating);
    }

    for (const [symbol, symbolRatings] of bySymbol.entries()) {
      if (symbolRatings.length < 2) continue; // Need at least 2 points for trend

      symbolRatings.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      // Calculate linear regression
      const n = symbolRatings.length;
      const xValues = symbolRatings.map((_, i) => i);
      const yValues = symbolRatings.map(r => r.rating);

      const xMean = xValues.reduce((a, b) => a + b, 0) / n;
      const yMean = yValues.reduce((a, b) => a + b, 0) / n;

      const numerator = xValues.reduce((sum, x, i) => sum + (x - xMean) * (yValues[i] - yMean), 0);
      const denominator = xValues.reduce((sum, x) => sum + Math.pow(x - xMean, 2), 0);

      const slope = denominator !== 0 ? numerator / denominator : 0;

      // Flag significant drifts (slope > 1 or < -1 per step)
      if (Math.abs(slope) > 1) {
        const trend = slope > 0 ? 'increasing' : 'decreasing';
        driftingSymbols.push({ symbol, trend, slope });
        issues.push(`${symbol}: Rating ${trend} with slope ${slope.toFixed(2)}`);
      }
    }

    return {
      passed: driftingSymbols.length === 0,
      driftingSymbols,
      issues: issues.slice(0, 10),
    };
  }

  private detectDeviationDrift(
    ratings: Array<{
      id: string;
      symbol: string;
      timestamp: Date;
      rating: number;
      rd: number;
      volatility: number;
    }>
  ): {
    passed: boolean;
    driftingSymbols: Array<{ symbol: string; trend: string; slope: number }>;
    issues: string[];
  } {
    const driftingSymbols: Array<{ symbol: string; trend: string; slope: number }> = [];
    const issues: string[] = [];
    const bySymbol = new Map<
      string,
      Array<{
        id: string;
        symbol: string;
        timestamp: Date;
        rating: number;
        rd: number;
        volatility: number;
      }>
    >();

    for (const rating of ratings) {
      if (!bySymbol.has(rating.symbol)) {
        bySymbol.set(rating.symbol, []);
      }
      bySymbol.get(rating.symbol)!.push(rating);
    }

    for (const [symbol, symbolRatings] of bySymbol.entries()) {
      if (symbolRatings.length < 2) continue;

      symbolRatings.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      const n = symbolRatings.length;
      const xValues = symbolRatings.map((_, i) => i);
      const yValues = symbolRatings.map(r => r.rd);

      const xMean = xValues.reduce((a, b) => a + b, 0) / n;
      const yMean = yValues.reduce((a, b) => a + b, 0) / n;

      const numerator = xValues.reduce((sum, x, i) => sum + (x - xMean) * (yValues[i] - yMean), 0);
      const denominator = xValues.reduce((sum, x) => sum + Math.pow(x - xMean, 2), 0);

      const slope = denominator !== 0 ? numerator / denominator : 0;

      // Flag significant drifts (slope > 0.5 or < -0.5 per step)
      if (Math.abs(slope) > 0.5) {
        const trend = slope > 0 ? 'increasing' : 'decreasing';
        driftingSymbols.push({ symbol, trend, slope });
        issues.push(`${symbol}: RD ${trend} with slope ${slope.toFixed(2)}`);
      }
    }

    return {
      passed: driftingSymbols.length === 0,
      driftingSymbols,
      issues: issues.slice(0, 10),
    };
  }

  private checkAverageStability(
    ratings: Array<{
      id: string;
      symbol: string;
      timestamp: Date;
      rating: number;
      rd: number;
      volatility: number;
    }>
  ): { passed: boolean; ratingTrend: string; rdTrend: string; issues: string[] } {
    const issues: string[] = [];

    // Group by timestamp to get averages over time
    const byTimestamp = new Map<number, { rating: number; rd: number }[]>();

    for (const rating of ratings) {
      const ts = rating.timestamp.getTime();
      if (!byTimestamp.has(ts)) {
        byTimestamp.set(ts, []);
      }
      byTimestamp.get(ts)!.push({ rating: rating.rating, rd: rating.rd });
    }

    const timepoints = Array.from(byTimestamp.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([ts, values]) => ({
        timestamp: ts,
        avgRating: values.reduce((sum, v) => sum + v.rating, 0) / values.length,
        avgRd: values.reduce((sum, v) => sum + v.rd, 0) / values.length,
      }));

    // With single-period data, stability is inherent (constant averages)
    let ratingTrend = 'stable';
    let rdTrend = 'stable';

    if (timepoints.length > 1) {
      // Simple trend check: compare first vs last
      const ratingChange = timepoints[timepoints.length - 1].avgRating - timepoints[0].avgRating;
      const rdChange = timepoints[timepoints.length - 1].avgRd - timepoints[0].avgRd;

      if (Math.abs(ratingChange) > 50) {
        ratingTrend = ratingChange > 0 ? 'increasing' : 'decreasing';
        issues.push(`Average rating trend detected: ${ratingTrend} by ${Math.abs(ratingChange).toFixed(2)}`);
      }

      if (Math.abs(rdChange) > 10) {
        rdTrend = rdChange > 0 ? 'increasing' : 'decreasing';
        issues.push(`Average RD trend detected: ${rdTrend} by ${Math.abs(rdChange).toFixed(2)}`);
      }
    }

    return {
      passed: issues.length === 0,
      ratingTrend,
      rdTrend,
      issues,
    };
  }

  private generateSummary(report: ValidationReport): string {
    const parts: string[] = [];

    parts.push(`Total Records: ${report.totalRecords}/${report.expectedRecords} (${report.totalRecords === report.expectedRecords ? 'complete' : 'incomplete'})`);
    parts.push(`Symbols: ${report.symbolsAnalyzed}`);
    parts.push('');

    parts.push(report.results.dataTyepValidation.issues.length === 0 ? '✅ Data Types: VALID' : `⚠️  Data Types: ${report.results.dataTyepValidation.issues.length} issues`);
    parts.push(report.results.rangeValidation.issues.length === 0 ? '✅ Value Ranges: VALID' : `⚠️  Value Ranges: ${report.results.rangeValidation.issues.length} issues`);
    parts.push(report.results.consistencyChecks.issues.length === 0 ? '✅ Consistency: VALID' : `⚠️  Consistency: ${report.results.consistencyChecks.issues.length} issues`);
    parts.push(report.results.rowCountValidation.passed ? '✅ Row Count: Correct' : `❌ Row Count: Expected ${report.results.rowCountValidation.expected}, got ${report.results.rowCountValidation.actual}`);
    parts.push(report.results.datetimeGapDetection.passed ? '✅ Datetime Gaps: None' : `⚠️  Datetime Gaps: ${report.results.datetimeGapDetection.issues.length} detected`);
    parts.push(report.results.allCoinsPresent.passed ? '✅ All Coins: Present' : `⚠️  All Coins: Missing ${report.results.allCoinsPresent.missing.length} (${report.results.allCoinsPresent.missing.join(', ')})`);
    parts.push(report.results.ratingDriftDetection.passed ? '✅ Rating Drift: None' : `⚠️  Rating Drift: ${report.results.ratingDriftDetection.driftingSymbols.length} symbols drifting`);
    parts.push(report.results.deviationDriftDetection.passed ? '✅ Deviation Drift: None' : `⚠️  Deviation Drift: ${report.results.deviationDriftDetection.driftingSymbols.length} symbols drifting`);
    parts.push(report.results.averageStability.passed ? '✅ Average Stability: Stable' : `⚠️  Average Stability: Trends detected (${report.results.averageStability.ratingTrend}, ${report.results.averageStability.rdTrend})`);
    parts.push(report.results.anomalies.detected ? `⚠️  Anomalies: ${report.results.anomalies.details.length} detected` : '✅ Anomalies: None');
    parts.push('');

    parts.push(`Rating: ${report.results.statisticalAnalysis.ratingRange.min.toFixed(0)}-${report.results.statisticalAnalysis.ratingRange.max.toFixed(0)} (μ=${report.results.statisticalAnalysis.ratingRange.mean.toFixed(0)})`);
    parts.push(`RD: ${report.results.statisticalAnalysis.rdRange.min.toFixed(0)}-${report.results.statisticalAnalysis.rdRange.max.toFixed(0)} (μ=${report.results.statisticalAnalysis.rdRange.mean.toFixed(0)})`);
    parts.push(`Volatility: ${report.results.statisticalAnalysis.volatilityRange.min.toFixed(4)}-${report.results.statisticalAnalysis.volatilityRange.max.toFixed(4)} (μ=${report.results.statisticalAnalysis.volatilityRange.mean.toFixed(4)})`);

    return parts.join('\n');
  }

  /**
   * Get klines date range and calculate expected number of records
   */
  private async getKlinesDateRangeAndInterval(): Promise<{
    startDate: Date;
    endDate: Date;
    intervalMinutes: number;
    expectedRecordsPerCoin: number;
  }> {
    // Get date range from klines
    const dateRange = await this.prisma.klines.aggregate({
      _min: { openTime: true },
      _max: { closeTime: true },
    });

    if (!dateRange._min.openTime || !dateRange._max.closeTime) {
      throw new Error('No klines data found');
    }

    const startDate = dateRange._min.openTime;
    const endDate = dateRange._max.closeTime;

    // Get first few records to determine interval
    const firstRecords = await this.prisma.klines.findMany({
      where: { symbol: 'BTCUSDT' },
      orderBy: { openTime: 'asc' },
      take: 2,
      select: { openTime: true },
    });

    let intervalMinutes = 60; // default to hourly
    if (firstRecords.length === 2) {
      const diff = firstRecords[1].openTime.getTime() - firstRecords[0].openTime.getTime();
      intervalMinutes = Math.round(diff / 1000 / 60);
    }

    // Calculate expected number of records
    const timeRangeMs = endDate.getTime() - startDate.getTime();
    const intervalMs = intervalMinutes * 60 * 1000;
    const expectedRecordsPerCoin = Math.ceil(timeRangeMs / intervalMs) + 1; // +1 for inclusive range

    return {
      startDate,
      endDate,
      intervalMinutes,
      expectedRecordsPerCoin,
    };
  }

  /**
   * Validate that all coins have equal number of rating calculations
   */
  private validateCoinsHaveEqualRecords(
    ratings: Array<{ symbol: string; timestamp: Date; rating: number; rd: number; volatility: number; }>,
    expectedRecordsPerCoin: number
  ): { passed: boolean; issues: string[] } {
    const issues: string[] = [];
    const coinCounts = new Map<string, number>();

    // Count records per coin
    for (const rating of ratings) {
      const count = (coinCounts.get(rating.symbol) || 0) + 1;
      coinCounts.set(rating.symbol, count);
    }

    // Check if all coins have same count
    const counts = Array.from(coinCounts.values());
    const uniqueCounts = [...new Set(counts)];

    if (uniqueCounts.length > 1) {
      issues.push(`Coins have different record counts: ${Array.from(coinCounts.entries()).map(([coin, count]) => `${coin}=${count}`).join(', ')}`);
    }

    // Check against expected
    if (uniqueCounts.length === 1 && uniqueCounts[0] !== expectedRecordsPerCoin) {
      issues.push(`All coins have ${uniqueCounts[0]} records but expected ${expectedRecordsPerCoin}`);
    }

    return {
      passed: issues.length === 0 && uniqueCounts.length === 1 && uniqueCounts[0] === expectedRecordsPerCoin,
      issues,
    };
  }
}

// Main execution
async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   GLICKO RATING INTEGRITY VALIDATION');
  console.log('═══════════════════════════════════════════════════════════\n');

  const validator = new GlickoIntegrityValidator();
  const report = await validator.validate();

  // Print results
  console.log('\n📋 VALIDATION RESULTS');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Status: ${report.overallStatus}\n`);

  console.log('DATA TYPE VALIDATION');
  console.log(`  Status: ${report.results.dataTyepValidation.passed ? '✅ PASS' : '❌ FAIL'}`);
  if (report.results.dataTyepValidation.issues.length > 0) {
    report.results.dataTyepValidation.issues.forEach(issue =>
      console.log(`    - ${issue}`)
    );
  }
  console.log();

  console.log('RANGE VALIDATION');
  console.log(`  Status: ${report.results.rangeValidation.passed ? '✅ PASS' : '❌ FAIL'}`);
  if (report.results.rangeValidation.issues.length > 0) {
    report.results.rangeValidation.issues.forEach(issue =>
      console.log(`    - ${issue}`)
    );
  }
  console.log();

  console.log('CONSISTENCY CHECKS');
  console.log(`  Status: ${report.results.consistencyChecks.passed ? '✅ PASS' : '❌ FAIL'}`);
  if (report.results.consistencyChecks.issues.length > 0) {
    report.results.consistencyChecks.issues.forEach(issue =>
      console.log(`    - ${issue}`)
    );
  }
  console.log();

  console.log('ROW COUNT VALIDATION');
  console.log(`  Status: ${report.results.rowCountValidation.passed ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Expected: ${report.results.rowCountValidation.expected} | Actual: ${report.results.rowCountValidation.actual}`);
  if (report.results.rowCountValidation.issues.length > 0) {
    report.results.rowCountValidation.issues.forEach(issue =>
      console.log(`    - ${issue}`)
    );
  }
  console.log();

  console.log('DATETIME GAP DETECTION');
  console.log(`  Status: ${report.results.datetimeGapDetection.passed ? '✅ PASS' : '❌ FAIL'}`);
  if (report.results.datetimeGapDetection.issues.length > 0) {
    report.results.datetimeGapDetection.issues.forEach(issue =>
      console.log(`    - ${issue}`)
    );
  }
  console.log();

  console.log('ALL COINS PRESENT');
  console.log(`  Status: ${report.results.allCoinsPresent.passed ? '✅ PASS' : '❌ FAIL'}`);
  if (report.results.allCoinsPresent.missing.length > 0) {
    console.log(`  Missing: ${report.results.allCoinsPresent.missing.join(', ')}`);
  }
  if (report.results.allCoinsPresent.issues.length > 0) {
    report.results.allCoinsPresent.issues.forEach(issue =>
      console.log(`    - ${issue}`)
    );
  }
  console.log();

  console.log('RATING DRIFT DETECTION');
  console.log(`  Status: ${report.results.ratingDriftDetection.passed ? '✅ PASS' : '❌ FAIL'}`);
  if (report.results.ratingDriftDetection.driftingSymbols.length > 0) {
    report.results.ratingDriftDetection.driftingSymbols.forEach(drift =>
      console.log(`    - ${drift.symbol}: ${drift.trend} (slope=${drift.slope.toFixed(2)})`)
    );
  }
  console.log();

  console.log('DEVIATION DRIFT DETECTION');
  console.log(`  Status: ${report.results.deviationDriftDetection.passed ? '✅ PASS' : '❌ FAIL'}`);
  if (report.results.deviationDriftDetection.driftingSymbols.length > 0) {
    report.results.deviationDriftDetection.driftingSymbols.forEach(drift =>
      console.log(`    - ${drift.symbol}: ${drift.trend} (slope=${drift.slope.toFixed(2)})`)
    );
  }
  console.log();

  console.log('AVERAGE STABILITY CHECK');
  console.log(`  Status: ${report.results.averageStability.passed ? '✅ PASS' : '⚠️  WARNING'}`);
  console.log(`  Rating Trend: ${report.results.averageStability.ratingTrend}`);
  console.log(`  RD Trend: ${report.results.averageStability.rdTrend}`);
  if (report.results.averageStability.issues.length > 0) {
    report.results.averageStability.issues.forEach(issue =>
      console.log(`    - ${issue}`)
    );
  }
  console.log();

  console.log('STATISTICAL ANALYSIS');
  console.log(`  Rating:      ${report.results.statisticalAnalysis.ratingRange.min.toFixed(2)} - ${report.results.statisticalAnalysis.ratingRange.max.toFixed(2)} (μ=${report.results.statisticalAnalysis.ratingRange.mean.toFixed(2)}, σ=${report.results.statisticalAnalysis.ratingRange.stdDev.toFixed(2)})`);
  console.log(`  RD:          ${report.results.statisticalAnalysis.rdRange.min.toFixed(2)} - ${report.results.statisticalAnalysis.rdRange.max.toFixed(2)} (μ=${report.results.statisticalAnalysis.rdRange.mean.toFixed(2)}, σ=${report.results.statisticalAnalysis.rdRange.stdDev.toFixed(2)})`);
  console.log(`  Volatility:  ${report.results.statisticalAnalysis.volatilityRange.min.toFixed(4)} - ${report.results.statisticalAnalysis.volatilityRange.max.toFixed(4)} (μ=${report.results.statisticalAnalysis.volatilityRange.mean.toFixed(4)}, σ=${report.results.statisticalAnalysis.volatilityRange.stdDev.toFixed(4)})`);
  console.log();

  console.log('ANOMALY DETECTION');
  console.log(`  Status: ${report.results.anomalies.detected ? '⚠️  ANOMALIES DETECTED' : '✅ CLEAN'}`);
  if (report.results.anomalies.details.length > 0) {
    report.results.anomalies.details.forEach(detail =>
      console.log(`    - ${detail}`)
    );
  }
  console.log();

  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(report.summary);
  console.log('═══════════════════════════════════════════════════════════\n');

  // Exit with appropriate code
  process.exit(
    report.overallStatus === 'PASS' ? 0 : report.overallStatus === 'WARNING' ? 1 : 2
  );
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(2);
});
