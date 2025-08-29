#!/usr/bin/env tsx

/**
 * Comprehensive Glicko Ratings Analysis Script
 * 
 * Provides detailed analysis of the Glicko ratings table including:
 * - Table schema and structure analysis
 * - Data volume and distribution statistics
 * - Rating value analysis (ranges, averages, distributions)
 * - Date coverage and temporal analysis
 * - Data quality issues and anomalies detection
 * - Performance metrics and trends
 * - Trading pair relationship analysis
 * - Comprehensive recommendations
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

interface ComprehensiveAnalysisReport {
  tableStructure: {
    totalRecords: number;
    uniqueSymbols: string[];
    dateRange: { earliest: Date | null; latest: Date | null; totalDays: number };
    indexes: string[];
  };
  dataDistribution: {
    recordsPerSymbol: Map<string, number>;
    averageRecordsPerSymbol: number;
    standardDeviation: number;
    coefficientOfVariation: number;
  };
  ratingAnalysis: {
    globalStats: {
      min: number; max: number; mean: number; median: number; stdDev: number;
    };
    ratingDeviationStats: {
      min: number; max: number; mean: number; median: number; stdDev: number;
    };
    volatilityStats: {
      min: number; max: number; mean: number; median: number; stdDev: number;
    };
    performanceStats: {
      min: number; max: number; mean: number; median: number; stdDev: number;
    };
    distributionAnalysis: {
      ratingQuartiles: number[];
      outliers: { rating: Array<{symbol: string, rating: number, timestamp: Date}>; };
    };
  };
  dataQuality: {
    duplicateRecords: number;
    missingData: { nullRatings: number; nullTimestamps: number; };
    temporalGaps: Map<string, number>;
    anomalousValues: {
      extremeRatings: number;
      extremeRD: number;
      extremeVolatility: number;
    };
  };
  temporalAnalysis: {
    expectedPeriods: number;
    actualPeriods: number;
    coveragePercentage: number;
    periodicityAnalysis: Map<string, { intervals: number[]; avgInterval: number; }>;
    trendAnalysis: Map<string, { startRating: number; endRating: number; change: number; }>;
  };
  tradingPairAnalysis: {
    symbolPerformance: Map<string, {
      avgRating: number;
      avgPerformance: number;
      volatility: number;
      consistency: number;
      rank: number;
    }>;
    correlationMatrix: Map<string, Map<string, number>>;
  };
  recommendations: string[];
}

class ComprehensiveGlickoAnalyzer {
  private prisma: PrismaClient;
  
  // Expected configuration from the system design
  private readonly EXPECTED_COINS = ['BTC', 'ETH', 'XRP', 'SOL', 'ADA', 'DOGE', 'POL', 'AVAX', 'LINK', 'XLM', 'BNB', 'USDT'];
  private readonly START_DATE = new Date('2021-07-19T00:00:00.000Z');
  private readonly END_DATE = new Date('2025-07-19T00:00:00.000Z');
  private readonly BATCH_SIZE_HOURS = 168; // 7 days
  
  constructor() {
    this.prisma = new PrismaClient();
  }

  async initialize(): Promise<void> {
    try {
      await this.prisma.$connect();
      console.log('✅ Connected to database for comprehensive Glicko analysis');
    } catch (error) {
      console.error('❌ Database connection failed:', error);
      throw error;
    }
  }

  /**
   * Analyze table structure and basic metadata
   */
  async analyzeTableStructure(): Promise<ComprehensiveAnalysisReport['tableStructure']> {
    console.log('🏗️  Analyzing table structure and metadata...');
    
    // Get basic counts and metadata
    const totalRecords = await this.prisma.glickoRatings.count();
    
    const uniqueSymbolsRaw = await this.prisma.glickoRatings.findMany({
      select: { symbol: true },
      distinct: ['symbol'],
      orderBy: { symbol: 'asc' }
    });
    const uniqueSymbols = uniqueSymbolsRaw.map(r => r.symbol);
    
    // Get date range
    const dateStats = await this.prisma.glickoRatings.aggregate({
      _min: { timestamp: true },
      _max: { timestamp: true }
    });
    
    const earliest = dateStats._min.timestamp;
    const latest = dateStats._max.timestamp;
    const totalDays = earliest && latest ? 
      Math.ceil((latest.getTime() - earliest.getTime()) / (1000 * 60 * 60 * 24)) : 0;
    
    // Database indexes (theoretical - would need actual DB queries to get real indexes)
    const indexes = ['symbol_timestamp_unique', 'symbol_timestamp_index', 'timestamp_index'];
    
    console.log(`   📊 Total records: ${totalRecords.toLocaleString()}`);
    console.log(`   🏷️  Unique symbols: ${uniqueSymbols.length} (${uniqueSymbols.join(', ')})`);
    console.log(`   📅 Date range: ${earliest?.toISOString().split('T')[0]} to ${latest?.toISOString().split('T')[0]}`);
    console.log(`   📈 Total days: ${totalDays}`);
    
    return {
      totalRecords,
      uniqueSymbols,
      dateRange: { earliest, latest, totalDays },
      indexes
    };
  }

  /**
   * Analyze data distribution across symbols
   */
  async analyzeDataDistribution(): Promise<ComprehensiveAnalysisReport['dataDistribution']> {
    console.log('\n📊 Analyzing data distribution across trading pairs...');
    
    const distributionRaw = await this.prisma.glickoRatings.groupBy({
      by: ['symbol'],
      _count: { symbol: true },
      orderBy: { symbol: 'asc' }
    });
    
    const recordsPerSymbol = new Map<string, number>();
    distributionRaw.forEach(item => {
      recordsPerSymbol.set(item.symbol, item._count.symbol);
    });
    
    // Calculate statistics
    const counts = Array.from(recordsPerSymbol.values());
    const averageRecordsPerSymbol = counts.reduce((sum, count) => sum + count, 0) / counts.length;
    const variance = counts.reduce((sum, count) => sum + Math.pow(count - averageRecordsPerSymbol, 2), 0) / counts.length;
    const standardDeviation = Math.sqrt(variance);
    const coefficientOfVariation = (standardDeviation / averageRecordsPerSymbol) * 100;
    
    console.log('   Distribution per symbol:');
    for (const [symbol, count] of recordsPerSymbol.entries()) {
      const percentage = ((count / averageRecordsPerSymbol - 1) * 100);
      const indicator = percentage > 10 ? '📈' : percentage < -10 ? '📉' : '➡️';
      console.log(`     ${indicator} ${symbol}: ${count.toLocaleString()} records (${percentage > 0 ? '+' : ''}${percentage.toFixed(1)}%)`);
    }
    
    console.log(`   📊 Statistics:`);
    console.log(`     Average: ${averageRecordsPerSymbol.toFixed(0)} records per symbol`);
    console.log(`     Std Dev: ${standardDeviation.toFixed(1)}`);
    console.log(`     Coefficient of Variation: ${coefficientOfVariation.toFixed(1)}%`);
    
    return {
      recordsPerSymbol,
      averageRecordsPerSymbol,
      standardDeviation,
      coefficientOfVariation
    };
  }

  /**
   * Comprehensive rating value analysis
   */
  async analyzeRatingValues(): Promise<ComprehensiveAnalysisReport['ratingAnalysis']> {
    console.log('\n🎯 Analyzing rating values and distributions...');
    
    // Get all rating data for detailed analysis
    const allRatings = await this.prisma.glickoRatings.findMany({
      select: {
        symbol: true,
        rating: true,
        ratingDeviation: true,
        volatility: true,
        performanceScore: true,
        timestamp: true
      },
      orderBy: { rating: 'asc' }
    });
    
    if (allRatings.length === 0) {
      throw new Error('No rating data found');
    }
    
    // Extract numeric arrays for statistical analysis
    const ratings = allRatings.map(r => Number(r.rating));
    const ratingDeviations = allRatings.map(r => Number(r.ratingDeviation));
    const volatilities = allRatings.map(r => Number(r.volatility));
    const performances = allRatings.map(r => Number(r.performanceScore));
    
    // Calculate comprehensive statistics
    const globalStats = this.calculateStatistics(ratings);
    const ratingDeviationStats = this.calculateStatistics(ratingDeviations);
    const volatilityStats = this.calculateStatistics(volatilities);
    const performanceStats = this.calculateStatistics(performances);
    
    // Calculate quartiles for distribution analysis
    const sortedRatings = [...ratings].sort((a, b) => a - b);
    const ratingQuartiles = [
      sortedRatings[Math.floor(sortedRatings.length * 0.25)],
      sortedRatings[Math.floor(sortedRatings.length * 0.5)],
      sortedRatings[Math.floor(sortedRatings.length * 0.75)]
    ];
    
    // Identify outliers (ratings beyond 2 standard deviations)
    const ratingOutlierThreshold = globalStats.mean + (2 * globalStats.stdDev);
    const outliers = {
      rating: allRatings
        .filter(r => Number(r.rating) > ratingOutlierThreshold || Number(r.rating) < (globalStats.mean - 2 * globalStats.stdDev))
        .map(r => ({ symbol: r.symbol, rating: Number(r.rating), timestamp: r.timestamp }))
        .slice(0, 10) // Limit to top 10 outliers
    };
    
    console.log('   📈 Rating Statistics:');
    console.log(`     Range: ${globalStats.min.toFixed(1)} - ${globalStats.max.toFixed(1)}`);
    console.log(`     Mean: ${globalStats.mean.toFixed(1)} ± ${globalStats.stdDev.toFixed(1)}`);
    console.log(`     Median: ${globalStats.median.toFixed(1)}`);
    console.log(`     Quartiles: Q1=${ratingQuartiles[0].toFixed(1)}, Q2=${ratingQuartiles[1].toFixed(1)}, Q3=${ratingQuartiles[2].toFixed(1)}`);
    
    console.log('   📊 Rating Deviation Statistics:');
    console.log(`     Range: ${ratingDeviationStats.min.toFixed(1)} - ${ratingDeviationStats.max.toFixed(1)}`);
    console.log(`     Mean: ${ratingDeviationStats.mean.toFixed(1)} ± ${ratingDeviationStats.stdDev.toFixed(1)}`);
    
    console.log('   🌊 Volatility Statistics:');
    console.log(`     Range: ${volatilityStats.min.toFixed(4)} - ${volatilityStats.max.toFixed(4)}`);
    console.log(`     Mean: ${volatilityStats.mean.toFixed(4)} ± ${volatilityStats.stdDev.toFixed(4)}`);
    
    console.log('   🏆 Performance Score Statistics:');
    console.log(`     Range: ${performanceStats.min.toFixed(2)} - ${performanceStats.max.toFixed(2)}`);
    console.log(`     Mean: ${performanceStats.mean.toFixed(2)} ± ${performanceStats.stdDev.toFixed(2)}`);
    
    if (outliers.rating.length > 0) {
      console.log('   ⚠️ Rating Outliers (beyond 2σ):');
      outliers.rating.forEach(outlier => {
        console.log(`     ${outlier.symbol}: ${outlier.rating.toFixed(1)} on ${outlier.timestamp.toISOString().split('T')[0]}`);
      });
    }
    
    return {
      globalStats,
      ratingDeviationStats,
      volatilityStats,
      performanceStats,
      distributionAnalysis: { ratingQuartiles, outliers }
    };
  }

  /**
   * Analyze data quality issues
   */
  async analyzeDataQuality(): Promise<ComprehensiveAnalysisReport['dataQuality']> {
    console.log('\n🔍 Analyzing data quality and detecting anomalies...');
    
    // Check for duplicates
    const duplicatesRaw = await this.prisma.$queryRaw<Array<{symbol: string, timestamp: Date, count: BigInt}>>`
      SELECT symbol, timestamp, COUNT(*) as count
      FROM "glicko_ratings"
      GROUP BY symbol, timestamp
      HAVING COUNT(*) > 1
    `;
    const duplicateRecords = duplicatesRaw.length;
    
    // Check for missing data
    const nullRatings = await this.prisma.glickoRatings.count({
      where: { rating: null }
    });
    const nullTimestamps = await this.prisma.glickoRatings.count({
      where: { timestamp: null }
    });
    
    // Check for anomalous values
    const extremeRatings = await this.prisma.glickoRatings.count({
      where: {
        OR: [
          { rating: { lt: 0 } },
          { rating: { gt: 5000 } }
        ]
      }
    });
    
    const extremeRD = await this.prisma.glickoRatings.count({
      where: {
        OR: [
          { ratingDeviation: { lt: 0 } },
          { ratingDeviation: { gt: 1000 } }
        ]
      }
    });
    
    const extremeVolatility = await this.prisma.glickoRatings.count({
      where: {
        OR: [
          { volatility: { lt: 0 } },
          { volatility: { gt: 5 } }
        ]
      }
    });
    
    // Analyze temporal gaps for each symbol
    const temporalGaps = new Map<string, number>();
    for (const symbol of this.EXPECTED_COINS) {
      const symbolRatings = await this.prisma.glickoRatings.findMany({
        where: { symbol },
        select: { timestamp: true },
        orderBy: { timestamp: 'asc' }
      });
      
      let gaps = 0;
      for (let i = 1; i < Math.min(symbolRatings.length, 50); i++) { // Limit to first 50 for performance
        const hoursDiff = (symbolRatings[i].timestamp.getTime() - symbolRatings[i-1].timestamp.getTime()) / (1000 * 60 * 60);
        if (hoursDiff > this.BATCH_SIZE_HOURS * 1.5) { // 50% tolerance
          gaps++;
        }
      }
      temporalGaps.set(symbol, gaps);
    }
    
    console.log('   🔧 Data Quality Assessment:');
    console.log(`     Duplicate records: ${duplicateRecords}`);
    console.log(`     Null ratings: ${nullRatings}`);
    console.log(`     Null timestamps: ${nullTimestamps}`);
    console.log(`     Extreme ratings (< 0 or > 5000): ${extremeRatings}`);
    console.log(`     Extreme rating deviations (< 0 or > 1000): ${extremeRD}`);
    console.log(`     Extreme volatilities (< 0 or > 5): ${extremeVolatility}`);
    
    console.log('   📅 Temporal Gaps Analysis:');
    for (const [symbol, gaps] of temporalGaps.entries()) {
      const status = gaps === 0 ? '✅' : gaps < 5 ? '⚠️' : '❌';
      console.log(`     ${status} ${symbol}: ${gaps} gaps detected`);
    }
    
    return {
      duplicateRecords,
      missingData: { nullRatings, nullTimestamps },
      temporalGaps,
      anomalousValues: { extremeRatings, extremeRD, extremeVolatility }
    };
  }

  /**
   * Analyze temporal patterns and trends
   */
  async analyzeTemporalPatterns(): Promise<ComprehensiveAnalysisReport['temporalAnalysis']> {
    console.log('\n📅 Analyzing temporal patterns and trends...');
    
    // Calculate expected periods
    const totalHours = (this.END_DATE.getTime() - this.START_DATE.getTime()) / (1000 * 60 * 60);
    const expectedPeriods = Math.floor(totalHours / this.BATCH_SIZE_HOURS);
    
    // Get actual periods
    const actualPeriods = await this.prisma.glickoRatings.count() / this.EXPECTED_COINS.length;
    const coveragePercentage = (actualPeriods / expectedPeriods) * 100;
    
    // Analyze periodicity for each symbol
    const periodicityAnalysis = new Map<string, { intervals: number[]; avgInterval: number; }>();
    const trendAnalysis = new Map<string, { startRating: number; endRating: number; change: number; }>();
    
    for (const symbol of this.EXPECTED_COINS.slice(0, 6)) { // Analyze first 6 symbols for performance
      const symbolRatings = await this.prisma.glickoRatings.findMany({
        where: { symbol },
        select: { timestamp: true, rating: true },
        orderBy: { timestamp: 'asc' },
        take: 20
      });
      
      if (symbolRatings.length >= 2) {
        // Calculate intervals
        const intervals: number[] = [];
        for (let i = 1; i < symbolRatings.length; i++) {
          const intervalHours = (symbolRatings[i].timestamp.getTime() - symbolRatings[i-1].timestamp.getTime()) / (1000 * 60 * 60);
          intervals.push(intervalHours);
        }
        const avgInterval = intervals.reduce((sum, val) => sum + val, 0) / intervals.length;
        periodicityAnalysis.set(symbol, { intervals, avgInterval });
        
        // Calculate trend
        const startRating = Number(symbolRatings[0].rating);
        const endRating = Number(symbolRatings[symbolRatings.length - 1].rating);
        const change = endRating - startRating;
        trendAnalysis.set(symbol, { startRating, endRating, change });
      }
    }
    
    console.log('   ⏰ Temporal Analysis Results:');
    console.log(`     Expected rating periods: ${expectedPeriods}`);
    console.log(`     Actual average periods per symbol: ${actualPeriods.toFixed(0)}`);
    console.log(`     Coverage: ${coveragePercentage.toFixed(1)}%`);
    
    console.log('   📊 Periodicity Analysis (sample):');
    for (const [symbol, analysis] of periodicityAnalysis.entries()) {
      const expectedHours = this.BATCH_SIZE_HOURS;
      const deviation = ((analysis.avgInterval - expectedHours) / expectedHours * 100);
      console.log(`     ${symbol}: avg ${analysis.avgInterval.toFixed(1)}h (${deviation > 0 ? '+' : ''}${deviation.toFixed(1)}% from expected)`);
    }
    
    console.log('   📈 Trend Analysis (sample periods):');
    for (const [symbol, trend] of trendAnalysis.entries()) {
      const direction = trend.change > 0 ? '📈' : trend.change < 0 ? '📉' : '➡️';
      console.log(`     ${direction} ${symbol}: ${trend.startRating.toFixed(1)} → ${trend.endRating.toFixed(1)} (${trend.change > 0 ? '+' : ''}${trend.change.toFixed(1)})`);
    }
    
    return {
      expectedPeriods,
      actualPeriods,
      coveragePercentage,
      periodicityAnalysis,
      trendAnalysis
    };
  }

  /**
   * Analyze trading pair performance and relationships
   */
  async analyzeTradingPairs(): Promise<ComprehensiveAnalysisReport['tradingPairAnalysis']> {
    console.log('\n🎯 Analyzing trading pair performance and relationships...');
    
    // Get symbol performance metrics
    const symbolPerformance = new Map<string, {
      avgRating: number;
      avgPerformance: number;
      volatility: number;
      consistency: number;
      rank: number;
    }>();
    
    const symbolStats = await this.prisma.glickoRatings.groupBy({
      by: ['symbol'],
      _avg: { rating: true, performanceScore: true, volatility: true, ratingDeviation: true },
      _count: { symbol: true }
    });
    
    // Calculate performance metrics and rank
    const performanceData = symbolStats.map(stat => ({
      symbol: stat.symbol,
      avgRating: Number(stat._avg.rating || 0),
      avgPerformance: Number(stat._avg.performanceScore || 0),
      volatility: Number(stat._avg.volatility || 0),
      consistency: 1 / (Number(stat._avg.ratingDeviation || 1)), // Inverse of RD for consistency
      count: stat._count.symbol
    })).sort((a, b) => b.avgPerformance - a.avgPerformance);
    
    performanceData.forEach((data, index) => {
      symbolPerformance.set(data.symbol, {
        avgRating: data.avgRating,
        avgPerformance: data.avgPerformance,
        volatility: data.volatility,
        consistency: data.consistency,
        rank: index + 1
      });
    });
    
    // Calculate correlation matrix (simplified - would need more complex calculations for true correlation)
    const correlationMatrix = new Map<string, Map<string, number>>();
    // For now, we'll create a placeholder correlation matrix
    // In a full implementation, this would require time-series correlation calculations
    
    console.log('   🏆 Symbol Performance Ranking:');
    console.log('     Rank | Symbol | Avg Rating | Avg Performance | Volatility | Consistency');
    console.log('     ' + '─'.repeat(75));
    performanceData.forEach((data, index) => {
      console.log(`     ${(index + 1).toString().padStart(2)} | ${data.symbol.padEnd(6)} | ${data.avgRating.toFixed(1).padStart(10)} | ${data.avgPerformance.toFixed(2).padStart(13)} | ${data.volatility.toFixed(4).padStart(10)} | ${data.consistency.toFixed(3).padStart(11)}`);
    });
    
    return {
      symbolPerformance,
      correlationMatrix
    };
  }

  /**
   * Generate recommendations based on analysis
   */
  generateRecommendations(report: ComprehensiveAnalysisReport): string[] {
    const recommendations: string[] = [];
    
    // Data completeness recommendations
    if (report.temporalAnalysis.coveragePercentage < 80) {
      recommendations.push(`📊 Data Coverage: ${report.temporalAnalysis.coveragePercentage.toFixed(1)}% coverage is below optimal. Consider investigating missing rating periods.`);
    }
    
    // Data quality recommendations
    if (report.dataQuality.duplicateRecords > 0) {
      recommendations.push(`🔧 Data Quality: Found ${report.dataQuality.duplicateRecords} duplicate records. Run deduplication process.`);
    }
    
    if (report.dataQuality.anomalousValues.extremeRatings > 0) {
      recommendations.push(`⚠️ Anomalous Values: ${report.dataQuality.anomalousValues.extremeRatings} extreme rating values detected. Review calculation logic.`);
    }
    
    // Distribution recommendations
    if (report.dataDistribution.coefficientOfVariation > 25) {
      recommendations.push(`📈 Distribution: High variation (${report.dataDistribution.coefficientOfVariation.toFixed(1)}%) in records per symbol. Some symbols may have missing data.`);
    }
    
    // Performance recommendations
    const topPerformers = Array.from(report.tradingPairAnalysis.symbolPerformance.entries())
      .sort(([,a], [,b]) => b.avgPerformance - a.avgPerformance)
      .slice(0, 3)
      .map(([symbol]) => symbol);
    recommendations.push(`🏆 Top Performers: Consider focusing analysis on ${topPerformers.join(', ')} which show highest performance scores.`);
    
    // Temporal recommendations
    const hasGaps = Array.from(report.dataQuality.temporalGaps.values()).some(gaps => gaps > 0);
    if (hasGaps) {
      recommendations.push(`📅 Temporal Gaps: Some symbols have rating period gaps. Consider implementing gap-filling or investigation.`);
    }
    
    // General recommendations
    recommendations.push('📊 Regular Monitoring: Implement automated data quality monitoring for ongoing validation.');
    recommendations.push('🔄 Periodic Validation: Run this analysis weekly to track data quality trends.');
    recommendations.push('📈 Performance Tracking: Monitor rating progression trends for early detection of calculation issues.');
    
    return recommendations;
  }

  /**
   * Helper function to calculate statistical measures
   */
  private calculateStatistics(values: number[]): {
    min: number; max: number; mean: number; median: number; stdDev: number;
  } {
    if (values.length === 0) {
      return { min: 0, max: 0, mean: 0, median: 0, stdDev: 0 };
    }
    
    const sorted = [...values].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const median = sorted.length % 2 === 0 
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];
    
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    return { min, max, mean, median, stdDev };
  }

  /**
   * Generate comprehensive analysis report
   */
  async generateComprehensiveReport(): Promise<ComprehensiveAnalysisReport> {
    console.log('🎯 Starting Comprehensive Glicko Ratings Analysis...');
    console.log('=' .repeat(80));
    
    const tableStructure = await this.analyzeTableStructure();
    const dataDistribution = await this.analyzeDataDistribution();
    const ratingAnalysis = await this.analyzeRatingValues();
    const dataQuality = await this.analyzeDataQuality();
    const temporalAnalysis = await this.analyzeTemporalPatterns();
    const tradingPairAnalysis = await this.analyzeTradingPairs();
    
    const report: ComprehensiveAnalysisReport = {
      tableStructure,
      dataDistribution,
      ratingAnalysis,
      dataQuality,
      temporalAnalysis,
      tradingPairAnalysis,
      recommendations: []
    };
    
    report.recommendations = this.generateRecommendations(report);
    
    return report;
  }

  /**
   * Print executive summary
   */
  printExecutiveSummary(report: ComprehensiveAnalysisReport): void {
    console.log('\n' + '=' .repeat(80));
    console.log('📋 EXECUTIVE SUMMARY - GLICKO RATINGS ANALYSIS');
    console.log('=' .repeat(80));
    
    // Overall health score calculation
    let healthScore = 100;
    if (report.dataQuality.duplicateRecords > 0) healthScore -= 20;
    if (report.dataQuality.anomalousValues.extremeRatings > 0) healthScore -= 15;
    if (report.temporalAnalysis.coveragePercentage < 80) healthScore -= 15;
    if (report.dataDistribution.coefficientOfVariation > 25) healthScore -= 10;
    if (Array.from(report.dataQuality.temporalGaps.values()).some(g => g > 5)) healthScore -= 10;
    
    const healthStatus = healthScore >= 90 ? '🟢 EXCELLENT' : 
                        healthScore >= 75 ? '🟡 GOOD' : 
                        healthScore >= 60 ? '🟠 NEEDS ATTENTION' : '🔴 CRITICAL';
    
    console.log(`🎯 Overall Health Score: ${healthScore}/100 - ${healthStatus}\n`);
    
    console.log('📊 Key Metrics:');
    console.log(`   • Total Records: ${report.tableStructure.totalRecords.toLocaleString()}`);
    console.log(`   • Unique Symbols: ${report.tableStructure.uniqueSymbols.length} (${report.tableStructure.uniqueSymbols.join(', ')})`);
    console.log(`   • Date Range: ${report.tableStructure.dateRange.totalDays} days`);
    console.log(`   • Data Coverage: ${report.temporalAnalysis.coveragePercentage.toFixed(1)}%`);
    console.log(`   • Rating Range: ${report.ratingAnalysis.globalStats.min.toFixed(1)} - ${report.ratingAnalysis.globalStats.max.toFixed(1)}`);
    console.log(`   • Average Rating: ${report.ratingAnalysis.globalStats.mean.toFixed(1)} ± ${report.ratingAnalysis.globalStats.stdDev.toFixed(1)}`);
    
    console.log('\n🔍 Data Quality Status:');
    console.log(`   • Duplicate Records: ${report.dataQuality.duplicateRecords} ${report.dataQuality.duplicateRecords === 0 ? '✅' : '❌'}`);
    console.log(`   • Missing Data: ${report.dataQuality.missingData.nullRatings + report.dataQuality.missingData.nullTimestamps} ${report.dataQuality.missingData.nullRatings + report.dataQuality.missingData.nullTimestamps === 0 ? '✅' : '❌'}`);
    console.log(`   • Anomalous Values: ${Object.values(report.dataQuality.anomalousValues).reduce((sum, val) => sum + val, 0)} ${Object.values(report.dataQuality.anomalousValues).every(val => val === 0) ? '✅' : '❌'}`);
    
    console.log('\n🏆 Top Performing Symbols:');
    const topSymbols = Array.from(report.tradingPairAnalysis.symbolPerformance.entries())
      .sort(([,a], [,b]) => b.avgPerformance - a.avgPerformance)
      .slice(0, 5);
    topSymbols.forEach(([symbol, perf], index) => {
      console.log(`   ${index + 1}. ${symbol}: Rating ${perf.avgRating.toFixed(1)}, Performance ${perf.avgPerformance.toFixed(2)}`);
    });
    
    console.log('\n💡 Priority Recommendations:');
    report.recommendations.slice(0, 5).forEach((rec, index) => {
      console.log(`   ${index + 1}. ${rec}`);
    });
    
    if (report.recommendations.length > 5) {
      console.log(`   ... and ${report.recommendations.length - 5} more recommendations (see full report above)`);
    }
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
    console.log('\n🧹 Analysis complete - Database connection closed');
  }
}

/**
 * Main execution function
 */
async function main() {
  try {
    const analyzer = new ComprehensiveGlickoAnalyzer();
    await analyzer.initialize();
    
    const report = await analyzer.generateComprehensiveReport();
    analyzer.printExecutiveSummary(report);
    
    await analyzer.cleanup();
    
    // Export report to file for further analysis
    const reportJson = JSON.stringify(report, (key, value) => {
      if (value instanceof Map) {
        return Object.fromEntries(value);
      }
      return value;
    }, 2);
    
    const fs = require('fs');
    const reportPath = '/Users/andrewgibson/Documents/nodeprojects/claude/tradingbot_glicko/analysis/glicko-comprehensive-analysis.json';
    fs.writeFileSync(reportPath, reportJson);
    console.log(`\n💾 Detailed report exported to: ${reportPath}`);
    
  } catch (error) {
    console.error('💥 Comprehensive analysis failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { ComprehensiveGlickoAnalyzer };