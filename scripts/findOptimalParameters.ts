#!/usr/bin/env ts-node

/**
 * Comprehensive Parameter Optimization Analysis
 * 
 * Uses multiple analysis techniques to identify optimal parameter sets:
 * - Multi-Metric Scoring: Combines Calmar ratio, Sharpe ratio, alpha, consistency
 * - Risk-Adjusted Rankings: Weights by drawdown and volatility
 * - Stability Analysis: Parameter robustness across different time periods  
 * - Portfolio Approach: Parameter performance across multiple pairs
 * - Statistical Validation: Confidence intervals and significance testing
 * 
 * Usage: npm run findOptimalParameters
 */

import { PrismaClient } from '@prisma/client';
import { BacktestSuccessAnalyzer } from '../src/utils/BacktestSuccessMetrics';
import { config } from 'dotenv';

config();

interface ParameterSet {
  zScoreThreshold: number;
  profitPercent: number;
  stopLossPercent: number;
  movingAverages: number;
}

interface OptimalParameterResult {
  parameters: ParameterSet;
  
  // Performance Metrics
  avgCalmarRatio: number;
  avgSharpeRatio: number;
  avgAlpha: number;
  avgAnnualizedReturn: number;
  avgMaxDrawdown: number;
  avgWinRatio: number;
  avgTotalTrades: number;
  
  // Cross-Pair Analysis
  pairCount: number;
  consistentPairs: number; // Pairs where Calmar > 2
  bestPairCalmar: number;
  worstPairCalmar: number;
  
  // Risk Assessment
  riskLevel: 'Low' | 'Medium' | 'High' | 'Very High';
  riskScore: number;
  volatilityScore: number;
  
  // Stability Metrics
  stabilityIndex: number;
  consistencyScore: number; // % of results that are positive
  calmarStdDev: number; // How consistent the Calmar ratios are
  
  // Statistical Validation
  calmarConfidenceInterval: [number, number];
  statisticalSignificance: boolean;
  sampleSize: number;
  
  // Composite Scores
  compositeScore: number;
  riskAdjustedScore: number;
  portfolioScore: number;
  
  // Position Sizing
  kellyPercentage: number;
  recommendedPositionSize: number;
  
  // Final Assessment
  overallGrade: 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'F';
  recommendation: string;
}

class OptimalParameterFinder {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async initialize(): Promise<void> {
    await this.prisma.$connect();
    console.log('✅ Connected to database');
  }

  /**
   * Main analysis function - finds optimal parameters using multiple techniques
   */
  async findOptimalParameters(): Promise<OptimalParameterResult[]> {
    console.log('🎯 COMPREHENSIVE PARAMETER OPTIMIZATION ANALYSIS');
    console.log('=' .repeat(80));
    console.log('   Techniques: Multi-Metric | Risk-Adjusted | Portfolio | Statistical');
    console.log('   Scope: All trading pairs and time periods\n');

    // Get all optimization results
    const allResults = await this.prisma.optimizationResults.findMany({
      where: {
        calmarRatio: { not: null },
        totalTrades: { gt: 5 } // Only meaningful results
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
        winRatio: true,
        totalTrades: true,
        baseAsset: true,
        quoteAsset: true,
        startTime: true,
        endTime: true
      }
    });

    console.log(`📊 Analyzing ${allResults.length} optimization results...`);

    // Group by parameter set
    const parameterGroups = this.groupResultsByParameters(allResults);
    console.log(`   Found ${parameterGroups.size} unique parameter combinations`);

    // Analyze each parameter set
    const parameterAnalyses: OptimalParameterResult[] = [];
    
    for (const [paramKey, results] of parameterGroups.entries()) {
      // Only analyze parameter sets with sufficient data (at least 3 different pairs/periods)
      if (results.length < 3) continue;
      
      const analysis = await this.analyzeParameterSet(paramKey, results);
      parameterAnalyses.push(analysis);
    }

    console.log(`   Completed analysis of ${parameterAnalyses.length} parameter sets with sufficient data\n`);

    // Sort by composite score (primary ranking)
    return parameterAnalyses.sort((a, b) => b.compositeScore - a.compositeScore);
  }

  /**
   * Group results by parameter combination
   */
  private groupResultsByParameters(results: any[]): Map<string, any[]> {
    const groups = new Map<string, any[]>();

    for (const result of results) {
      const key = `${result.zScoreThreshold}_${result.profitPercent}_${result.stopLossPercent}_${result.movingAverages}`;
      
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      
      groups.get(key)!.push({
        ...result,
        calmarRatio: parseFloat(result.calmarRatio!.toString()),
        sharpeRatio: parseFloat(result.sharpeRatio.toString()),
        alpha: parseFloat(result.alpha.toString()),
        annualizedReturn: parseFloat(result.annualizedReturn.toString()),
        maxDrawdown: parseFloat(result.maxDrawdown.toString()),
        winRatio: parseFloat(result.winRatio.toString())
      });
    }

    return groups;
  }

  /**
   * Comprehensive analysis of a single parameter set
   */
  private async analyzeParameterSet(paramKey: string, results: any[]): Promise<OptimalParameterResult> {
    const [zScore, profit, stop, movingAvg] = paramKey.split('_').map(parseFloat);
    
    // Basic metrics
    const calmarRatios = results.map(r => r.calmarRatio);
    const sharpeRatios = results.map(r => r.sharpeRatio);
    const alphas = results.map(r => r.alpha);
    const annualizedReturns = results.map(r => r.annualizedReturn);
    const maxDrawdowns = results.map(r => r.maxDrawdown);
    const winRatios = results.map(r => r.winRatio);
    const totalTrades = results.map(r => r.totalTrades);

    // Calculate averages
    const avgCalmarRatio = this.calculateMean(calmarRatios);
    const avgSharpeRatio = this.calculateMean(sharpeRatios);
    const avgAlpha = this.calculateMean(alphas);
    const avgAnnualizedReturn = this.calculateMean(annualizedReturns);
    const avgMaxDrawdown = this.calculateMean(maxDrawdowns);
    const avgWinRatio = this.calculateMean(winRatios);
    const avgTotalTrades = Math.round(this.calculateMean(totalTrades));

    // Cross-pair analysis
    const uniquePairs = new Set(results.map(r => `${r.baseAsset}${r.quoteAsset}`));
    const pairCount = uniquePairs.size;
    const consistentPairs = calmarRatios.filter(c => c > 2).length;
    const bestPairCalmar = Math.max(...calmarRatios);
    const worstPairCalmar = Math.min(...calmarRatios);

    // Risk assessment
    const { riskLevel, riskScore } = this.assessRisk(avgMaxDrawdown, avgCalmarRatio);
    const volatilityScore = this.calculateStandardDeviation(calmarRatios);

    // Stability metrics
    const stabilityIndex = this.calculateStabilityIndex(calmarRatios, avgCalmarRatio);
    const consistencyScore = (calmarRatios.filter(c => c > 0).length / calmarRatios.length) * 100;
    const calmarStdDev = this.calculateStandardDeviation(calmarRatios);

    // Statistical validation
    const calmarConfidenceInterval = this.calculateConfidenceInterval(calmarRatios, 0.95);
    const statisticalSignificance = this.testSignificance(calmarRatios);
    const sampleSize = results.length;

    // Composite scores
    const compositeScore = this.calculateCompositeScore({
      calmarRatio: avgCalmarRatio,
      sharpeRatio: avgSharpeRatio,
      alpha: avgAlpha,
      consistencyScore,
      riskScore,
      stabilityIndex
    });

    const riskAdjustedScore = this.calculateRiskAdjustedScore({
      avgCalmarRatio,
      avgMaxDrawdown,
      stabilityIndex,
      consistencyScore
    });

    const portfolioScore = this.calculatePortfolioScore({
      pairCount,
      consistentPairs,
      calmarStdDev,
      avgCalmarRatio
    });

    // Position sizing
    const kellyPercentage = this.calculateKellyPercentage(avgWinRatio / 100, avgAnnualizedReturn, avgMaxDrawdown);
    const recommendedPositionSize = this.recommendPositionSize(kellyPercentage, riskLevel);

    // Final assessment
    const overallGrade = this.gradeStrategy(compositeScore, riskAdjustedScore, portfolioScore);
    const recommendation = this.generateRecommendation({
      overallGrade,
      riskLevel,
      avgCalmarRatio,
      consistencyScore,
      kellyPercentage,
      pairCount,
      statisticalSignificance
    });

    return {
      parameters: {
        zScoreThreshold: zScore,
        profitPercent: profit,
        stopLossPercent: stop,
        movingAverages: movingAvg
      },
      avgCalmarRatio,
      avgSharpeRatio,
      avgAlpha,
      avgAnnualizedReturn,
      avgMaxDrawdown,
      avgWinRatio,
      avgTotalTrades,
      pairCount,
      consistentPairs,
      bestPairCalmar,
      worstPairCalmar,
      riskLevel,
      riskScore,
      volatilityScore,
      stabilityIndex,
      consistencyScore,
      calmarStdDev,
      calmarConfidenceInterval,
      statisticalSignificance,
      sampleSize,
      compositeScore,
      riskAdjustedScore,
      portfolioScore,
      kellyPercentage,
      recommendedPositionSize,
      overallGrade,
      recommendation
    };
  }

  /**
   * Calculate multi-metric composite score
   */
  private calculateCompositeScore(metrics: {
    calmarRatio: number;
    sharpeRatio: number;
    alpha: number;
    consistencyScore: number;
    riskScore: number;
    stabilityIndex: number;
  }): number {
    // Normalize each metric to 0-100 scale
    const calmarScore = Math.min(100, Math.max(0, metrics.calmarRatio * 15)); // 0-7 -> 0-100
    const sharpeScore = Math.min(100, Math.max(0, (metrics.sharpeRatio + 2) * 12.5)); // -2 to 6 -> 0-100
    const alphaScore = Math.min(100, Math.max(0, metrics.alpha * 5)); // 0-20 -> 0-100
    const consistencyScore = metrics.consistencyScore; // Already 0-100
    const riskPenalty = Math.min(50, metrics.riskScore * 25); // Risk penalty
    const stabilityScore = metrics.stabilityIndex; // Already 0-100

    // Weighted composite (risk-adjusted focus)
    const rawScore = (
      calmarScore * 0.30 +        // Primary performance metric
      sharpeScore * 0.20 +        // Risk-adjusted returns
      alphaScore * 0.15 +         // Alpha generation
      consistencyScore * 0.20 +   // Consistency across pairs
      stabilityScore * 0.15       // Stability of performance
    );

    // Apply risk penalty
    return Math.max(0, rawScore - riskPenalty);
  }

  /**
   * Calculate risk-adjusted score
   */
  private calculateRiskAdjustedScore(metrics: {
    avgCalmarRatio: number;
    avgMaxDrawdown: number;
    stabilityIndex: number;
    consistencyScore: number;
  }): number {
    const returnScore = Math.min(100, metrics.avgCalmarRatio * 20);
    const drawdownPenalty = metrics.avgMaxDrawdown * 150; // Heavy penalty for drawdown
    const stabilityBonus = metrics.stabilityIndex * 0.5;
    const consistencyBonus = metrics.consistencyScore * 0.3;

    return Math.max(0, returnScore + stabilityBonus + consistencyBonus - drawdownPenalty);
  }

  /**
   * Calculate portfolio-wide effectiveness score
   */
  private calculatePortfolioScore(metrics: {
    pairCount: number;
    consistentPairs: number;
    calmarStdDev: number;
    avgCalmarRatio: number;
  }): number {
    const diversityScore = Math.min(100, (metrics.pairCount / 9) * 100); // Max 9 pairs
    const consistencyRate = (metrics.consistentPairs / metrics.pairCount) * 100;
    const stabilityScore = Math.max(0, 100 - (metrics.calmarStdDev * 20)); // Lower std dev = higher score
    const performanceScore = Math.min(100, metrics.avgCalmarRatio * 20);

    return (
      diversityScore * 0.25 +
      consistencyRate * 0.35 +
      stabilityScore * 0.20 +
      performanceScore * 0.20
    );
  }

  /**
   * Assess risk level
   */
  private assessRisk(maxDrawdown: number, calmarRatio: number): { riskLevel: 'Low' | 'Medium' | 'High' | 'Very High', riskScore: number } {
    const riskScore = (maxDrawdown * 0.7 + (1 / Math.max(0.1, calmarRatio)) * 0.3);
    
    let riskLevel: 'Low' | 'Medium' | 'High' | 'Very High';
    if (maxDrawdown < 10 && calmarRatio > 3) riskLevel = 'Low';
    else if (maxDrawdown < 15 && calmarRatio > 2) riskLevel = 'Medium';
    else if (maxDrawdown < 25 && calmarRatio > 1) riskLevel = 'High';
    else riskLevel = 'Very High';

    return { riskLevel, riskScore };
  }

  /**
   * Calculate stability index
   */
  private calculateStabilityIndex(values: number[], mean: number): number {
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const coefficientOfVariation = Math.sqrt(variance) / Math.abs(mean);
    return Math.max(0, Math.min(100, (1 - coefficientOfVariation) * 100));
  }

  /**
   * Calculate confidence interval
   */
  private calculateConfidenceInterval(values: number[], confidence: number): [number, number] {
    const mean = this.calculateMean(values);
    const stdDev = this.calculateStandardDeviation(values);
    const n = values.length;
    const tValue = this.getTValue(confidence, n - 1);
    const margin = tValue * (stdDev / Math.sqrt(n));
    
    return [mean - margin, mean + margin];
  }

  /**
   * Test statistical significance
   */
  private testSignificance(values: number[], threshold: number = 1): boolean {
    const mean = this.calculateMean(values);
    const stdDev = this.calculateStandardDeviation(values);
    const n = values.length;
    const tStat = (mean - threshold) / (stdDev / Math.sqrt(n));
    const tCritical = this.getTValue(0.95, n - 1);
    
    return Math.abs(tStat) > tCritical && mean > threshold;
  }

  /**
   * Calculate Kelly percentage for position sizing
   */
  private calculateKellyPercentage(winRate: number, avgReturn: number, maxDrawdown: number): number {
    if (winRate <= 0 || avgReturn <= 0) return 0;
    
    const avgWin = avgReturn * (2 / winRate);
    const avgLoss = maxDrawdown * (1 / (1 - winRate));
    
    if (avgLoss <= 0) return 0;
    
    const kelly = (winRate * avgWin - (1 - winRate) * avgLoss) / avgWin;
    return Math.max(0, Math.min(1, kelly));
  }

  /**
   * Recommend position size based on Kelly percentage and risk level
   */
  private recommendPositionSize(kelly: number, riskLevel: string): number {
    let sizeMultiplier: number = 0.2; // default for unknown risk levels
    switch (riskLevel) {
      case 'Low': sizeMultiplier = 0.8; break;
      case 'Medium': sizeMultiplier = 0.6; break;
      case 'High': sizeMultiplier = 0.4; break;
      case 'Very High': sizeMultiplier = 0.2; break;
    }
    
    return Math.min(0.25, kelly * sizeMultiplier); // Cap at 25%
  }

  /**
   * Grade strategy performance
   */
  private gradeStrategy(composite: number, riskAdjusted: number, portfolio: number): 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'F' {
    const overallScore = (composite * 0.4 + riskAdjusted * 0.35 + portfolio * 0.25);
    
    if (overallScore >= 90) return 'A+';
    if (overallScore >= 85) return 'A';
    if (overallScore >= 80) return 'B+';
    if (overallScore >= 75) return 'B';
    if (overallScore >= 70) return 'C+';
    if (overallScore >= 65) return 'C';
    if (overallScore >= 60) return 'D';
    return 'F';
  }

  /**
   * Generate comprehensive recommendation
   */
  private generateRecommendation(metrics: {
    overallGrade: string;
    riskLevel: string;
    avgCalmarRatio: number;
    consistencyScore: number;
    kellyPercentage: number;
    pairCount: number;
    statisticalSignificance: boolean;
  }): string {
    const recommendations: string[] = [];

    // Overall assessment
    if (metrics.overallGrade === 'A+') {
      recommendations.push("🏆 EXCEPTIONAL - Deploy with high confidence");
    } else if (metrics.overallGrade === 'A') {
      recommendations.push("🎯 EXCELLENT - Ready for live trading");
    } else if (metrics.overallGrade.startsWith('B')) {
      recommendations.push("✅ GOOD - Suitable with monitoring");
    } else if (metrics.overallGrade.startsWith('C')) {
      recommendations.push("⚠️ MARGINAL - Needs optimization");
    } else {
      recommendations.push("❌ POOR - Avoid or redesign");
    }

    // Position sizing
    if (metrics.kellyPercentage > 0) {
      recommendations.push(`Position: ${(metrics.kellyPercentage * 100).toFixed(1)}%`);
    }

    // Risk warning
    if (metrics.riskLevel === 'Very High') {
      recommendations.push("HIGH RISK - Extreme caution required");
    }

    // Statistical validation
    if (!metrics.statisticalSignificance) {
      recommendations.push("Lacks statistical significance");
    }

    // Portfolio coverage
    if (metrics.pairCount < 5) {
      recommendations.push("Limited pair coverage - test more broadly");
    }

    return recommendations.join(". ");
  }

  /**
   * Display comprehensive results
   */
  displayOptimalParameters(results: OptimalParameterResult[]): void {
    console.log('🏆 TOP 20 OPTIMAL PARAMETER SETS - COMPREHENSIVE ANALYSIS');
    console.log('=' .repeat(150));
    console.log(`${'Rank'.padEnd(6)} ${'Parameters'.padEnd(18)} ${'Grade'.padEnd(6)} ${'Composite'.padEnd(9)} ${'Calmar'.padEnd(7)} ${'Risk'.padEnd(12)} ${'Pairs'.padEnd(6)} ${'Position'.padEnd(8)} ${'Recommendation'.padEnd(35)}`);
    console.log('-'.repeat(150));

    results.slice(0, 20).forEach((result, index) => {
      const rank = `#${index + 1}`;
      const params = `${result.parameters.zScoreThreshold}/${result.parameters.profitPercent}%/${result.parameters.stopLossPercent}%`;
      const grade = result.overallGrade;
      const composite = result.compositeScore.toFixed(1);
      const calmar = result.avgCalmarRatio.toFixed(2);
      const risk = result.riskLevel;
      const pairs = `${result.consistentPairs}/${result.pairCount}`;
      const position = `${(result.recommendedPositionSize * 100).toFixed(1)}%`;
      const rec = result.recommendation.substring(0, 33);

      console.log(`${rank.padEnd(6)} ${params.padEnd(18)} ${grade.padEnd(6)} ${composite.padEnd(9)} ${calmar.padEnd(7)} ${risk.padEnd(12)} ${pairs.padEnd(6)} ${position.padEnd(8)} ${rec.padEnd(35)}`);
    });
  }

