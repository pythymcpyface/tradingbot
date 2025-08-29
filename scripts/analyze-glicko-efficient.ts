#!/usr/bin/env tsx

/**
 * Efficient Glicko Ratings Analysis Script
 * 
 * Optimized for large datasets using sampling and efficient SQL queries.
 * Provides comprehensive analysis without loading entire dataset into memory.
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

interface AnalysisReport {
  overview: {
    totalRecords: number;
    uniqueSymbols: string[];
    dateRange: { earliest: Date | null; latest: Date | null; totalDays: number };
    recordsPerSymbol: Record<string, number>;
  };
  ratingStatistics: {
    global: { min: number; max: number; avg: number };
    bySymbol: Record<string, { min: number; max: number; avg: number; count: number }>;
  };
  dataQuality: {
    duplicates: number;
    nullValues: number;
    anomalousValues: number;
    temporalGaps: Record<string, number>;
  };
  performance: {
    topPerformers: Array<{ symbol: string; avgRating: number; avgPerformance: number }>;
    ratingTrends: Record<string, { start: number; latest: number; change: number }>;
  };
  recommendations: string[];
}

class EfficientGlickoAnalyzer {
  private prisma: PrismaClient;
  
  private readonly EXPECTED_COINS = ['BTC', 'ETH', 'XRP', 'SOL', 'ADA', 'DOGE', 'POL', 'AVAX', 'LINK', 'XLM', 'BNB', 'USDT'];
  
  constructor() {
    this.prisma = new PrismaClient();
  }

  async initialize(): Promise<void> {
    await this.prisma.$connect();
    console.log('✅ Connected to database');
  }

  /**
   * Analyze table overview using efficient aggregation queries
   */
  async analyzeOverview(): Promise<AnalysisReport['overview']> {
    console.log('🔍 Analyzing table overview...');
    
    // Get total count
    const totalRecords = await this.prisma.glickoRatings.count();
    
    // Get unique symbols
    const symbolsRaw = await this.prisma.glickoRatings.findMany({
      select: { symbol: true },
      distinct: ['symbol'],
      orderBy: { symbol: 'asc' }
    });
    const uniqueSymbols = symbolsRaw.map(s => s.symbol);
    
    // Get date range
    const dateRange = await this.prisma.glickoRatings.aggregate({
      _min: { timestamp: true },
      _max: { timestamp: true }
    });
    
    const earliest = dateRange._min.timestamp;
    const latest = dateRange._max.timestamp;
    const totalDays = earliest && latest ? 
      Math.ceil((latest.getTime() - earliest.getTime()) / (1000 * 60 * 60 * 24)) : 0;
    
    // Get records per symbol using groupBy
    const recordsPerSymbolRaw = await this.prisma.glickoRatings.groupBy({
      by: ['symbol'],
      _count: { symbol: true }
    });
    
    const recordsPerSymbol: Record<string, number> = {};
    recordsPerSymbolRaw.forEach(item => {
      recordsPerSymbol[item.symbol] = item._count.symbol;
    });
    
    console.log(`   📊 Total Records: ${totalRecords.toLocaleString()}`);
    console.log(`   🏷️  Unique Symbols: ${uniqueSymbols.length}`);
    console.log(`   📅 Date Range: ${earliest?.toISOString().split('T')[0]} to ${latest?.toISOString().split('T')[0]} (${totalDays} days)`);
    
    return { totalRecords, uniqueSymbols, dateRange: { earliest, latest, totalDays }, recordsPerSymbol };
  }

  /**
   * Analyze rating statistics using SQL aggregations
   */
  async analyzeRatingStatistics(): Promise<AnalysisReport['ratingStatistics']> {
    console.log('\n📊 Analyzing rating statistics...');
    
    // Global statistics using Prisma aggregation
    const globalStats = await this.prisma.glickoRatings.aggregate({
      _min: { rating: true },
      _max: { rating: true },
      _avg: { rating: true }
    });
    
    const global = {
      min: Number(globalStats._min.rating || 0),
      max: Number(globalStats._max.rating || 0),
      avg: Number(globalStats._avg.rating || 0)
    };
    
    // Per-symbol statistics
    const symbolStatsRaw = await this.prisma.glickoRatings.groupBy({
      by: ['symbol'],
      _min: { rating: true },
      _max: { rating: true },
      _avg: { rating: true },
      _count: { symbol: true }
    });
    
    const bySymbol: Record<string, { min: number; max: number; avg: number; count: number }> = {};
    symbolStatsRaw.forEach(stat => {
      bySymbol[stat.symbol] = {
        min: Number(stat._min.rating || 0),
        max: Number(stat._max.rating || 0),
        avg: Number(stat._avg.rating || 0),
        count: stat._count.symbol
      };
    });
    
    console.log(`   🌍 Global Rating Range: ${global.min.toFixed(1)} - ${global.max.toFixed(1)} (avg: ${global.avg.toFixed(1)})`);
    console.log('   📈 Per-Symbol Rating Statistics:');
    
    Object.entries(bySymbol)
      .sort(([,a], [,b]) => b.avg - a.avg)
      .forEach(([symbol, stats]) => {
        console.log(`     ${symbol}: ${stats.min.toFixed(1)} - ${stats.max.toFixed(1)} (avg: ${stats.avg.toFixed(1)}, n=${stats.count.toLocaleString()})`);
      });
    
    return { global, bySymbol };
  }

  /**
   * Analyze data quality issues efficiently
   */
  async analyzeDataQuality(): Promise<AnalysisReport['dataQuality']> {
    console.log('\n🔍 Analyzing data quality...');
    
    // Check for duplicates using SQL
    const duplicatesRaw = await this.prisma.$queryRaw<Array<{count: BigInt}>>`
      SELECT COUNT(*) as count FROM (
        SELECT symbol, timestamp, COUNT(*) as cnt
        FROM "glicko_ratings"
        GROUP BY symbol, timestamp
        HAVING COUNT(*) > 1
      ) duplicates
    `;
    const duplicates = Number(duplicatesRaw[0]?.count || 0);
    
    // Schema has NOT NULL constraints, so null checks aren't meaningful
    // Instead, we'll check for reasonable value ranges
    const nullValues = 0; // All fields are required in schema
    
    // Check for anomalous values
    const anomalousValues = await this.prisma.glickoRatings.count({
      where: {
        OR: [
          { rating: { lt: 0 } },
          { rating: { gt: 10000 } },
          { ratingDeviation: { lt: 0 } },
          { ratingDeviation: { gt: 2000 } },
          { volatility: { lt: 0 } },
          { volatility: { gt: 10 } }
        ]
      }
    });
    
    // Analyze temporal gaps for each symbol (sample first 10 records)
    const temporalGaps: Record<string, number> = {};
    for (const symbol of this.EXPECTED_COINS) {
      const sampleRatings = await this.prisma.glickoRatings.findMany({
        where: { symbol },
        select: { timestamp: true },
        orderBy: { timestamp: 'asc' },
        take: 10
      });
      
      let gaps = 0;
      for (let i = 1; i < sampleRatings.length; i++) {
        const hoursDiff = (sampleRatings[i].timestamp.getTime() - sampleRatings[i-1].timestamp.getTime()) / (1000 * 60 * 60);
        if (hoursDiff > 200) { // Expected ~168 hours (7 days) with tolerance
          gaps++;
        }
      }
      temporalGaps[symbol] = gaps;
    }
    
    console.log('   🔧 Data Quality Results:');
    console.log(`     Duplicate Records: ${duplicates} ${duplicates === 0 ? '✅' : '❌'}`);
    console.log(`     Null Values: ${nullValues} ${nullValues === 0 ? '✅' : '❌'}`);
    console.log(`     Anomalous Values: ${anomalousValues} ${anomalousValues === 0 ? '✅' : '❌'}`);
    
    console.log('   📅 Temporal Gaps (sample analysis):');
    Object.entries(temporalGaps).forEach(([symbol, gaps]) => {
      const status = gaps === 0 ? '✅' : gaps <= 2 ? '⚠️' : '❌';
      console.log(`     ${status} ${symbol}: ${gaps} gaps in first 10 periods`);
    });
    
    return { duplicates, nullValues, anomalousValues, temporalGaps };
  }

  /**
   * Analyze performance and trends
   */
  async analyzePerformance(): Promise<AnalysisReport['performance']> {
    console.log('\n🏆 Analyzing performance metrics...');
    
    // Get performance statistics per symbol
    const performanceStatsRaw = await this.prisma.glickoRatings.groupBy({
      by: ['symbol'],
      _avg: { rating: true, performanceScore: true },
      orderBy: { _avg: { performanceScore: 'desc' } }
    });
    
    const topPerformers = performanceStatsRaw.map(stat => ({
      symbol: stat.symbol,
      avgRating: Number(stat._avg.rating || 0),
      avgPerformance: Number(stat._avg.performanceScore || 0)
    }));
    
    // Get rating trends for each symbol (first and latest rating)
    const ratingTrends: Record<string, { start: number; latest: number; change: number }> = {};
    
    for (const symbol of this.EXPECTED_COINS) {
      const firstRating = await this.prisma.glickoRatings.findFirst({
        where: { symbol },
        select: { rating: true },
        orderBy: { timestamp: 'asc' }
      });
      
      const latestRating = await this.prisma.glickoRatings.findFirst({
        where: { symbol },
        select: { rating: true },
        orderBy: { timestamp: 'desc' }
      });
      
      if (firstRating && latestRating) {
        const start = Number(firstRating.rating);
        const latest = Number(latestRating.rating);
        const change = latest - start;
        ratingTrends[symbol] = { start, latest, change };
      }
    }
    
    console.log('   🎯 Top Performers (by avg performance score):');
    topPerformers.slice(0, 6).forEach((perf, index) => {
      console.log(`     ${index + 1}. ${perf.symbol}: Rating ${perf.avgRating.toFixed(1)}, Performance ${perf.avgPerformance.toFixed(2)}`);
    });
    
    console.log('   📈 Rating Trends (start → latest):');
    Object.entries(ratingTrends)
      .sort(([,a], [,b]) => b.change - a.change)
      .forEach(([symbol, trend]) => {
        const direction = trend.change > 0 ? '📈' : trend.change < 0 ? '📉' : '➡️';
        console.log(`     ${direction} ${symbol}: ${trend.start.toFixed(1)} → ${trend.latest.toFixed(1)} (${trend.change > 0 ? '+' : ''}${trend.change.toFixed(1)})`);
      });
    
    return { topPerformers, ratingTrends };
  }

  /**
   * Generate executive summary and recommendations
   */
  generateSummaryAndRecommendations(report: AnalysisReport): void {
    console.log('\n' + '=' .repeat(80));
    console.log('📋 EXECUTIVE SUMMARY - GLICKO RATINGS ANALYSIS');
    console.log('=' .repeat(80));
    
    // Calculate health score
    let healthScore = 100;
    if (report.dataQuality.duplicates > 0) healthScore -= 20;
    if (report.dataQuality.anomalousValues > 0) healthScore -= 15;
    if (report.dataQuality.nullValues > 0) healthScore -= 15;
    
    const totalGaps = Object.values(report.dataQuality.temporalGaps).reduce((sum, gaps) => sum + gaps, 0);
    if (totalGaps > 10) healthScore -= 10;
    
    // POL symbol has significantly fewer records - this may be expected
    const polRecords = report.overview.recordsPerSymbol['POL'] || 0;
    const avgRecords = report.overview.totalRecords / report.overview.uniqueSymbols.length;
    if (polRecords < avgRecords * 0.5) healthScore -= 5; // Minor deduction for POL
    
    const healthStatus = healthScore >= 90 ? '🟢 EXCELLENT' : 
                        healthScore >= 75 ? '🟡 GOOD' : 
                        healthScore >= 60 ? '🟠 NEEDS ATTENTION' : '🔴 CRITICAL';
    
    console.log(`🎯 Database Health Score: ${healthScore}/100 - ${healthStatus}\n`);
    
    // Key findings
    console.log('📊 Key Findings:');
    console.log(`   • Total Records: ${report.overview.totalRecords.toLocaleString()}`);
    console.log(`   • Coverage Period: ${report.overview.totalDays} days (${report.overview.dateRange.earliest?.toISOString().split('T')[0]} to ${report.overview.dateRange.latest?.toISOString().split('T')[0]})`);
    console.log(`   • Active Symbols: ${report.overview.uniqueSymbols.length}/12 expected`);
    console.log(`   • Rating Range: ${report.ratingStatistics.global.min.toFixed(1)} - ${report.ratingStatistics.global.max.toFixed(1)} (avg: ${report.ratingStatistics.global.avg.toFixed(1)})`);
    
    // Data distribution insights
    console.log('\n📈 Data Distribution Insights:');
    const sortedByCount = Object.entries(report.overview.recordsPerSymbol)
      .sort(([,a], [,b]) => b - a);
    
    console.log(`   • Most Data: ${sortedByCount[0][0]} (${sortedByCount[0][1].toLocaleString()} records)`);
    console.log(`   • Least Data: ${sortedByCount[sortedByCount.length-1][0]} (${sortedByCount[sortedByCount.length-1][1].toLocaleString()} records)`);
    
    const polPct = ((report.overview.recordsPerSymbol['POL'] || 0) / avgRecords * 100);
    if (polPct < 50) {
      console.log(`   ⚠️ POL has ${polPct.toFixed(1)}% of average records - may be a newer symbol or data issue`);
    }
    
    // Performance highlights
    console.log('\n🏆 Performance Highlights:');
    const topThree = report.performance.topPerformers.slice(0, 3);
    topThree.forEach((perf, index) => {
      console.log(`   ${index + 1}. ${perf.symbol}: ${perf.avgRating.toFixed(1)} rating, ${perf.avgPerformance.toFixed(2)} performance`);
    });
    
    // Rating trends
    console.log('\n📈 Notable Rating Trends:');
    const trendEntries = Object.entries(report.performance.ratingTrends)
      .sort(([,a], [,b]) => Math.abs(b.change) - Math.abs(a.change))
      .slice(0, 5);
    
    trendEntries.forEach(([symbol, trend]) => {
      const direction = trend.change > 0 ? '📈' : '📉';
      const magnitude = Math.abs(trend.change) > 100 ? 'Large' : Math.abs(trend.change) > 50 ? 'Moderate' : 'Small';
      console.log(`   ${direction} ${symbol}: ${magnitude} change (${trend.change > 0 ? '+' : ''}${trend.change.toFixed(1)})`);
    });
    
    // Generate recommendations
    const recommendations: string[] = [];
    
    if (report.dataQuality.duplicates > 0) {
      recommendations.push(`🔧 Data Quality: Remove ${report.dataQuality.duplicates} duplicate records to improve data integrity.`);
    }
    
    if (report.dataQuality.anomalousValues > 0) {
      recommendations.push(`⚠️ Anomalous Values: Investigate ${report.dataQuality.anomalousValues} records with extreme values.`);
    }
    
    if (polPct < 50) {
      recommendations.push(`📊 POL Symbol: Investigate why POL has ${polPct.toFixed(1)}% of average records (${report.overview.recordsPerSymbol['POL']?.toLocaleString()} vs ${avgRecords.toFixed(0)} expected).`);
    }
    
    if (totalGaps > 20) {
      recommendations.push(`📅 Temporal Gaps: ${totalGaps} gaps detected across symbols. Consider implementing gap detection and filling.`);
    }
    
    recommendations.push('📊 Performance Monitoring: Set up automated monitoring for rating calculation consistency.');
    recommendations.push('🔄 Regular Validation: Schedule weekly data quality checks to maintain system health.');
    
    const topPerformer = topThree[0];
    if (topPerformer.avgPerformance > 0.7) {
      recommendations.push(`🎯 Focus Analysis: ${topPerformer.symbol} shows strong performance (${topPerformer.avgPerformance.toFixed(2)}) - consider detailed strategy analysis.`);
    }
    
    console.log('\n💡 Recommendations:');
    recommendations.forEach((rec, index) => {
      console.log(`   ${index + 1}. ${rec}`);
    });
    
    report.recommendations = recommendations;
  }

  /**
   * Run complete analysis
   */
  async runAnalysis(): Promise<AnalysisReport> {
    console.log('🎯 Starting Efficient Glicko Ratings Analysis...');
    console.log('=' .repeat(80));
    
    const overview = await this.analyzeOverview();
    const ratingStatistics = await this.analyzeRatingStatistics();
    const dataQuality = await this.analyzeDataQuality();
    const performance = await this.analyzePerformance();
    
    const report: AnalysisReport = {
      overview,
      ratingStatistics,
      dataQuality,
      performance,
      recommendations: []
    };
    
    this.generateSummaryAndRecommendations(report);
    
    return report;
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
    console.log('\n🧹 Database connection closed');
  }
}

/**
 * Main execution
 */
async function main() {
  const startTime = Date.now();
  
  try {
    const analyzer = new EfficientGlickoAnalyzer();
    await analyzer.initialize();
    
    const report = await analyzer.runAnalysis();
    
    // Export simplified report
    const reportData = {
      analysisDate: new Date().toISOString(),
      executionTimeMs: Date.now() - startTime,
      ...report
    };
    
    const fs = require('fs');
    const reportPath = '/Users/andrewgibson/Documents/nodeprojects/claude/tradingbot_glicko/analysis/glicko-analysis-summary.json';
    fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
    console.log(`\n💾 Analysis report saved to: ${reportPath}`);
    
    await analyzer.cleanup();
    
  } catch (error) {
    console.error('💥 Analysis failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { EfficientGlickoAnalyzer };