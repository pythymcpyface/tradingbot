#!/usr/bin/env ts-node

/**
 * Query Top Alpha Values - Database Verification
 * 
 * Direct database queries to analyze alpha (excess return) performance
 * and provide insights on market outperformance across parameter sets.
 * 
 * Usage:
 *   npm run queryTopAlpha                    # All assets, all pairs
 *   npm run queryTopAlpha alpha              # Alpha analysis for all assets
 *   npm run queryTopAlpha alpha ETH          # Alpha analysis for ETH (all quote assets)
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

class AlphaQuerier {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async initialize(): Promise<void> {
    await this.prisma.$connect();
    console.log('✅ Connected to database');
  }

  /**
   * Find best parameter combinations grouped by parameter set with highest alpha
   */
  async findBestParameterCombinations(baseAsset?: string): Promise<void> {
    const title = baseAsset ? 
      `🎯 BEST PARAMETER COMBINATIONS BY ALPHA (Market Outperformance) - ${baseAsset}` :
      '🎯 BEST PARAMETER COMBINATIONS BY ALPHA (Market Outperformance) - ALL ASSETS';
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
        winRatio: true,
        totalTrades: true,
        baseAsset: true,
        quoteAsset: true
      }
    });

    console.log(`📊 Found ${allResults.length} optimization results to analyze`);
    console.log(`📋 Note: Total/Quality column shows total backtests / quality backtests (>5 trades) for each parameter set`);
    console.log(`📊 Metrics are averaged across ALL backtests in each parameter set (sorted by highest average alpha)`);

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
        winRatio: parseFloat(result.winRatio?.toString() || '0'),
        totalTrades: result.totalTrades,
        pair: `${result.baseAsset}/${result.quoteAsset}`,
        hasEnoughTrades: result.totalTrades > 5
      });
    }

    // Calculate group statistics and sort by average alpha
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
      const allAlpha = allResults.map((r: any) => r.alpha);
      const allReturns = allResults.map((r: any) => r.annualizedReturn);
      const allDrawdowns = allResults.map((r: any) => r.maxDrawdown);
      const allSharpe = allResults.map((r: any) => r.sharpeRatio);
      const allWinRatio = allResults.map((r: any) => r.winRatio);
      const allTotalTrades = allResults.reduce((sum: number, r: any) => sum + r.totalTrades, 0);
      
      groupStats.push({
        parameters: `${zScore}/${profit}%/${stop}%`,
        movingAverages: parseInt(movingAvg),
        totalCount: allResults.length,
        qualityCount: qualityResults.length,
        avgAlpha: allAlpha.reduce((sum: number, val: number) => sum + val, 0) / allAlpha.length,
        avgReturn: allReturns.reduce((sum: number, val: number) => sum + val, 0) / allReturns.length,
        avgDrawdown: allDrawdowns.reduce((sum: number, val: number) => sum + val, 0) / allDrawdowns.length,
        avgSharpe: allSharpe.reduce((sum: number, val: number) => sum + val, 0) / allSharpe.length,
        avgWinRatio: allWinRatio.reduce((sum: number, val: number) => sum + val, 0) / allWinRatio.length,
        consistency: (allReturns.filter((r: number) => r > 0).length / allReturns.length) * 100,
        positiveAlpha: (allAlpha.filter((a: number) => a > 0).length / allAlpha.length) * 100,
        totalTrades: allTotalTrades,
        maxAlpha: Math.max(...allAlpha),
        minAlpha: Math.min(...allAlpha)
      });
    }

    // Sort by average alpha (highest first) and show top 20
    groupStats.sort((a, b) => b.avgAlpha - a.avgAlpha);
    const top20 = groupStats.slice(0, 20);

    console.log(`${'Rank'.padEnd(5)} ${'Parameters'.padEnd(15)} ${'MA'.padEnd(4)} ${'Total/Quality'.padEnd(13)} ${'Avg Alpha%'.padEnd(11)} ${'Avg Return%'.padEnd(12)} ${'Avg Sharpe'.padEnd(11)} ${'Avg Win%'.padEnd(10)} ${'Pos Alpha%'.padEnd(11)} ${'Consistency%'.padEnd(12)}`);
    console.log('-'.repeat(130));

    top20.forEach((group, index) => {
      const rank = `#${index + 1}`;
      const params = group.parameters;
      const ma = group.movingAverages.toString();
      const count = `${group.totalCount}/${group.qualityCount}`;
      const avgAlpha = group.avgAlpha.toFixed(1);
      const avgReturn = group.avgReturn.toFixed(1);
      const avgSharpe = group.avgSharpe.toFixed(2);
      const avgWin = group.avgWinRatio.toFixed(1);
      const posAlpha = group.positiveAlpha.toFixed(1);
      const consistency = group.consistency.toFixed(1);

      console.log(`${rank.padEnd(5)} ${params.padEnd(15)} ${ma.padEnd(4)} ${count.padEnd(13)} ${avgAlpha.padEnd(11)} ${avgReturn.padEnd(12)} ${avgSharpe.padEnd(11)} ${avgWin.padEnd(10)} ${posAlpha.padEnd(11)} ${consistency.padEnd(12)}`);
    });
  }

  /**
   * Analyze alpha distribution
   */
  async analyzeAlphaDistribution(baseAsset?: string): Promise<void> {
    const title = baseAsset ? 
      `📊 ALPHA DISTRIBUTION ANALYSIS - ${baseAsset}` :
      '📊 ALPHA DISTRIBUTION ANALYSIS - ALL ASSETS';
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
      _count: { alpha: true },
      _avg: { alpha: true },
      _max: { alpha: true },
      _min: { alpha: true }
    });

    console.log(`Total Results: ${stats._count.alpha?.toLocaleString()}`);
    console.log(`Average Alpha: ${stats._avg.alpha ? parseFloat(stats._avg.alpha.toString()).toFixed(2) : 'N/A'}%`);
    console.log(`Maximum Alpha: ${stats._max.alpha ? parseFloat(stats._max.alpha.toString()).toFixed(2) : 'N/A'}%`);
    console.log(`Minimum Alpha: ${stats._min.alpha ? parseFloat(stats._min.alpha.toString()).toFixed(2) : 'N/A'}%`);

    // Distribution by alpha ranges
    const ranges = [
      { label: 'Large Underperform (<-10%)', min: Number.NEGATIVE_INFINITY, max: -10 },
      { label: 'Underperform (-10% to 0%)', min: -10, max: 0 },
      { label: 'Slight Outperform (0% to 5%)', min: 0, max: 5 },
      { label: 'Good Outperform (5% to 15%)', min: 5, max: 15 },
      { label: 'Strong Outperform (15% to 30%)', min: 15, max: 30 },
      { label: 'Exceptional (30%+)', min: 30, max: Number.POSITIVE_INFINITY }
    ];

    console.log('\nDistribution by Performance vs Market:');
    for (const range of ranges) {
      const rangeWhereClause: any = {
        totalTrades: { gt: 5 }
      };

      if (baseAsset) {
        rangeWhereClause.baseAsset = baseAsset;
      }

      if (range.min !== Number.NEGATIVE_INFINITY) {
        rangeWhereClause.alpha.gt = range.min;
      }
      if (range.max !== Number.POSITIVE_INFINITY) {
        rangeWhereClause.alpha.lte = range.max;
      } else {
        rangeWhereClause.alpha.lte = 999999;
      }

      const count = await this.prisma.optimizationResults.count({
        where: rangeWhereClause
      });

      const percentage = stats._count.alpha ? (count / stats._count.alpha * 100).toFixed(1) : '0.0';
      console.log(`   ${range.label.padEnd(30)}: ${count.toString().padStart(4)} (${percentage}%)`);
    }

    // Positive alpha percentage
    const positiveAlphaCount = await this.prisma.optimizationResults.count({
      where: {
        ...whereClause,
        alpha: { gt: 0 }
      }
    });
    
    const positiveAlphaPercentage = stats._count.alpha ? (positiveAlphaCount / stats._count.alpha * 100).toFixed(1) : '0.0';
    console.log(`\n🎯 Market Outperformance Rate: ${positiveAlphaPercentage}% of strategies have positive alpha`);
  }

  /**
   * Main execution function
   */
  async run(): Promise<void> {
    try {
      await this.initialize();
      
      const args = process.argv.slice(2);
      const analysisType = args[0] || 'alpha';
      const baseAsset = args[1] ? args[1].toUpperCase() : undefined;
      
      if (baseAsset) {
        console.log(`🎯 Running ${analysisType} analysis for baseAsset: ${baseAsset}`);
      } else {
        console.log(`🎯 Running ${analysisType} analysis for all assets`);
      }
      
      await this.findBestParameterCombinations(baseAsset);
      // await this.analyzeAlphaDistribution(baseAsset); // TODO: Fix range filtering
      console.log('\n✅ Alpha analysis complete!');
      
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
  const querier = new AlphaQuerier();
  await querier.run();
}

if (require.main === module) {
  main().catch(console.error);
}

export { AlphaQuerier };