  /**
   * Display detailed analysis for top performers
   */
  displayDetailedAnalysis(results: OptimalParameterResult[]): void {
    console.log('\n📊 DETAILED ANALYSIS - TOP 5 OPTIMAL PARAMETER SETS');
    console.log('=' .repeat(100));

    results.slice(0, 5).forEach((result, index) => {
      console.log(`\n🥇 RANK #${index + 1}: ${result.parameters.zScoreThreshold}/${result.parameters.profitPercent}%/${result.parameters.stopLossPercent}% (MA: ${result.parameters.movingAverages})`);
      console.log('   ' + '-'.repeat(70));
      
      console.log(`   🎯 Overall Assessment: Grade ${result.overallGrade} | ${result.recommendation}`);
      
      console.log(`   📈 Performance Metrics:`);
      console.log(`      Calmar Ratio: ${result.avgCalmarRatio.toFixed(3)} (CI: ${result.calmarConfidenceInterval[0].toFixed(2)} - ${result.calmarConfidenceInterval[1].toFixed(2)})`);
      console.log(`      Sharpe Ratio: ${result.avgSharpeRatio.toFixed(3)} | Alpha: ${result.avgAlpha.toFixed(2)}%`);
      console.log(`      Return: ${result.avgAnnualizedReturn.toFixed(1)}% | Drawdown: ${result.avgMaxDrawdown.toFixed(1)}%`);
      console.log(`      Win Rate: ${result.avgWinRatio.toFixed(1)}% | Total Trades: ${result.avgTotalTrades.toLocaleString()}`);
      
      console.log(`   🎲 Portfolio Analysis:`);
      console.log(`      Pair Coverage: ${result.pairCount}/9 pairs | Consistent Pairs: ${result.consistentPairs}/${result.pairCount}`);
      console.log(`      Best/Worst Pair Calmar: ${result.bestPairCalmar.toFixed(2)} / ${result.worstPairCalmar.toFixed(2)}`);
      console.log(`      Calmar Std Dev: ${result.calmarStdDev.toFixed(3)} (Lower = more stable)`);
      
      console.log(`   ⚠️ Risk Assessment:`);
      console.log(`      Risk Level: ${result.riskLevel} | Stability Index: ${result.stabilityIndex.toFixed(1)}/100`);
      console.log(`      Consistency Score: ${result.consistencyScore.toFixed(1)}% positive results`);
      console.log(`      Statistical Significance: ${result.statisticalSignificance ? '✅ Yes' : '❌ No'} (n=${result.sampleSize})`);
      
      console.log(`   💰 Position Sizing:`);
      console.log(`      Kelly %: ${(result.kellyPercentage * 100).toFixed(1)}% | Recommended: ${(result.recommendedPositionSize * 100).toFixed(1)}%`);
      
      console.log(`   📊 Composite Scores:`);
      console.log(`      Overall: ${result.compositeScore.toFixed(1)}/100 | Risk-Adjusted: ${result.riskAdjustedScore.toFixed(1)}/100 | Portfolio: ${result.portfolioScore.toFixed(1)}/100`);
    });
  }

