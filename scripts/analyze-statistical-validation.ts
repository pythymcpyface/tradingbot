#!/usr/bin/env ts-node

/**
 * Statistical Validation Analysis
 * 
 * Analyzes why only 3.3% of strategies are statistically significant
 * and provides specific recommendations for improvement.
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

interface ValidationResult {
  totalSets: number;
  significantSets: number;
  sampleSizeIssues: number;
  lowPerformanceSets: number;
  highVariabilitySets: number;
  sampleSizeDistribution: number[];
  performanceDistribution: number[];
  variabilityDistribution: number[];
}

class StatisticalValidationAnalyzer {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async initialize(): Promise<void> {
    await this.prisma.$connect();
    console.log('✅ Connected to database');
  }

  async analyzeStatisticalValidation(): Promise<ValidationResult> {
    console.log('🎯 STATISTICAL SIGNIFICANCE ANALYSIS');
    console.log('='.repeat(80));
    
    // Get parameter sets with sufficient sample size
    const allResults = await this.prisma.optimizationResults.findMany({
      where: {
        calmarRatio: { not: null },
        totalTrades: { gt: 5 }
      },
      select: {
        zScoreThreshold: true,
        profitPercent: true,
        stopLossPercent: true,
        movingAverages: true,
        calmarRatio: true,
        sharpeRatio: true,
        alpha: true,
        annualizedReturn: true,
        maxDrawdown: true,
        baseAsset: true,
        quoteAsset: true,
        totalTrades: true,
        startTime: true,
        endTime: true
      }
    });
    
    console.log('📊 Analyzing', allResults.length, 'optimization results...');
    
    // Group by parameter set
    const paramGroups = new Map<string, any[]>();
    for (const result of allResults) {
      const key = `${result.zScoreThreshold}_${result.profitPercent}_${result.stopLossPercent}_${result.movingAverages}`;
      if (!paramGroups.has(key)) {
        paramGroups.set(key, []);
      }
      paramGroups.get(key)!.push({
        ...result,
        calmarRatio: parseFloat(result.calmarRatio!.toString()),
        sharpeRatio: parseFloat(result.sharpeRatio.toString()),
        alpha: parseFloat(result.alpha.toString()),
        annualizedReturn: parseFloat(result.annualizedReturn.toString()),
        maxDrawdown: parseFloat(result.maxDrawdown.toString())
      });
    }
    
    console.log('📋 Testing statistical significance for', paramGroups.size, 'parameter sets...');
    
    let totalSets = 0;
    let significantSets = 0;
    let sampleSizeIssues = 0;
    let lowPerformanceSets = 0;
    let highVariabilitySets = 0;
    
    const sampleSizeDistribution: number[] = [];
    const performanceDistribution: number[] = [];
    const variabilityDistribution: number[] = [];
    
    for (const [paramKey, results] of paramGroups.entries()) {
      if (results.length < 3) {
        sampleSizeIssues++;
        continue;
      }
      
      totalSets++;
      sampleSizeDistribution.push(results.length);
      
      const calmarRatios = results.map((r: any) => r.calmarRatio);
      const mean = calmarRatios.reduce((a: number, b: number) => a + b, 0) / calmarRatios.length;
      const variance = calmarRatios.reduce((sum: number, val: number) => sum + Math.pow(val - mean, 2), 0) / calmarRatios.length;
      const stdDev = Math.sqrt(variance);
      const n = calmarRatios.length;
      
      performanceDistribution.push(mean);
      variabilityDistribution.push(stdDev);
      
      // T-test for significance (H0: mean <= 1, H1: mean > 1)
      const tStat = (mean - 1) / (stdDev / Math.sqrt(n));
      const df = n - 1;
      
      // Simple t-critical values (one-tailed test, α = 0.05)
      let tCritical = 1.645; // For large samples
      if (df <= 30) {
        const tTable: Record<number, number> = {
          1: 6.314, 2: 2.920, 3: 2.353, 4: 2.132, 5: 2.015, 
          10: 1.812, 20: 1.725, 30: 1.697
        };
        for (const [dfKey, tVal] of Object.entries(tTable)) {
          if (df <= parseInt(dfKey)) {
            tCritical = tVal;
            break;
          }
        }
      }
      
      const isSignificant = tStat > tCritical && mean > 1;
      
      if (isSignificant) {
        significantSets++;
      } else if (mean <= 1) {
        lowPerformanceSets++;
      } else if (stdDev > mean * 0.5) { // High coefficient of variation
        highVariabilitySets++;
      }
    }

    return {
      totalSets,
      significantSets,
      sampleSizeIssues,
      lowPerformanceSets,
      highVariabilitySets,
      sampleSizeDistribution,
      performanceDistribution,
      variabilityDistribution
    };
  }

  displayValidationResults(results: ValidationResult): void {
    console.log('\n📊 STATISTICAL SIGNIFICANCE RESULTS:');
    console.log('   Parameter sets analyzed:', results.totalSets);
    console.log('   Statistically significant:', results.significantSets, 
                '(' + (results.significantSets/results.totalSets*100).toFixed(1) + '%)');
    console.log('   Sample size issues (<3 samples):', results.sampleSizeIssues);
    console.log('   Low performance (mean Calmar ≤ 1):', results.lowPerformanceSets, 
                '(' + (results.lowPerformanceSets/results.totalSets*100).toFixed(1) + '%)');
    console.log('   High variability (CV > 50%):', results.highVariabilitySets, 
                '(' + (results.highVariabilitySets/results.totalSets*100).toFixed(1) + '%)');
    
    console.log('\n📊 SAMPLE SIZE DISTRIBUTION:');
    console.log('   Min samples:', Math.min(...results.sampleSizeDistribution));
    console.log('   Max samples:', Math.max(...results.sampleSizeDistribution));
    console.log('   Average samples:', (results.sampleSizeDistribution.reduce((a,b) => a+b, 0) / results.sampleSizeDistribution.length).toFixed(1));
    console.log('   Samples < 5:', results.sampleSizeDistribution.filter(n => n < 5).length, 
                '(' + (results.sampleSizeDistribution.filter(n => n < 5).length/results.sampleSizeDistribution.length*100).toFixed(1) + '%)');
    console.log('   Samples < 10:', results.sampleSizeDistribution.filter(n => n < 10).length, 
                '(' + (results.sampleSizeDistribution.filter(n => n < 10).length/results.sampleSizeDistribution.length*100).toFixed(1) + '%)');
    console.log('   Samples >= 20:', results.sampleSizeDistribution.filter(n => n >= 20).length, 
                '(' + (results.sampleSizeDistribution.filter(n => n >= 20).length/results.sampleSizeDistribution.length*100).toFixed(1) + '%)');
    
    console.log('\n📊 PERFORMANCE DISTRIBUTION:');
    console.log('   Min Calmar ratio:', Math.min(...results.performanceDistribution).toFixed(3));
    console.log('   Max Calmar ratio:', Math.max(...results.performanceDistribution).toFixed(3));
    console.log('   Average Calmar ratio:', (results.performanceDistribution.reduce((a,b) => a+b, 0) / results.performanceDistribution.length).toFixed(3));
    console.log('   Calmar > 1:', results.performanceDistribution.filter(p => p > 1).length, 
                '(' + (results.performanceDistribution.filter(p => p > 1).length/results.performanceDistribution.length*100).toFixed(1) + '%)');
    console.log('   Calmar > 2:', results.performanceDistribution.filter(p => p > 2).length, 
                '(' + (results.performanceDistribution.filter(p => p > 2).length/results.performanceDistribution.length*100).toFixed(1) + '%)');
    console.log('   Calmar > 3:', results.performanceDistribution.filter(p => p > 3).length, 
                '(' + (results.performanceDistribution.filter(p => p > 3).length/results.performanceDistribution.length*100).toFixed(1) + '%)');
    
    console.log('\n📊 VARIABILITY ANALYSIS:');
    console.log('   Average std dev:', (results.variabilityDistribution.reduce((a,b) => a+b, 0) / results.variabilityDistribution.length).toFixed(3));
    console.log('   High variability (std > 1):', results.variabilityDistribution.filter(v => v > 1).length, 
                '(' + (results.variabilityDistribution.filter(v => v > 1).length/results.variabilityDistribution.length*100).toFixed(1) + '%)');
  }

  async analyzeBacktestGeneration(): Promise<void> {
    console.log('\n🔍 BACKTEST GENERATION ANALYSIS');
    console.log('='.repeat(80));

    // Analyze window sizes and overlaps
    const backtestRuns = await this.prisma.backtestRuns.findMany({
      select: {
        windowSize: true,
        startTime: true,
        endTime: true,
        baseAsset: true,
        quoteAsset: true,
        zScoreThreshold: true,
        profitPercent: true,
        stopLossPercent: true,
        movingAverages: true
      },
      take: 1000
    });

    console.log('📅 Backtest Run Analysis:');
    console.log('   Total runs analyzed:', backtestRuns.length);

    if (backtestRuns.length > 0) {
      // Window size analysis
      const windowSizes = backtestRuns.map(r => r.windowSize || 12);
      console.log('   Window size distribution:');
      console.log('     Most common:', this.getMostCommon(windowSizes));
      console.log('     Range:', Math.min(...windowSizes), '-', Math.max(...windowSizes));

      // Time period analysis
      const periods = backtestRuns.map(r => {
        const start = new Date(r.startTime);
        const end = new Date(r.endTime);
        return (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24); // days
      });

      console.log('   Time period distribution (days):');
      console.log('     Average length:', (periods.reduce((a,b) => a+b, 0) / periods.length).toFixed(0));
      console.log('     Range:', Math.min(...periods).toFixed(0), '-', Math.max(...periods).toFixed(0));

      // Check for potential overlaps
      const sortedRuns = backtestRuns.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
      let overlaps = 0;
      for (let i = 0; i < sortedRuns.length - 1; i++) {
        const currentEnd = new Date(sortedRuns[i].endTime);
        const nextStart = new Date(sortedRuns[i + 1].startTime);
        if (currentEnd > nextStart) {
          overlaps++;
        }
      }
      console.log('   Potential time overlaps:', overlaps, '(' + (overlaps/backtestRuns.length*100).toFixed(1) + '%)');
    }
  }

  async analyzeDataQuality(): Promise<void> {
    console.log('\n🎯 DATA QUALITY ANALYSIS');
    console.log('='.repeat(80));

    // Check for data gaps in klines
    const klineStats = await this.prisma.klines.groupBy({
      by: ['symbol'],
      _count: true,
      _min: { openTime: true },
      _max: { openTime: true }
    });

    console.log('📈 K-line Data Coverage:');
    for (const stat of klineStats) {
      const start = stat._min.openTime ? new Date(stat._min.openTime) : null;
      const end = stat._max.openTime ? new Date(stat._max.openTime) : null;
      const daysCovered = start && end ? Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) : 0;
      
      console.log(`   ${stat.symbol}:`);
      console.log(`     Records: ${stat._count.toLocaleString()}`);
      console.log(`     Period: ${start?.toISOString().split('T')[0]} to ${end?.toISOString().split('T')[0]}`);
      console.log(`     Days: ${daysCovered}`);
    }

    // Check for missing data periods
    const sampleSymbol = klineStats[0]?.symbol;
    if (sampleSymbol) {
      const klineData = await this.prisma.klines.findMany({
        where: { symbol: sampleSymbol },
        select: { openTime: true },
        orderBy: { openTime: 'asc' },
        take: 100
      });

      if (klineData.length > 1) {
        const intervals = [];
        for (let i = 1; i < klineData.length; i++) {
          const prev = new Date(klineData[i-1].openTime);
          const curr = new Date(klineData[i].openTime);
          intervals.push(curr.getTime() - prev.getTime());
        }
        const avgInterval = intervals.reduce((a,b) => a+b, 0) / intervals.length;
        const expectedInterval = 5 * 60 * 1000; // 5 minutes in ms
        
        console.log('   Data consistency check (sample):');
        console.log('     Expected interval: 5 minutes');
        console.log('     Actual avg interval:', Math.round(avgInterval / 60000), 'minutes');
        console.log('     Large gaps (>2x expected):', intervals.filter(i => i > expectedInterval * 2).length);
      }
    }
  }

  private getMostCommon<T>(arr: T[]): T | null {
    const counts = new Map<T, number>();
    for (const item of arr) {
      counts.set(item, (counts.get(item) || 0) + 1);
    }
    let max = 0;
    let mostCommon: T | null = null;
    for (const [item, count] of counts.entries()) {
      if (count > max) {
        max = count;
        mostCommon = item;
      }
    }
    return mostCommon;
  }

  generateRecommendations(results: ValidationResult): void {
    console.log('\n💡 SPECIFIC IMPROVEMENT RECOMMENDATIONS');
    console.log('='.repeat(80));

    const significanceRate = results.significantSets / results.totalSets;
    const lowPerformanceRate = results.lowPerformanceSets / results.totalSets;
    const highVariabilityRate = results.highVariabilitySets / results.totalSets;
    const avgSampleSize = results.sampleSizeDistribution.reduce((a,b) => a+b, 0) / results.sampleSizeDistribution.length;
    const smallSampleRate = results.sampleSizeDistribution.filter(n => n < 10).length / results.sampleSizeDistribution.length;

    console.log('🎯 PRIMARY ISSUES IDENTIFIED:');
    
    if (significanceRate < 0.1) {
      console.log('   ❌ CRITICAL: Only ' + (significanceRate * 100).toFixed(1) + '% of strategies are statistically significant');
    }
    
    if (lowPerformanceRate > 0.3) {
      console.log('   ❌ HIGH IMPACT: ' + (lowPerformanceRate * 100).toFixed(1) + '% of strategies have poor performance (Calmar ≤ 1)');
    }
    
    if (highVariabilityRate > 0.2) {
      console.log('   ⚠️ MEDIUM IMPACT: ' + (highVariabilityRate * 100).toFixed(1) + '% of strategies have high variability');
    }
    
    if (smallSampleRate > 0.3) {
      console.log('   ⚠️ MEDIUM IMPACT: ' + (smallSampleRate * 100).toFixed(1) + '% of parameter sets have small sample sizes (<10)');
    }

    console.log('\n🔧 IMMEDIATE ACTIONS REQUIRED:');
    
    // Sample size recommendations
    if (avgSampleSize < 15) {
      console.log('   1. INCREASE SAMPLE SIZES:');
      console.log('      - Current average: ' + avgSampleSize.toFixed(1) + ' samples per parameter set');
      console.log('      - Target: ≥20 samples for reliable statistics');
      console.log('      - Action: Run more backtests across different time periods');
      console.log('      - Action: Implement sliding window approach with more overlap');
    }

    // Performance improvements
    if (lowPerformanceRate > 0.3) {
      console.log('   2. IMPROVE STRATEGY PERFORMANCE:');
      console.log('      - ' + (lowPerformanceRate * 100).toFixed(1) + '% of strategies underperform (Calmar ≤ 1)');
      console.log('      - Action: Review entry/exit criteria');
      console.log('      - Action: Optimize parameter ranges');
      console.log('      - Action: Add market regime filters');
      console.log('      - Action: Implement adaptive parameters');
    }

    // Variability reduction
    if (highVariabilityRate > 0.2) {
      console.log('   3. REDUCE STRATEGY VARIABILITY:');
      console.log('      - ' + (highVariabilityRate * 100).toFixed(1) + '% of strategies have inconsistent performance');
      console.log('      - Action: Implement ensemble methods');
      console.log('      - Action: Add risk management layers');
      console.log('      - Action: Use rolling parameter optimization');
      console.log('      - Action: Test across different market conditions');
    }

    console.log('\n🏗️ SYSTEMATIC IMPROVEMENTS:');
    
    console.log('   4. ENHANCED STATISTICAL FRAMEWORK:');
    console.log('      - Implement bootstrapping for confidence intervals');
    console.log('      - Add multiple testing corrections (Bonferroni, FDR)');
    console.log('      - Use Monte Carlo simulations for significance testing');
    console.log('      - Add effect size calculations (Cohen\'s d, eta-squared)');
    
    console.log('   5. IMPROVED DATA COLLECTION:');
    console.log('      - Implement stratified sampling across market conditions');
    console.log('      - Add out-of-sample testing periods');
    console.log('      - Increase cross-validation folds');
    console.log('      - Implement walk-forward analysis with proper gaps');
    
    console.log('   6. ADVANCED VALIDATION METHODS:');
    console.log('      - Add White\'s Reality Check for data snooping');
    console.log('      - Implement Hansen\'s SPA test');
    console.log('      - Add time series cross-validation');
    console.log('      - Use combinatorially symmetric cross-validation');

    console.log('\n📊 EXPECTED IMPROVEMENTS:');
    if (avgSampleSize < 15) {
      console.log('   - Increasing sample sizes to ≥20: +15-25% significance rate');
    }
    if (lowPerformanceRate > 0.3) {
      console.log('   - Strategy optimization: +20-40% performance improvement');
    }
    if (highVariabilityRate > 0.2) {
      console.log('   - Variability reduction: +10-20% significance rate');
    }
    console.log('   - Combined improvements: Target 25-40% significance rate');

    console.log('\n⏱️ IMPLEMENTATION PRIORITY:');
    console.log('   🚨 URGENT (Week 1): Increase sample sizes, fix data gaps');
    console.log('   🔥 HIGH (Week 2-3): Optimize underperforming strategies');
    console.log('   📈 MEDIUM (Week 4-6): Implement advanced statistical methods');
    console.log('   🔬 LOW (Month 2): Add sophisticated validation frameworks');
  }

  async run(): Promise<void> {
    try {
      await this.initialize();
      
      // Main statistical validation analysis
      const validationResults = await this.analyzeStatisticalValidation();
      this.displayValidationResults(validationResults);
      
      // Additional analyses
      await this.analyzeBacktestGeneration();
      await this.analyzeDataQuality();
      
      // Generate specific recommendations
      this.generateRecommendations(validationResults);
      
      console.log('\n✅ Statistical validation analysis complete!');
      console.log('💡 Focus on the urgent recommendations to dramatically improve significance rates.');
      
    } catch (error) {
      console.error('❌ Error in statistical validation analysis:', error);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }
}

// Main execution
async function main() {
  const analyzer = new StatisticalValidationAnalyzer();
  await analyzer.run();
}

if (require.main === module) {
  main().catch(console.error);
}

export { StatisticalValidationAnalyzer };