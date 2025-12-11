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
    statisticalAnalysis: {
      ratingRange: { min: number; max: number; mean: number; stdDev: number };
      rdRange: { min: number; max: number; mean: number; stdDev: number };
      volatilityRange: { min: number; max: number; mean: number; stdDev: number };
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
    const report: ValidationReport = {
      timestamp: startTime,
      totalRecords: 0,
      symbolsAnalyzed: 0,
      results: {
        dataTyepValidation: { passed: true, issues: [] },
        rangeValidation: { passed: true, issues: [] },
        consistencyChecks: { passed: true, issues: [] },
        statisticalAnalysis: {
          ratingRange: { min: 0, max: 0, mean: 0, stdDev: 0 },
          rdRange: { min: 0, max: 0, mean: 0, stdDev: 0 },
          volatilityRange: { min: 0, max: 0, mean: 0, stdDev: 0 },
        },
        anomalies: { detected: false, details: [] },
      },
      overallStatus: 'PASS',
      summary: '',
    };

    console.log('🔍 Starting Glicko Rating Integrity Validation...\n');

    try {
      // 1. Fetch all glicko ratings
      console.log('📊 Loading glicko ratings from database...');
      const ratings = await this.prisma.glickoRatings.findMany({
        orderBy: [{ symbol: 'asc' }, { timestamp: 'asc' }],
      });

      report.totalRecords = ratings.length;
      const symbols = [...new Set(ratings.map(r => r.symbol))];
      report.symbolsAnalyzed = symbols.length;

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

      // 5. Statistical Analysis
      console.log('📈 Analyzing statistics...');
      report.results.statisticalAnalysis = this.analyzeStatistics(convertedRatings);

      // 6. Anomaly Detection
      console.log('⚠️  Detecting anomalies...');
      report.results.anomalies = this.detectAnomalies(convertedRatings);

      // Determine overall status
      if (
        !report.results.dataTyepValidation.passed ||
        !report.results.rangeValidation.passed ||
        !report.results.consistencyChecks.passed ||
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

  private generateSummary(report: ValidationReport): string {
    const parts: string[] = [];

    parts.push(`Total Records: ${report.totalRecords}`);
    parts.push(`Symbols: ${report.symbolsAnalyzed}`);

    if (report.results.dataTyepValidation.issues.length === 0) {
      parts.push('✅ Data Types: VALID');
    } else {
      parts.push(
        `⚠️  Data Types: ${report.results.dataTyepValidation.issues.length} issues`
      );
    }

    if (report.results.rangeValidation.issues.length === 0) {
      parts.push('✅ Value Ranges: VALID');
    } else {
      parts.push(
        `⚠️  Value Ranges: ${report.results.rangeValidation.issues.length} issues`
      );
    }

    if (report.results.consistencyChecks.issues.length === 0) {
      parts.push('✅ Consistency: VALID');
    } else {
      parts.push(
        `⚠️  Consistency: ${report.results.consistencyChecks.issues.length} issues`
      );
    }

    parts.push(`Rating: ${report.results.statisticalAnalysis.ratingRange.min.toFixed(0)}-${report.results.statisticalAnalysis.ratingRange.max.toFixed(0)} (μ=${report.results.statisticalAnalysis.ratingRange.mean.toFixed(0)})`);
    parts.push(`RD: ${report.results.statisticalAnalysis.rdRange.min.toFixed(0)}-${report.results.statisticalAnalysis.rdRange.max.toFixed(0)} (μ=${report.results.statisticalAnalysis.rdRange.mean.toFixed(0)})`);
    parts.push(`Volatility: ${report.results.statisticalAnalysis.volatilityRange.min.toFixed(4)}-${report.results.statisticalAnalysis.volatilityRange.max.toFixed(4)} (μ=${report.results.statisticalAnalysis.volatilityRange.mean.toFixed(4)})`);

    if (report.results.anomalies.detected) {
      parts.push(`⚠️  Anomalies: ${report.results.anomalies.details.length} detected`);
    } else {
      parts.push('✅ Anomalies: None detected');
    }

    return parts.join('\n');
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