  /**
   * Generate summary insights
   */
  generateSummaryInsights(results: OptimalParameterResult[]): void {
    console.log('\n🔍 COMPREHENSIVE SUMMARY INSIGHTS');
    console.log('=' .repeat(80));

    if (results.length === 0) {
      console.log('❌ No parameter sets found with sufficient data');
      return;
    }

    const topTier = results.filter(r => r.overallGrade === 'A+' || r.overallGrade === 'A');
    const lowRisk = results.filter(r => r.riskLevel === 'Low' || r.riskLevel === 'Medium');
    const statisticallySignificant = results.filter(r => r.statisticalSignificance);
    const highPortfolio = results.filter(r => r.portfolioScore > 75);

    console.log(`🏆 Strategy Quality Distribution:`);
    console.log(`   Top Tier (A+/A): ${topTier.length}/${results.length} (${(topTier.length/results.length*100).toFixed(1)}%)`);
    console.log(`   Low-Medium Risk: ${lowRisk.length}/${results.length} (${(lowRisk.length/results.length*100).toFixed(1)}%)`);
    console.log(`   Statistically Significant: ${statisticallySignificant.length}/${results.length} (${(statisticallySignificant.length/results.length*100).toFixed(1)}%)`);
    console.log(`   Strong Portfolio Performance: ${highPortfolio.length}/${results.length} (${(highPortfolio.length/results.length*100).toFixed(1)}%)`);

    const best = results[0];
    console.log(`\n🎯 Best Overall Strategy:`);
    console.log(`   Parameters: ${best.parameters.zScoreThreshold}/${best.parameters.profitPercent}%/${best.parameters.stopLossPercent}%`);
    console.log(`   Grade: ${best.overallGrade} | Calmar: ${best.avgCalmarRatio.toFixed(3)} | Risk: ${best.riskLevel}`);
    console.log(`   Portfolio: ${best.consistentPairs}/${best.pairCount} consistent pairs`);

    // Parameter pattern analysis
    const topParameters = results.slice(0, 10);
    const zScores = topParameters.map(p => p.parameters.zScoreThreshold);
    const profits = topParameters.map(p => p.parameters.profitPercent);
    const stops = topParameters.map(p => p.parameters.stopLossPercent);

    console.log(`\n📋 Top 10 Parameter Patterns:`);
    console.log(`   Z-Score Range: ${Math.min(...zScores)} - ${Math.max(...zScores)}`);
    console.log(`   Profit % Range: ${Math.min(...profits)}% - ${Math.max(...profits)}%`);
    console.log(`   Stop Loss % Range: ${Math.min(...stops)}% - ${Math.max(...stops)}%`);

    // Performance benchmarks
    const avgTopCalmar = results.slice(0, 5).reduce((sum, r) => sum + r.avgCalmarRatio, 0) / 5;
    console.log(`\n📊 Performance Benchmarks:`);
    console.log(`   Top 5 Average Calmar: ${avgTopCalmar.toFixed(3)}`);
    console.log(`   Best Single Calmar: ${best.avgCalmarRatio.toFixed(3)}`);

    console.log(`\n💡 Key Recommendations:`);
    if (topTier.length > 0) {
      console.log(`   ✅ ${topTier.length} excellent strategies available - focus on these`);
    }
    if (lowRisk.length >= 5) {
      console.log(`   ✅ Good selection of low-risk options for conservative trading`);
    }
    if (statisticallySignificant.length < results.length * 0.5) {
      console.log(`   ⚠️ Many strategies lack statistical significance - increase sample sizes`);
    }
    console.log(`   🎯 Prioritize parameters with high portfolio scores for diversification`);
    console.log(`   📈 Use recommended position sizes to optimize risk-adjusted returns`);
  }

  /**
   * Utility functions
   */
  private calculateMean(values: number[]): number {
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  private calculateStandardDeviation(values: number[]): number {
    const mean = this.calculateMean(values);
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  private getTValue(confidence: number, df: number): number {
    // Simplified t-table lookup for common confidence levels
    const tTable: Record<number, Record<number, number>> = {
      0.95: { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 10: 2.228, 20: 2.086, 30: 2.042 }
    };
    
    const confidenceTable = tTable[confidence];
    if (!confidenceTable) return 1.96; // Default to normal distribution
    
    // Find closest df
    const dfValues = Object.keys(confidenceTable).map(Number).sort((a, b) => a - b);
    let closestDf = dfValues[dfValues.length - 1];
    for (const dfVal of dfValues) {
      if (df <= dfVal) {
        closestDf = dfVal;
        break;
      }
    }
    
    return confidenceTable[closestDf] || 1.96;
  }

  /**
   * Main execution function
   */
  async run(): Promise<void> {
    try {
      await this.initialize();
      
      // Find optimal parameters using comprehensive analysis
      const optimalParameters = await this.findOptimalParameters();
      
      // Display results
      this.displayOptimalParameters(optimalParameters);
      this.displayDetailedAnalysis(optimalParameters);
      this.generateSummaryInsights(optimalParameters);
      
      console.log('\n✅ Comprehensive parameter optimization analysis complete!');
      console.log('💡 Use these insights to select the best parameter combinations for live trading.');
      
    } catch (error) {
      console.error('❌ Error in parameter optimization analysis:', error);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }
}

// Main execution
async function main() {
  const finder = new OptimalParameterFinder();
  await finder.run();
}

if (require.main === module) {
  main().catch(console.error);
}

export { OptimalParameterFinder };