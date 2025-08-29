#!/usr/bin/env ts-node

/**
 * Query Top Sharpe Ratios - Database Verification
 * 
 * Direct database queries to analyze Sharpe ratio performance
 * and provide insights on risk-adjusted returns across parameter sets.
 * 
 * Usage:
 *   npm run queryTopSharpe                    # All assets, all pairs
 *   npm run queryTopSharpe sharpe             # Sharpe analysis for all assets
 *   npm run queryTopSharpe sharpe ETH         # Sharpe analysis for ETH (all quote assets)
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

class SharpeQuerier {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async initialize(): Promise<void> {
    await this.prisma.$connect();
    console.log('✅ Connected to database');
  }

  /**
   * Find best parameter combinations grouped by parameter set with highest Sharpe ratios
   */
  async findBestParameterCombinations(baseAsset?: string): Promise<void> {
    const title = baseAsset ? 
      `🎯 BEST PARAMETER COMBINATIONS BY SHARPE RATIO (Risk-Adjusted Returns) - ${baseAsset}` :
      '🎯 BEST PARAMETER COMBINATIONS BY SHARPE RATIO (Risk-Adjusted Returns) - ALL ASSETS';
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
    console.log(`📊 Metrics are averaged across ALL backtests in each parameter set (sorted by highest average Sharpe ratio)`);

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

    // Calculate group statistics and sort by average Sharpe ratio
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
      const allSharpe = allResults.map((r: any) => r.sharpeRatio);
      const allReturns = allResults.map((r: any) => r.annualizedReturn);
      const allDrawdowns = allResults.map((r: any) => r.maxDrawdown);
      const allAlpha = allResults.map((r: any) => r.alpha);
      const allWinRatio = allResults.map((r: any) => r.winRatio);
      const allTotalTrades = allResults.reduce((sum: number, r: any) => sum + r.totalTrades, 0);
      
      groupStats.push({
        parameters: `${zScore}/${profit}%/${stop}%`,
        movingAverages: parseInt(movingAvg),
        totalCount: allResults.length,
        qualityCount: qualityResults.length,
        avgSharpe: allSharpe.reduce((sum: number, val: number) => sum + val, 0) / allSharpe.length,
        avgReturn: allReturns.reduce((sum: number, val: number) => sum + val, 0) / allReturns.length,
        avgDrawdown: allDrawdowns.reduce((sum: number, val: number) => sum + val, 0) / allDrawdowns.length,
        avgAlpha: allAlpha.reduce((sum: number, val: number) => sum + val, 0) / allAlpha.length,
        avgWinRatio: allWinRatio.reduce((sum: number, val: number) => sum + val, 0) / allWinRatio.length,
        consistency: (allReturns.filter((r: number) => r > 0).length / allReturns.length) * 100,
        totalTrades: allTotalTrades,
        maxSharpe: Math.max(...allSharpe),
        minSharpe: Math.min(...allSharpe)
      });
    }

    // Sort by average Sharpe ratio (highest first) and show top 20
    groupStats.sort((a, b) => b.avgSharpe - a.avgSharpe);
    const top20 = groupStats.slice(0, 20);

    console.log(`${'Rank'.padEnd(5)} ${'Parameters'.padEnd(15)} ${'MA'.padEnd(4)} ${'Total/Quality'.padEnd(13)} ${'Avg Sharpe'.padEnd(11)} ${'Avg Return%'.padEnd(12)} ${'Avg DD%'.padEnd(9)} ${'Avg Alpha%'.padEnd(11)} ${'Avg Win%'.padEnd(10)} ${'Consistency%'.padEnd(12)}`);
    console.log('-'.repeat(130));

    top20.forEach((group, index) => {
      const rank = `#${index + 1}`;
      const params = group.parameters;
      const ma = group.movingAverages.toString();
      const count = `${group.totalCount}/${group.qualityCount}`;
      const avgSharpe = group.avgSharpe.toFixed(2);
      const avgReturn = group.avgReturn.toFixed(1);
      const avgDD = group.avgDrawdown.toFixed(1);
      const avgAlpha = group.avgAlpha.toFixed(1);
      const avgWin = group.avgWinRatio.toFixed(1);
      const consistency = group.consistency.toFixed(1);

      console.log(`${rank.padEnd(5)} ${params.padEnd(15)} ${ma.padEnd(4)} ${count.padEnd(13)} ${avgSharpe.padEnd(11)} ${avgReturn.padEnd(12)} ${avgDD.padEnd(9)} ${avgAlpha.padEnd(11)} ${avgWin.padEnd(10)} ${consistency.padEnd(12)}`);
    });
  }

  /**
   * Analyze Sharpe ratio distribution
   */
  async analyzeSharpeDistribution(baseAsset?: string): Promise<void> {
    const title = baseAsset ? 
      `📊 SHARPE RATIO DISTRIBUTION ANALYSIS - ${baseAsset}` :
      '📊 SHARPE RATIO DISTRIBUTION ANALYSIS - ALL ASSETS';
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
      _count: { sharpeRatio: true },
      _avg: { sharpeRatio: true },
      _max: { sharpeRatio: true },
      _min: { sharpeRatio: true }
    });

    console.log(`Total Results: ${stats._count.sharpeRatio?.toLocaleString()}`);
    console.log(`Average Sharpe Ratio: ${stats._avg.sharpeRatio ? parseFloat(stats._avg.sharpeRatio.toString()).toFixed(3) : 'N/A'}`);
    console.log(`Maximum Sharpe Ratio: ${stats._max.sharpeRatio ? parseFloat(stats._max.sharpeRatio.toString()).toFixed(3) : 'N/A'}`);
    console.log(`Minimum Sharpe Ratio: ${stats._min.sharpeRatio ? parseFloat(stats._min.sharpeRatio.toString()).toFixed(3) : 'N/A'}`);

    // Distribution by quality ranges
    const ranges = [
      { label: 'Poor (<0)', min: Number.NEGATIVE_INFINITY, max: 0 },
      { label: 'Below Average (0-1)', min: 0, max: 1 },
      { label: 'Average (1-1.5)', min: 1, max: 1.5 },
      { label: 'Good (1.5-2)', min: 1.5, max: 2 },
      { label: 'Very Good (2-3)', min: 2, max: 3 },
      { label: 'Excellent (3+)', min: 3, max: Number.POSITIVE_INFINITY }
    ];

    console.log('\nDistribution by Quality:');
    for (const range of ranges) {
      const rangeWhereClause: any = {
        totalTrades: { gt: 5 }
      };

      if (baseAsset) {
        rangeWhereClause.baseAsset = baseAsset;
      }

      if (range.min !== Number.NEGATIVE_INFINITY) {
        rangeWhereClause.sharpeRatio.gt = range.min;
      }
      if (range.max !== Number.POSITIVE_INFINITY) {
        rangeWhereClause.sharpeRatio.lte = range.max;
      } else {
        rangeWhereClause.sharpeRatio.lte = 999999;
      }

      const count = await this.prisma.optimizationResults.count({
        where: rangeWhereClause
      });

      const percentage = stats._count.sharpeRatio ? (count / stats._count.sharpeRatio * 100).toFixed(1) : '0.0';
      console.log(`   ${range.label.padEnd(20)}: ${count.toString().padStart(4)} (${percentage}%)`);
    }
  }

  /**
   * Main execution function
   */
  async run(): Promise<void> {
    try {
      await this.initialize();
      
      const args = process.argv.slice(2);
      const analysisType = args[0] || 'sharpe';
      const baseAsset = args[1] ? args[1].toUpperCase() : undefined;
      
      if (baseAsset) {
        console.log(`🎯 Running ${analysisType} analysis for baseAsset: ${baseAsset}`);
      } else {
        console.log(`🎯 Running ${analysisType} analysis for all assets`);
      }
      
      await this.findBestParameterCombinations(baseAsset);
      // await this.analyzeSharpeDistribution(baseAsset); // TODO: Fix range filtering
      console.log('\n✅ Sharpe ratio analysis complete!');
      
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
  const querier = new SharpeQuerier();
  await querier.run();
}

if (require.main === module) {
  main().catch(console.error);
}

export { SharpeQuerier };