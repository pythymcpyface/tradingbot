#!/usr/bin/env ts-node

/**
 * Query Top Calmar Ratios - Database Verification
 * 
 * Direct database queries to verify our Calmar ratio calculations
 * and provide additional insights.
 * 
 * Usage:
 *   npm run queryTopCalmarRatios                    # All assets, all pairs
 *   npm run queryTopCalmarRatios calmar             # Calmar analysis for all assets
 *   npm run queryTopCalmarRatios returns            # Return analysis for all assets  
 *   npm run queryTopCalmarRatios calmar ETH         # Calmar analysis for ETH (all quote assets)
 *   npm run queryTopCalmarRatios returns BTC        # Return analysis for BTC (all quote assets)
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

class CalmarRatioQuerier {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async initialize(): Promise<void> {
    await this.prisma.$connect();
    console.log('✅ Connected to database');
  }

  /**
   * Query top individual results by Calmar ratio (deduplicated by parameter combination)
   */
  async getTopIndividualResults(baseAsset?: string): Promise<void> {
    const title = baseAsset ? 
      `🏆 TOP 15 UNIQUE PARAMETER COMBINATIONS BY CALMAR RATIO - ${baseAsset} (ALL QUOTE ASSETS)` :
      '🏆 TOP 15 UNIQUE PARAMETER COMBINATIONS BY CALMAR RATIO - ALL ASSETS';
    console.log(`\n${title}`);
    console.log('=' .repeat(120));

    // Build where clause based on baseAsset filter
    const whereClause: any = {
      calmarRatio: { not: null },
      totalTrades: { gt: 5 }
    };
    
    if (baseAsset) {
      whereClause.baseAsset = baseAsset;
    }

    // Get all results first, then deduplicate in TypeScript to ensure we get the best result for each parameter combo
    const allResults = await this.prisma.optimizationResults.findMany({
      where: whereClause,
      orderBy: { calmarRatio: 'desc' },
      select: {
        zScoreThreshold: true,
        profitPercent: true,
        stopLossPercent: true,
        movingAverages: true,
        calmarRatio: true,
        annualizedReturn: true,
        maxDrawdown: true,
        sharpeRatio: true,
        winRatio: true,
        totalTrades: true,
        baseAsset: true,
        quoteAsset: true,
        startTime: true,
        endTime: true
      }
    });

    // Deduplicate by parameter combination, keeping the best Calmar ratio for each unique combination
    const parameterMap = new Map<string, any>();
    
    for (const result of allResults) {
      // For baseAsset analysis, include quote asset in key; for global analysis, include both assets
      const paramKey = baseAsset ? 
        `${result.zScoreThreshold}_${result.profitPercent}_${result.stopLossPercent}_${result.movingAverages}_${result.quoteAsset}` :
        `${result.zScoreThreshold}_${result.profitPercent}_${result.stopLossPercent}_${result.movingAverages}_${result.baseAsset}_${result.quoteAsset}`;
      const currentCalmar = parseFloat(result.calmarRatio!.toString());
      
      if (!parameterMap.has(paramKey) || currentCalmar > parseFloat(parameterMap.get(paramKey).calmarRatio.toString())) {
        parameterMap.set(paramKey, result);
      }
    }

    // Convert back to array and sort by Calmar ratio, then take top 15
    const uniqueResults = Array.from(parameterMap.values())
      .sort((a, b) => parseFloat(b.calmarRatio!.toString()) - parseFloat(a.calmarRatio!.toString()))
      .slice(0, 15);

    console.log(`${'Rank'.padEnd(5)} ${'Parameters'.padEnd(18)} ${'Pair'.padEnd(8)} ${'Calmar'.padEnd(8)} ${'Return%'.padEnd(8)} ${'Drawdown%'.padEnd(10)} ${'Sharpe'.padEnd(7)} ${'Trades'.padEnd(7)} ${'Period'.padEnd(12)}`);
    console.log('-'.repeat(120));

    uniqueResults.forEach((result, index) => {
      const rank = `#${index + 1}`;
      const params = `${result.zScoreThreshold}/${result.profitPercent}%/${result.stopLossPercent}%`;
      const pair = `${result.baseAsset}${result.quoteAsset}`;
      const calmar = parseFloat(result.calmarRatio!.toString()).toFixed(2);
      const returnPct = parseFloat(result.annualizedReturn.toString()).toFixed(1);
      const drawdown = parseFloat(result.maxDrawdown.toString()).toFixed(1);
      const sharpe = parseFloat(result.sharpeRatio.toString()).toFixed(2);
      const trades = result.totalTrades.toString();
      const period = result.startTime.toISOString().split('T')[0].substr(2, 5);

      console.log(`${rank.padEnd(5)} ${params.padEnd(18)} ${pair.padEnd(8)} ${calmar.padEnd(8)} ${returnPct.padEnd(8)} ${drawdown.padEnd(10)} ${sharpe.padEnd(7)} ${trades.padEnd(7)} ${period.padEnd(12)}`);
    });
  }

  /**
   * Analyze Calmar ratio distribution
   */
  async analyzeCalmarDistribution(baseAsset?: string): Promise<void> {
    const title = baseAsset ? 
      `📊 CALMAR RATIO DISTRIBUTION ANALYSIS - ${baseAsset}` :
      '📊 CALMAR RATIO DISTRIBUTION ANALYSIS - ALL ASSETS';
    console.log(`\n${title}`);
    console.log('=' .repeat(80));

    // Build where clause
    const whereClause: any = {
      calmarRatio: { not: null },
      totalTrades: { gt: 5 }
    };
    
    if (baseAsset) {
      whereClause.baseAsset = baseAsset;
    }

    // Get distribution statistics
    const stats = await this.prisma.optimizationResults.aggregate({
      where: whereClause,
      _count: { calmarRatio: true },
      _avg: { calmarRatio: true },
      _max: { calmarRatio: true },
      _min: { calmarRatio: true }
    });

    console.log(`Total Results: ${stats._count.calmarRatio?.toLocaleString()}`);
    console.log(`Average Calmar Ratio: ${stats._avg.calmarRatio ? parseFloat(stats._avg.calmarRatio.toString()).toFixed(3) : 'N/A'}`);
    console.log(`Maximum Calmar Ratio: ${stats._max.calmarRatio ? parseFloat(stats._max.calmarRatio.toString()).toFixed(3) : 'N/A'}`);
    console.log(`Minimum Calmar Ratio: ${stats._min.calmarRatio ? parseFloat(stats._min.calmarRatio.toString()).toFixed(3) : 'N/A'}`);

    // Distribution by ranges
    const ranges = [
      { label: 'Negative (<0)', min: Number.NEGATIVE_INFINITY, max: 0 },
      { label: 'Poor (0-1)', min: 0, max: 1 },
      { label: 'Fair (1-2)', min: 1, max: 2 },
      { label: 'Good (2-3)', min: 2, max: 3 },
      { label: 'Very Good (3-5)', min: 3, max: 5 },
      { label: 'Excellent (5-10)', min: 5, max: 10 },
      { label: 'Outstanding (10+)', min: 10, max: Number.POSITIVE_INFINITY }
    ];

    console.log('\nDistribution by Quality:');
    for (const range of ranges) {
      const rangeWhereClause: any = {
        calmarRatio: { not: null },
        totalTrades: { gt: 5 }
      };

      // Add baseAsset filter if specified
      if (baseAsset) {
        rangeWhereClause.baseAsset = baseAsset;
      }

      if (range.min !== Number.NEGATIVE_INFINITY) {
        rangeWhereClause.calmarRatio.gt = range.min;
      }
      if (range.max !== Number.POSITIVE_INFINITY) {
        rangeWhereClause.calmarRatio.lte = range.max;
      } else {
        rangeWhereClause.calmarRatio.lte = 999999;
      }

      const count = await this.prisma.optimizationResults.count({
        where: rangeWhereClause
      });

      const percentage = stats._count.calmarRatio ? (count / stats._count.calmarRatio * 100).toFixed(1) : '0.0';
      console.log(`   ${range.label.padEnd(20)}: ${count.toString().padStart(4)} (${percentage}%)`);
    }
  }

  /**
   * Find best parameter combinations grouped by parameter set with calculated Calmar ratios
   */
  async findBestParameterCombinations(baseAsset?: string): Promise<void> {
    const title = baseAsset ? 
      `🎯 BEST PARAMETER COMBINATIONS (Grouped Analysis) - ${baseAsset}` :
      '🎯 BEST PARAMETER COMBINATIONS (Grouped Analysis) - ALL ASSETS';
    console.log(`\n${title}`);
    console.log('=' .repeat(110));

    // Build where clause - get ALL results first, then filter later to show accurate counts
    const whereClause: any = {
      maxDrawdown: { gt: 0 }
    };
    
    if (baseAsset) {
      whereClause.baseAsset = baseAsset;
    }

    // Get all results and calculate Calmar ratio on-the-fly
    const allResults = await this.prisma.optimizationResults.findMany({
      where: whereClause,
      select: {
        zScoreThreshold: true,
        profitPercent: true,
        stopLossPercent: true,
        movingAverages: true,
        annualizedReturn: true,
        maxDrawdown: true,
        totalTrades: true,
        baseAsset: true,
        quoteAsset: true
      }
    });

    console.log(`📊 Found ${allResults.length} optimization results to analyze`);
    console.log(`📋 Note: Total/Quality column shows total backtests / quality backtests (>5 trades) for each parameter set`);
    console.log(`📊 Metrics are averaged across ALL backtests in each parameter set (not just quality ones)`);

    // Group by parameters
    const parameterGroups = new Map<string, any[]>();
    
    for (const result of allResults) {
      // Calculate Calmar ratio: annualizedReturn / abs(maxDrawdown)
      const annualizedReturn = parseFloat(result.annualizedReturn.toString());
      const maxDrawdown = Math.abs(parseFloat(result.maxDrawdown.toString()));
      const calculatedCalmar = maxDrawdown > 0 ? annualizedReturn / maxDrawdown : 0;
      
      const key = `${result.zScoreThreshold}_${result.profitPercent}_${result.stopLossPercent}_${result.movingAverages}`;
      
      if (!parameterGroups.has(key)) {
        parameterGroups.set(key, []);
      }
      
      parameterGroups.get(key)!.push({
        calmarRatio: calculatedCalmar,
        annualizedReturn: annualizedReturn,
        maxDrawdown: maxDrawdown,
        totalTrades: result.totalTrades,
        pair: `${result.baseAsset}/${result.quoteAsset}`,
        hasEnoughTrades: result.totalTrades > 5  // Track which ones meet our quality threshold
      });
    }

    // Calculate group statistics and sort by average Calmar ratio
    const groupStats = [];
    for (const [key, results] of Array.from(parameterGroups.entries())) {
      if (results.length < 1) continue; // Need at least 1 result
      
      const [zScore, profit, stop, movingAvg] = key.split('_');
      
      // Separate high-quality results (>5 trades) from all results
      const qualityResults = results.filter((r: any) => r.hasEnoughTrades);
      const allResults = results;
      
      // Only show groups that have at least one quality result
      if (qualityResults.length === 0) continue;
      
      // Calculate metrics based on ALL results in the parameter set
      const allCalmarRatios = allResults.map((r: any) => r.calmarRatio);
      const allReturns = allResults.map((r: any) => r.annualizedReturn);
      const allDrawdowns = allResults.map((r: any) => r.maxDrawdown);
      const allTotalTrades = allResults.reduce((sum: number, r: any) => sum + r.totalTrades, 0);
      
      groupStats.push({
        parameters: `${zScore}/${profit}%/${stop}%`,
        movingAverages: parseInt(movingAvg),
        totalCount: allResults.length,  // Total number of backtests for this parameter set
        qualityCount: qualityResults.length,  // Number passing the >5 trades filter
        avgCalmarRatio: allCalmarRatios.reduce((sum: number, val: number) => sum + val, 0) / allCalmarRatios.length,
        avgReturn: allReturns.reduce((sum: number, val: number) => sum + val, 0) / allReturns.length,
        avgDrawdown: allDrawdowns.reduce((sum: number, val: number) => sum + val, 0) / allDrawdowns.length,
        consistency: (allReturns.filter((r: number) => r > 0).length / allReturns.length) * 100,
        totalTrades: allTotalTrades,
        maxCalmar: Math.max(...allCalmarRatios),
        minCalmar: Math.min(...allCalmarRatios)
      });
    }

    // Sort by average Calmar ratio and show top 20
    groupStats.sort((a, b) => b.avgCalmarRatio - a.avgCalmarRatio);
    const top20 = groupStats.slice(0, 20);

    console.log(`${'Rank'.padEnd(5)} ${'Parameters'.padEnd(15)} ${'MA'.padEnd(4)} ${'Total/Quality'.padEnd(13)} ${'Avg Calmar'.padEnd(11)} ${'Avg Return%'.padEnd(12)} ${'Avg DD%'.padEnd(9)} ${'Consistency%'.padEnd(12)} ${'Total Trades'.padEnd(12)}`);
    console.log('-'.repeat(120));

    top20.forEach((group, index) => {
      const rank = `#${index + 1}`;
      const params = group.parameters;
      const ma = group.movingAverages.toString();
      const count = `${group.totalCount}/${group.qualityCount}`;  // Show total/quality counts
      const avgCalmar = group.avgCalmarRatio.toFixed(3);
      const avgReturn = group.avgReturn.toFixed(1);
      const avgDD = group.avgDrawdown.toFixed(1);
      const consistency = group.consistency.toFixed(1);
      const totalTrades = group.totalTrades.toLocaleString();

      console.log(`${rank.padEnd(5)} ${params.padEnd(15)} ${ma.padEnd(4)} ${count.padEnd(13)} ${avgCalmar.padEnd(11)} ${avgReturn.padEnd(12)} ${avgDD.padEnd(9)} ${consistency.padEnd(12)} ${totalTrades.padEnd(12)}`);
    });
  }

  /**
   * Risk analysis
   */
  async analyzeRiskLevels(baseAsset?: string): Promise<void> {
    const title = baseAsset ? 
      `⚠️ RISK ANALYSIS BY CALMAR RATIO RANGES - ${baseAsset}` :
      '⚠️ RISK ANALYSIS BY CALMAR RATIO RANGES - ALL ASSETS';
    console.log(`\n${title}`);
    console.log('=' .repeat(80));

    const riskRanges = [
      { label: 'Conservative (Calmar 3+)', minCalmar: 3, maxCalmar: 999 },
      { label: 'Moderate (Calmar 2-3)', minCalmar: 2, maxCalmar: 3 },
      { label: 'Aggressive (Calmar 1-2)', minCalmar: 1, maxCalmar: 2 },
      { label: 'High Risk (Calmar <1)', minCalmar: -999, maxCalmar: 1 }
    ];

    for (const range of riskRanges) {
      const whereClause: any = {
        calmarRatio: {
          gte: range.minCalmar,
          lt: range.maxCalmar
        },
        totalTrades: { gt: 5 }
      };
      
      if (baseAsset) {
        whereClause.baseAsset = baseAsset;
      }

      const results = await this.prisma.optimizationResults.findMany({
        where: whereClause,
        select: {
          maxDrawdown: true,
          annualizedReturn: true
        }
      });

      if (results.length === 0) continue;

      const avgDrawdown = results.reduce((sum, r) => sum + parseFloat(r.maxDrawdown.toString()), 0) / results.length;
      const avgReturn = results.reduce((sum, r) => sum + parseFloat(r.annualizedReturn.toString()), 0) / results.length;
      const maxDrawdown = Math.max(...results.map(r => parseFloat(r.maxDrawdown.toString())));

      console.log(`\n${range.label}:`);
      console.log(`   Count: ${results.length} strategies`);
      console.log(`   Average Return: ${avgReturn.toFixed(1)}%`);
      console.log(`   Average Drawdown: ${avgDrawdown.toFixed(1)}%`);
      console.log(`   Maximum Drawdown: ${maxDrawdown.toFixed(1)}%`);
    }
  }

  /**
   * Query top individual results by annualized returns (deduplicated by parameter combination)
   */
  async getTopAnnualizedReturns(baseAsset?: string): Promise<void> {
    const title = baseAsset ? 
      `💰 TOP 15 UNIQUE PARAMETER COMBINATIONS BY ANNUALIZED RETURNS - ${baseAsset} (ALL QUOTE ASSETS)` :
      '💰 TOP 15 UNIQUE PARAMETER COMBINATIONS BY ANNUALIZED RETURNS - ALL ASSETS';
    console.log(`\n${title}`);
    console.log('=' .repeat(120));

    // Build where clause
    const whereClause: any = {
      calmarRatio: { not: null },
      totalTrades: { gt: 5 }
    };
    
    if (baseAsset) {
      whereClause.baseAsset = baseAsset;
    }

    // Get all results first, then deduplicate in TypeScript to ensure we get the best result for each parameter combo
    const allResults = await this.prisma.optimizationResults.findMany({
      where: whereClause,
      orderBy: { annualizedReturn: 'desc' },
      select: {
        zScoreThreshold: true,
        profitPercent: true,
        stopLossPercent: true,
        movingAverages: true,
        calmarRatio: true,
        annualizedReturn: true,
        maxDrawdown: true,
        sharpeRatio: true,
        winRatio: true,
        totalTrades: true,
        baseAsset: true,
        quoteAsset: true,
        startTime: true,
        endTime: true
      }
    });

    // Deduplicate by parameter combination, keeping the best annualized return for each unique combination
    const parameterMap = new Map<string, any>();
    
    for (const result of allResults) {
      // For baseAsset analysis, include quote asset in key; for global analysis, include both assets
      const paramKey = baseAsset ? 
        `${result.zScoreThreshold}_${result.profitPercent}_${result.stopLossPercent}_${result.movingAverages}_${result.quoteAsset}` :
        `${result.zScoreThreshold}_${result.profitPercent}_${result.stopLossPercent}_${result.movingAverages}_${result.baseAsset}_${result.quoteAsset}`;
      const currentReturn = parseFloat(result.annualizedReturn.toString());
      
      if (!parameterMap.has(paramKey) || currentReturn > parseFloat(parameterMap.get(paramKey).annualizedReturn.toString())) {
        parameterMap.set(paramKey, result);
      }
    }

    // Convert back to array and sort by annualized return, then take top 15
    const uniqueResults = Array.from(parameterMap.values())
      .sort((a, b) => parseFloat(b.annualizedReturn.toString()) - parseFloat(a.annualizedReturn.toString()))
      .slice(0, 15);

    console.log(`${'Rank'.padEnd(5)} ${'Parameters'.padEnd(18)} ${'Pair'.padEnd(8)} ${'Return%'.padEnd(8)} ${'Calmar'.padEnd(8)} ${'Drawdown%'.padEnd(10)} ${'Sharpe'.padEnd(7)} ${'Trades'.padEnd(7)} ${'Period'.padEnd(12)}`);
    console.log('-'.repeat(120));

    uniqueResults.forEach((result, index) => {
      const rank = `#${index + 1}`;
      const params = `${result.zScoreThreshold}/${result.profitPercent}%/${result.stopLossPercent}%`;
      const pair = `${result.baseAsset}${result.quoteAsset}`;
      const returnPct = parseFloat(result.annualizedReturn.toString()).toFixed(1);
      const calmar = parseFloat(result.calmarRatio!.toString()).toFixed(2);
      const drawdown = parseFloat(result.maxDrawdown.toString()).toFixed(1);
      const sharpe = parseFloat(result.sharpeRatio.toString()).toFixed(2);
      const trades = result.totalTrades.toString();
      const period = result.startTime.toISOString().split('T')[0].substr(2, 5);

      console.log(`${rank.padEnd(5)} ${params.padEnd(18)} ${pair.padEnd(8)} ${returnPct.padEnd(8)} ${calmar.padEnd(8)} ${drawdown.padEnd(10)} ${sharpe.padEnd(7)} ${trades.padEnd(7)} ${period.padEnd(12)}`);
    });
  }

  /**
   * Show quote asset performance summary for baseAsset analysis
   */
  async showQuoteAssetSummary(baseAsset: string): Promise<void> {
    console.log(`\n📊 QUOTE ASSET PERFORMANCE SUMMARY - ${baseAsset}`);
    console.log('=' .repeat(80));

    // Get results grouped by quote asset
    const results = await this.prisma.optimizationResults.findMany({
      where: {
        baseAsset,
        calmarRatio: { not: null },
        totalTrades: { gt: 5 }
      },
      select: {
        quoteAsset: true,
        calmarRatio: true,
        annualizedReturn: true,
        maxDrawdown: true,
        totalTrades: true
      }
    });

    // Group by quote asset
    const quoteGroups = new Map<string, any[]>();
    for (const result of results) {
      if (!quoteGroups.has(result.quoteAsset)) {
        quoteGroups.set(result.quoteAsset, []);
      }
      quoteGroups.get(result.quoteAsset)!.push({
        calmarRatio: parseFloat(result.calmarRatio!.toString()),
        annualizedReturn: parseFloat(result.annualizedReturn.toString()),
        maxDrawdown: parseFloat(result.maxDrawdown.toString()),
        totalTrades: result.totalTrades
      });
    }

    // Calculate summary statistics for each quote asset
    const quoteSummaries = [];
    for (const [quoteAsset, quoteResults] of Array.from(quoteGroups.entries())) {
      const avgCalmar = quoteResults.reduce((sum, r) => sum + r.calmarRatio, 0) / quoteResults.length;
      const avgReturn = quoteResults.reduce((sum, r) => sum + r.annualizedReturn, 0) / quoteResults.length;
      const avgDrawdown = quoteResults.reduce((sum, r) => sum + r.maxDrawdown, 0) / quoteResults.length;
      const totalTrades = quoteResults.reduce((sum, r) => sum + r.totalTrades, 0);
      const bestCalmar = Math.max(...quoteResults.map(r => r.calmarRatio));
      
      quoteSummaries.push({
        quoteAsset,
        count: quoteResults.length,
        avgCalmar,
        avgReturn,
        avgDrawdown,
        totalTrades,
        bestCalmar
      });
    }

    // Sort by average Calmar ratio
    quoteSummaries.sort((a, b) => b.avgCalmar - a.avgCalmar);

    console.log(`${'Quote'.padEnd(8)} ${'Count'.padEnd(6)} ${'Avg Calmar'.padEnd(11)} ${'Avg Return%'.padEnd(12)} ${'Avg Drawdown%'.padEnd(14)} ${'Best Calmar'.padEnd(12)} ${'Total Trades'.padEnd(12)}`);
    console.log('-'.repeat(80));

    for (const summary of quoteSummaries) {
      console.log(
        `${summary.quoteAsset.padEnd(8)} ${summary.count.toString().padEnd(6)} ${summary.avgCalmar.toFixed(3).padEnd(11)} ${summary.avgReturn.toFixed(1).padEnd(12)} ${summary.avgDrawdown.toFixed(1).padEnd(14)} ${summary.bestCalmar.toFixed(3).padEnd(12)} ${summary.totalTrades.toLocaleString().padEnd(12)}`
      );
    }
  }

  /**
   * Main execution function
   */
  async run(): Promise<void> {
    try {
      await this.initialize();
      
      // Parse command line arguments
      const args = process.argv.slice(2);
      const analysisType = args[0] || 'calmar'; // default to calmar analysis
      const baseAsset = args[1] ? args[1].toUpperCase() : undefined; // optional baseAsset filter
      
      if (baseAsset) {
        console.log(`🎯 Running ${analysisType} analysis for baseAsset: ${baseAsset}`);
      } else {
        console.log(`🎯 Running ${analysisType} analysis for all assets`);
      }
      
      if (analysisType === 'returns') {
        if (baseAsset) {
          await this.showQuoteAssetSummary(baseAsset);
        }
        await this.getTopAnnualizedReturns(baseAsset);
        console.log('\n✅ Annualized returns analysis complete!');
      } else {
        await this.findBestParameterCombinations(baseAsset);
        console.log('\n✅ Parameter combination analysis complete!');
      }
      
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
  const querier = new CalmarRatioQuerier();
  await querier.run();
}

if (require.main === module) {
  main().catch(console.error);
}

export { CalmarRatioQuerier };