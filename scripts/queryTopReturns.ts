#!/usr/bin/env ts-node

/**
 * Query Top Returns - Database Verification
 * 
 * Direct database queries to analyze annualized return performance
 * and provide insights on absolute returns across parameter sets.
 * 
 * Usage:
 *   npm run queryTopReturns                    # All assets, all pairs
 *   npm run queryTopReturns returns            # Returns analysis for all assets
 *   npm run queryTopReturns returns ETH        # Returns analysis for ETH (all quote assets)
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

class ReturnsQuerier {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async initialize(): Promise<void> {
    await this.prisma.$connect();
    console.log('✅ Connected to database');
  }

  /**
   * Find best parameter combinations grouped by parameter set with highest returns
   */
  async findBestParameterCombinations(baseAsset?: string): Promise<void> {
    const title = baseAsset ? 
      `🎯 BEST PARAMETER COMBINATIONS BY ANNUALIZED RETURNS - ${baseAsset}` :
      '🎯 BEST PARAMETER COMBINATIONS BY ANNUALIZED RETURNS - ALL ASSETS';
    console.log(`\n${title}`);
    console.log('=' .repeat(120));

    // Build where clause - get ALL results first, then filter later to show accurate counts
    const whereClause: any = {};
    
    if (baseAsset) {
      whereClause.baseAsset = baseAsset;
    }

    // Get all results
    const allResults = await this.prisma.optimizationResults.findMany({
      where: whereClause,
      select: {
        zScoreThreshold: true,
        profitPercent: true,
        stopLossPercent: true,
        movingAverages: true,
        annualizedReturn: true,
        maxDrawdown: true,
        sharpeRatio: true,
        alpha: true,
        calmarRatio: true,
        winRatio: true,
        totalTrades: true,
        baseAsset: true,
        quoteAsset: true
      }
    });

    console.log(`📊 Found ${allResults.length} optimization results to analyze`);
    console.log(`📋 Note: Total/Quality column shows total backtests / quality backtests (>5 trades) for each parameter set`);
    console.log(`📊 Metrics are averaged across ALL backtests in each parameter set (sorted by highest average return)`);

    // Group by parameters
    const parameterGroups = new Map<string, any[]>();
    
    for (const result of allResults) {
      const key = `${result.zScoreThreshold}_${result.profitPercent}_${result.stopLossPercent}_${result.movingAverages}`;
      
      if (!parameterGroups.has(key)) {
        parameterGroups.set(key, []);
      }
      
      parameterGroups.get(key)!.push({
        annualizedReturn: parseFloat(result.annualizedReturn.toString()),
        maxDrawdown: Math.abs(parseFloat(result.maxDrawdown.toString())),
        sharpeRatio: parseFloat(result.sharpeRatio?.toString() || '0'),
        alpha: parseFloat(result.alpha?.toString() || '0'),
        calmarRatio: result.calmarRatio ? parseFloat(result.calmarRatio.toString()) : 0,
        winRatio: parseFloat(result.winRatio?.toString() || '0'),
        totalTrades: result.totalTrades,
        pair: `${result.baseAsset}/${result.quoteAsset}`,
        hasEnoughTrades: result.totalTrades > 5
      });
    }

    // Calculate group statistics and sort by average return
    const groupStats = [];
    for (const [key, results] of Array.from(parameterGroups.entries())) {
      if (results.length < 1) continue;
      
      const [zScore, profit, stop, movingAvg] = key.split('_');
      
      // Separate high-quality results (>5 trades) from all results
      const qualityResults = results.filter((r: any) => r.hasEnoughTrades);
      const allResults = results;
      
      // Only show groups that have at least one quality result
      if (qualityResults.length === 0) continue;
      
      // Calculate metrics based on ALL results in the parameter set
      const allReturns = allResults.map((r: any) => r.annualizedReturn);
      const allDrawdowns = allResults.map((r: any) => r.maxDrawdown);
      const allSharpe = allResults.map((r: any) => r.sharpeRatio);
      const allAlpha = allResults.map((r: any) => r.alpha);
      const allCalmar = allResults.filter((r: any) => r.calmarRatio !== 0).map((r: any) => r.calmarRatio);
      const allWinRatio = allResults.map((r: any) => r.winRatio);
      const allTotalTrades = allResults.reduce((sum: number, r: any) => sum + r.totalTrades, 0);
      
      groupStats.push({
        parameters: `${zScore}/${profit}%/${stop}%`,
        movingAverages: parseInt(movingAvg),
        totalCount: allResults.length,
        qualityCount: qualityResults.length,
        avgReturn: allReturns.reduce((sum: number, val: number) => sum + val, 0) / allReturns.length,
        avgDrawdown: allDrawdowns.reduce((sum: number, val: number) => sum + val, 0) / allDrawdowns.length,
        avgSharpe: allSharpe.reduce((sum: number, val: number) => sum + val, 0) / allSharpe.length,
        avgAlpha: allAlpha.reduce((sum: number, val: number) => sum + val, 0) / allAlpha.length,
        avgCalmar: allCalmar.length > 0 ? allCalmar.reduce((sum: number, val: number) => sum + val, 0) / allCalmar.length : 0,
        avgWinRatio: allWinRatio.reduce((sum: number, val: number) => sum + val, 0) / allWinRatio.length,
        consistency: (allReturns.filter((r: number) => r > 0).length / allReturns.length) * 100,
        totalTrades: allTotalTrades,
        maxReturn: Math.max(...allReturns),
        minReturn: Math.min(...allReturns),
        volatility: this.calculateStandardDeviation(allReturns)
      });
    }

    // Sort by average return (highest first) and show top 20
    groupStats.sort((a, b) => b.avgReturn - a.avgReturn);
    const top20 = groupStats.slice(0, 20);

    console.log(`${'Rank'.padEnd(5)} ${'Parameters'.padEnd(15)} ${'MA'.padEnd(4)} ${'Total/Quality'.padEnd(13)} ${'Avg Return%'.padEnd(12)} ${'Avg DD%'.padEnd(9)} ${'Avg Sharpe'.padEnd(11)} ${'Avg Calmar'.padEnd(11)} ${'Consistency%'.padEnd(12)} ${'Volatility%'.padEnd(12)}`);
    console.log('-'.repeat(140));

    top20.forEach((group, index) => {
      const rank = `#${index + 1}`;
      const params = group.parameters;
      const ma = group.movingAverages.toString();
      const count = `${group.totalCount}/${group.qualityCount}`;
      const avgReturn = group.avgReturn.toFixed(1);
      const avgDD = group.avgDrawdown.toFixed(1);
      const avgSharpe = group.avgSharpe.toFixed(2);
      const avgCalmar = group.avgCalmar.toFixed(2);
      const consistency = group.consistency.toFixed(1);
      const volatility = group.volatility.toFixed(1);

      console.log(`${rank.padEnd(5)} ${params.padEnd(15)} ${ma.padEnd(4)} ${count.padEnd(13)} ${avgReturn.padEnd(12)} ${avgDD.padEnd(9)} ${avgSharpe.padEnd(11)} ${avgCalmar.padEnd(11)} ${consistency.padEnd(12)} ${volatility.padEnd(12)}`);
    });
  }

  /**
   * Calculate standard deviation for volatility measure
   */
  private calculateStandardDeviation(numbers: number[]): number {
    const mean = numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
    const squareDiffs = numbers.map(n => Math.pow(n - mean, 2));
    return Math.sqrt(squareDiffs.reduce((sum, n) => sum + n, 0) / squareDiffs.length);
  }

  /**
   * Analyze returns distribution
   */
  async analyzeReturnsDistribution(baseAsset?: string): Promise<void> {
    const title = baseAsset ? 
      `📊 RETURNS DISTRIBUTION ANALYSIS - ${baseAsset}` :
      '📊 RETURNS DISTRIBUTION ANALYSIS - ALL ASSETS';
    console.log(`\n${title}`);
    console.log('=' .repeat(80));

    const whereClause: any = {
      totalTrades: { gt: 5 }
    };
    
    if (baseAsset) {
      whereClause.baseAsset = baseAsset;
    }

    const stats = await this.prisma.optimizationResults.aggregate({
      where: whereClause,
      _count: { annualizedReturn: true },
      _avg: { annualizedReturn: true },
      _max: { annualizedReturn: true },
      _min: { annualizedReturn: true }
    });

    console.log(`Total Results: ${stats._count.annualizedReturn?.toLocaleString()}`);
    console.log(`Average Return: ${stats._avg.annualizedReturn ? parseFloat(stats._avg.annualizedReturn.toString()).toFixed(2) : 'N/A'}%`);
    console.log(`Maximum Return: ${stats._max.annualizedReturn ? parseFloat(stats._max.annualizedReturn.toString()).toFixed(2) : 'N/A'}%`);
    console.log(`Minimum Return: ${stats._min.annualizedReturn ? parseFloat(stats._min.annualizedReturn.toString()).toFixed(2) : 'N/A'}%`);

    // Distribution by return ranges
    const ranges = [
      { label: 'Large Loss (<-50%)', min: Number.NEGATIVE_INFINITY, max: -50 },
      { label: 'Moderate Loss (-50% to -20%)', min: -50, max: -20 },
      { label: 'Small Loss (-20% to 0%)', min: -20, max: 0 },
      { label: 'Small Gain (0% to 20%)', min: 0, max: 20 },
      { label: 'Moderate Gain (20% to 50%)', min: 20, max: 50 },
      { label: 'Large Gain (50% to 100%)', min: 50, max: 100 },
      { label: 'Exceptional (100%+)', min: 100, max: Number.POSITIVE_INFINITY }
    ];

    console.log('\nDistribution by Return Range:');
    for (const range of ranges) {
      const rangeWhereClause: any = {
        totalTrades: { gt: 5 }
      };

      if (baseAsset) {
        rangeWhereClause.baseAsset = baseAsset;
      }

      if (range.min !== Number.NEGATIVE_INFINITY) {
        rangeWhereClause.annualizedReturn = { gt: range.min };
        if (range.max !== Number.POSITIVE_INFINITY) {
          rangeWhereClause.annualizedReturn.lte = range.max;
        }
      } else if (range.max !== Number.POSITIVE_INFINITY) {
        rangeWhereClause.annualizedReturn = { lte: range.max };
      }

      const count = await this.prisma.optimizationResults.count({
        where: rangeWhereClause
      });

      const percentage = stats._count.annualizedReturn ? (count / stats._count.annualizedReturn * 100).toFixed(1) : '0.0';
      console.log(`   ${range.label.padEnd(30)}: ${count.toString().padStart(4)} (${percentage}%)`);
    }

    // Profitability rate
    const positiveReturnCount = await this.prisma.optimizationResults.count({
      where: {
        ...whereClause,
        annualizedReturn: { gt: 0 }
      }
    });
    
    const profitabilityRate = stats._count.annualizedReturn ? (positiveReturnCount / stats._count.annualizedReturn * 100).toFixed(1) : '0.0';
    console.log(`\n🎯 Profitability Rate: ${profitabilityRate}% of strategies are profitable`);
  }

  /**
   * Show risk-adjusted performance summary
   */
  async showRiskAdjustedSummary(baseAsset?: string): Promise<void> {
    console.log(`\n📊 RISK-ADJUSTED PERFORMANCE SUMMARY`);
    console.log('=' .repeat(80));

    const whereClause: any = {
      annualizedReturn: { not: null },
      maxDrawdown: { not: null },
      sharpeRatio: { not: null },
      totalTrades: { gt: 5 }
    };
    
    if (baseAsset) {
      whereClause.baseAsset = baseAsset;
    }

    // Find strategies with good risk-adjusted returns
    const results = await this.prisma.optimizationResults.findMany({
      where: {
        ...whereClause,
        annualizedReturn: { gt: 10 }, // At least 10% return
        maxDrawdown: { gt: -30 }, // Max 30% drawdown
        sharpeRatio: { gt: 1 } // At least 1.0 Sharpe ratio
      },
      select: {
        zScoreThreshold: true,
        profitPercent: true,
        stopLossPercent: true,
        movingAverages: true,
        annualizedReturn: true,
        maxDrawdown: true,
        sharpeRatio: true,
        alpha: true,
        baseAsset: true,
        quoteAsset: true
      },
      take: 10,
      orderBy: { annualizedReturn: 'desc' }
    });

    console.log(`Found ${results.length} strategies with good risk-adjusted returns (>10% return, <30% DD, Sharpe >1.0):`);
    console.log('');
    console.log(`${'Parameters'.padEnd(18)} ${'Pair'.padEnd(8)} ${'Return%'.padEnd(8)} ${'DD%'.padEnd(6)} ${'Sharpe'.padEnd(7)} ${'Alpha%'.padEnd(8)}`);
    console.log('-'.repeat(65));

    results.forEach(result => {
      const params = `${result.zScoreThreshold}/${result.profitPercent}%/${result.stopLossPercent}%`;
      const pair = `${result.baseAsset}${result.quoteAsset}`;
      const returnPct = parseFloat(result.annualizedReturn.toString()).toFixed(1);
      const drawdown = Math.abs(parseFloat(result.maxDrawdown.toString())).toFixed(1);
      const sharpe = parseFloat(result.sharpeRatio.toString()).toFixed(2);
      const alpha = result.alpha ? parseFloat(result.alpha.toString()).toFixed(1) : 'N/A';

      console.log(`${params.padEnd(18)} ${pair.padEnd(8)} ${returnPct.padEnd(8)} ${drawdown.padEnd(6)} ${sharpe.padEnd(7)} ${alpha.padEnd(8)}`);
    });
  }

  /**
   * Main execution function
   */
  async run(): Promise<void> {
    try {
      await this.initialize();
      
      const args = process.argv.slice(2);
      const analysisType = args[0] || 'returns';
      const baseAsset = args[1] ? args[1].toUpperCase() : undefined;
      
      if (baseAsset) {
        console.log(`🎯 Running ${analysisType} analysis for baseAsset: ${baseAsset}`);
      } else {
        console.log(`🎯 Running ${analysisType} analysis for all assets`);
      }
      
      await this.findBestParameterCombinations(baseAsset);
      // await this.analyzeReturnsDistribution(baseAsset); // TODO: Fix range filtering
      // await this.showRiskAdjustedSummary(baseAsset);
      console.log('\n✅ Returns analysis complete!');
      
    } catch (error) {
      console.error('❌ Error in analysis:', error);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }
}

// Main execution
async function main() {
  const querier = new ReturnsQuerier();
  await querier.run();
}

if (require.main === module) {
  main().catch(console.error);
}

export { ReturnsQuerier };