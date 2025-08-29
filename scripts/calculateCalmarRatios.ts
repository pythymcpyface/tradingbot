#!/usr/bin/env ts-node

/**
 * Calculate Calmar Ratios for All Database Entries
 * 
 * This script calculates and updates Calmar ratios for all existing optimization results,
 * then returns the top 10 parameter sets by average Calmar ratio.
 * 
 * Calmar Ratio = Annualized Return / Max Drawdown
 * 
 * Usage: npm run calculateCalmarRatios
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

interface ParameterSet {
  zScoreThreshold: number;
  profitPercent: number;
  stopLossPercent: number;
  movingAverages: number;
}

interface ParameterSetStats {
  parameters: ParameterSet;
  count: number;
  averageCalmarRatio: number;
  medianCalmarRatio: number;
  bestCalmarRatio: number;
  worstCalmarRatio: number;
  averageAnnualizedReturn: number;
  averageMaxDrawdown: number;
  winRate: number;
  totalTrades: number;
  
  // Risk assessment
  riskLevel: 'Low' | 'Medium' | 'High' | 'Very High';
  consistency: number; // % of runs that are positive
  recommendation: string;
}

class CalmarRatioCalculator {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async initialize(): Promise<void> {
    await this.prisma.$connect();
    console.log('✅ Connected to database');
  }

  /**
   * Calculate and update Calmar ratios for all optimization results
   */
  async calculateAllCalmarRatios(): Promise<void> {
    console.log('🧮 Calculating Calmar ratios for all optimization results...');

    // Get all optimization results
    const results = await this.prisma.optimizationResults.findMany({
      select: {
        id: true,
        annualizedReturn: true,
        maxDrawdown: true,
        calmarRatio: true
      }
    });

    console.log(`   Found ${results.length} optimization results to process...`);

    let updated = 0;
    let skipped = 0;

    // Calculate and update Calmar ratio for each result
    for (const result of results) {
      // Skip if already calculated
      if (result.calmarRatio !== null) {
        skipped++;
        continue;
      }

      const annualizedReturn = parseFloat(result.annualizedReturn.toString());
      const maxDrawdown = parseFloat(result.maxDrawdown.toString());
      
      // Calculate Calmar ratio
      let calmarRatio: number;
      if (maxDrawdown > 0) {
        calmarRatio = annualizedReturn / maxDrawdown;
      } else {
        // Handle edge case: no drawdown (perfect strategy)
        calmarRatio = annualizedReturn > 0 ? 999.9999 : 0;
      }

      // Cap extreme values for database storage
      calmarRatio = Math.min(9999.9999, Math.max(-9999.9999, calmarRatio));

      // Update the record
      await this.prisma.optimizationResults.update({
        where: { id: result.id },
        data: { calmarRatio: calmarRatio }
      });

      updated++;

      if (updated % 100 === 0) {
        console.log(`   ✓ Updated ${updated} records...`);
      }
    }

    console.log(`   ✅ Calmar ratio calculation complete!`);
    console.log(`      Updated: ${updated} records`);
    console.log(`      Skipped: ${skipped} records (already calculated)`);
    console.log(`      Total: ${results.length} records\n`);
  }

  /**
   * Get top 10 parameter sets by average Calmar ratio
   */
  async getTopParameterSetsByCalmarRatio(): Promise<ParameterSetStats[]> {
    console.log('🏆 Finding top 10 parameter sets by average Calmar ratio...');

    // Get all optimization results grouped by parameter set
    const results = await this.prisma.optimizationResults.findMany({
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
        annualizedReturn: true,
        maxDrawdown: true,
        winRatio: true,
        totalTrades: true,
        baseAsset: true,
        quoteAsset: true
      }
    });

    console.log(`   Analyzing ${results.length} optimization results...`);

    // Group by parameter set
    const parameterGroups = new Map<string, any[]>();
    
    for (const result of results) {
      const key = `${result.zScoreThreshold}_${result.profitPercent}_${result.stopLossPercent}_${result.movingAverages}`;
      
      if (!parameterGroups.has(key)) {
        parameterGroups.set(key, []);
      }
      
      parameterGroups.get(key)!.push({
        ...result,
        calmarRatio: parseFloat(result.calmarRatio!.toString()),
        annualizedReturn: parseFloat(result.annualizedReturn.toString()),
        maxDrawdown: parseFloat(result.maxDrawdown.toString()),
        winRatio: parseFloat(result.winRatio.toString())
      });
    }

    console.log(`   Found ${parameterGroups.size} unique parameter combinations...`);

    // Calculate statistics for each parameter set
    const parameterStats: ParameterSetStats[] = [];

    for (const [key, groupResults] of parameterGroups.entries()) {
      // Only include parameter sets with at least 3 results for reliability
      if (groupResults.length < 3) continue;

      const [zScore, profit, stop, movingAvg] = key.split('_').map(parseFloat);
      
      const calmarRatios = groupResults.map(r => r.calmarRatio).sort((a, b) => a - b);
      const annualizedReturns = groupResults.map(r => r.annualizedReturn);
      const maxDrawdowns = groupResults.map(r => r.maxDrawdown);
      const winRatios = groupResults.map(r => r.winRatio);
      const totalTradesAll = groupResults.map(r => r.totalTrades);

      // Calculate statistics
      const averageCalmarRatio = calmarRatios.reduce((sum, val) => sum + val, 0) / calmarRatios.length;
      const medianCalmarRatio = calmarRatios[Math.floor(calmarRatios.length / 2)];
      const bestCalmarRatio = Math.max(...calmarRatios);
      const worstCalmarRatio = Math.min(...calmarRatios);
      
      const averageAnnualizedReturn = annualizedReturns.reduce((sum, val) => sum + val, 0) / annualizedReturns.length;
      const averageMaxDrawdown = maxDrawdowns.reduce((sum, val) => sum + val, 0) / maxDrawdowns.length;
      const averageWinRate = winRatios.reduce((sum, val) => sum + val, 0) / winRatios.length;
      const totalTrades = totalTradesAll.reduce((sum, val) => sum + val, 0);

      // Calculate consistency (% of positive returns)
      const positiveReturns = annualizedReturns.filter(r => r > 0).length;
      const consistency = (positiveReturns / annualizedReturns.length) * 100;

      // Risk assessment
      const riskLevel = this.assessRiskLevel(averageMaxDrawdown, averageCalmarRatio);
      const recommendation = this.generateRecommendation(averageCalmarRatio, riskLevel, consistency);

      parameterStats.push({
        parameters: {
          zScoreThreshold: zScore,
          profitPercent: profit,
          stopLossPercent: stop,
          movingAverages: movingAvg
        },
        count: groupResults.length,
        averageCalmarRatio,
        medianCalmarRatio,
        bestCalmarRatio,
        worstCalmarRatio,
        averageAnnualizedReturn,
        averageMaxDrawdown,
        winRate: averageWinRate,
        totalTrades,
        riskLevel,
        consistency,
        recommendation
      });
    }

    // Sort by average Calmar ratio (descending) and return top 10
    return parameterStats
      .sort((a, b) => b.averageCalmarRatio - a.averageCalmarRatio)
      .slice(0, 10);
  }

  /**
   * Assess risk level based on drawdown and Calmar ratio
   */
  private assessRiskLevel(maxDrawdown: number, calmarRatio: number): 'Low' | 'Medium' | 'High' | 'Very High' {
    if (maxDrawdown < 10 && calmarRatio > 3) return 'Low';
    if (maxDrawdown < 15 && calmarRatio > 2) return 'Medium';
    if (maxDrawdown < 25 && calmarRatio > 1) return 'High';
    return 'Very High';
  }

  /**
   * Generate recommendation based on metrics
   */
  private generateRecommendation(calmarRatio: number, riskLevel: string, consistency: number): string {
    if (calmarRatio > 5 && riskLevel === 'Low' && consistency > 80) {
      return 'Excellent - Deploy with confidence';
    } else if (calmarRatio > 3 && consistency > 70) {
      return 'Good - Suitable for live trading';
    } else if (calmarRatio > 2 && consistency > 60) {
      return 'Acceptable - Monitor closely';
    } else if (calmarRatio > 1) {
      return 'Marginal - Consider improvements';
    } else {
      return 'Poor - Avoid or redesign';
    }
  }

  /**
   * Display top parameter sets
   */
  displayTopParameterSets(topSets: ParameterSetStats[]): void {
    console.log('\n🏆 TOP 10 PARAMETER SETS BY AVERAGE CALMAR RATIO');
    console.log('=' .repeat(120));
    console.log(`${'Rank'.padEnd(6)} ${'Parameters'.padEnd(20)} ${'Avg Calmar'.padEnd(11)} ${'Return%'.padEnd(8)} ${'Drawdown%'.padEnd(10)} ${'Risk'.padEnd(12)} ${'Consistency%'.padEnd(12)} ${'Recommendation'.padEnd(25)}`);
    console.log('-'.repeat(120));

    topSets.forEach((set, index) => {
      const rank = `#${index + 1}`;
      const params = `${set.parameters.zScoreThreshold}/${set.parameters.profitPercent}%/${set.parameters.stopLossPercent}%`;
      const avgCalmar = set.averageCalmarRatio.toFixed(3);
      const avgReturn = set.averageAnnualizedReturn.toFixed(1);
      const avgDrawdown = set.averageMaxDrawdown.toFixed(1);
      const risk = set.riskLevel;
      const consistency = set.consistency.toFixed(1);
      const recommendation = set.recommendation.substring(0, 23);

      console.log(`${rank.padEnd(6)} ${params.padEnd(20)} ${avgCalmar.padEnd(11)} ${avgReturn.padEnd(8)} ${avgDrawdown.padEnd(10)} ${risk.padEnd(12)} ${consistency.padEnd(12)} ${recommendation.padEnd(25)}`);
    });
  }

  /**
   * Display detailed analysis for top parameter sets
   */
  displayDetailedAnalysis(topSets: ParameterSetStats[]): void {
    console.log('\n📊 DETAILED ANALYSIS - TOP 5 PARAMETER SETS');
    console.log('=' .repeat(80));

    for (let i = 0; i < Math.min(5, topSets.length); i++) {
      const set = topSets[i];
      
      console.log(`\n🥇 RANK #${i + 1}: ${set.parameters.zScoreThreshold}/${set.parameters.profitPercent}%/${set.parameters.stopLossPercent}%`);
      console.log(`   Moving Averages: ${set.parameters.movingAverages}`);
      console.log(`   Sample Size: ${set.count} backtests`);
      console.log('   ' + '-'.repeat(50));
      console.log(`   📈 Performance Metrics:`);
      console.log(`      Average Calmar Ratio: ${set.averageCalmarRatio.toFixed(3)} (${set.averageCalmarRatio > 3 ? 'Excellent' : set.averageCalmarRatio > 2 ? 'Good' : 'Fair'})`);
      console.log(`      Median Calmar Ratio: ${set.medianCalmarRatio.toFixed(3)}`);
      console.log(`      Best/Worst Calmar: ${set.bestCalmarRatio.toFixed(3)} / ${set.worstCalmarRatio.toFixed(3)}`);
      console.log(`      Average Return: ${set.averageAnnualizedReturn.toFixed(1)}% annually`);
      console.log(`      Average Drawdown: ${set.averageMaxDrawdown.toFixed(1)}%`);
      console.log(`      Win Rate: ${set.winRate.toFixed(1)}%`);
      console.log(`      Total Trades: ${set.totalTrades.toLocaleString()}`);
      
      console.log(`   ⚠️  Risk Assessment:`);
      console.log(`      Risk Level: ${set.riskLevel}`);
      console.log(`      Consistency: ${set.consistency.toFixed(1)}% (positive results)`);
      
      console.log(`   💡 Recommendation: ${set.recommendation}`);
      
      // Performance grade
      const grade = set.averageCalmarRatio > 5 ? 'A+' : 
                   set.averageCalmarRatio > 3 ? 'A' :
                   set.averageCalmarRatio > 2 ? 'B+' :
                   set.averageCalmarRatio > 1 ? 'B' : 'C';
      console.log(`   🎯 Overall Grade: ${grade}`);
    }
  }

  /**
   * Generate summary insights
   */
  generateSummaryInsights(topSets: ParameterSetStats[]): void {
    console.log('\n🔍 SUMMARY INSIGHTS');
    console.log('=' .repeat(80));

    if (topSets.length === 0) {
      console.log('❌ No parameter sets found with sufficient data');
      return;
    }

    const bestSet = topSets[0];
    const avgCalmarOfTop5 = topSets.slice(0, 5).reduce((sum, set) => sum + set.averageCalmarRatio, 0) / Math.min(5, topSets.length);
    const lowRiskSets = topSets.filter(set => set.riskLevel === 'Low' || set.riskLevel === 'Medium').length;
    const highConsistencySets = topSets.filter(set => set.consistency > 75).length;

    console.log(`🏆 Best Parameter Set:`);
    console.log(`   Z-Score: ${bestSet.parameters.zScoreThreshold}, Profit: ${bestSet.parameters.profitPercent}%, Stop: ${bestSet.parameters.stopLossPercent}%`);
    console.log(`   Calmar Ratio: ${bestSet.averageCalmarRatio.toFixed(3)} (${bestSet.recommendation})`);
    
    console.log(`\n📊 Overall Statistics:`);
    console.log(`   Top 5 Average Calmar Ratio: ${avgCalmarOfTop5.toFixed(3)}`);
    console.log(`   Low-Medium Risk Sets: ${lowRiskSets}/10 (${(lowRiskSets/10*100).toFixed(0)}%)`);
    console.log(`   High Consistency Sets: ${highConsistencySets}/10 (${(highConsistencySets/10*100).toFixed(0)}%)`);

    // Identify patterns
    const zScores = topSets.map(set => set.parameters.zScoreThreshold);
    const profits = topSets.map(set => set.parameters.profitPercent);
    const stops = topSets.map(set => set.parameters.stopLossPercent);

    console.log(`\n📋 Parameter Patterns in Top 10:`);
    console.log(`   Z-Score Range: ${Math.min(...zScores)} - ${Math.max(...zScores)}`);
    console.log(`   Profit % Range: ${Math.min(...profits)}% - ${Math.max(...profits)}%`);
    console.log(`   Stop Loss % Range: ${Math.min(...stops)}% - ${Math.max(...stops)}%`);

    console.log(`\n💡 Key Takeaways:`);
    if (bestSet.averageCalmarRatio > 5) {
      console.log(`   ✅ Excellent strategies available with Calmar ratios > 5`);
    }
    if (lowRiskSets >= 5) {
      console.log(`   ✅ Good selection of low-risk parameter sets`);
    }
    if (highConsistencySets >= 5) {
      console.log(`   ✅ Multiple consistent strategies (>75% positive results)`);
    }
    console.log(`   🎯 Focus on parameters around the top performers for optimization`);
  }

  /**
   * Main execution function
   */
  async run(): Promise<void> {
    try {
      await this.initialize();
      
      // Step 1: Calculate Calmar ratios for all entries
      await this.calculateAllCalmarRatios();
      
      // Step 2: Get top 10 parameter sets
      const topParameterSets = await this.getTopParameterSetsByCalmarRatio();
      
      // Step 3: Display results
      this.displayTopParameterSets(topParameterSets);
      this.displayDetailedAnalysis(topParameterSets);
      this.generateSummaryInsights(topParameterSets);
      
      console.log('\n✅ Calmar ratio analysis complete!');
      
    } catch (error) {
      console.error('❌ Error in Calmar ratio calculation:', error);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }
}

// Main execution
async function main() {
  const calculator = new CalmarRatioCalculator();
  await calculator.run();
}

if (require.main === module) {
  main().catch(console.error);
}

export { CalmarRatioCalculator };