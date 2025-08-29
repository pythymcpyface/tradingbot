#!/usr/bin/env ts-node

/**
 * Compare Top Performers - Returns vs Risk-Adjusted
 * 
 * Shows side-by-side comparison of highest returns vs best Calmar ratios
 * to highlight the difference between raw performance and risk-adjusted performance.
 * 
 * Usage:
 *   npm run compareTopPerformers                    # Compare all assets globally
 *   npm run compareTopPerformers ETH                # Compare ETH across all quote assets
 *   npm run compareTopPerformers BTC                # Compare BTC across all quote assets
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

class PerformanceComparator {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async initialize(): Promise<void> {
    await this.prisma.$connect();
    console.log('✅ Connected to database');
  }

  /**
   * Get top performers by metric (deduplicated)
   */
  async getTopPerformers(metric: 'annualizedReturn' | 'calmarRatio', limit: number = 10, baseAsset?: string): Promise<any[]> {
    const whereClause: any = {
      calmarRatio: { not: null },
      totalTrades: { gt: 5 }
    };
    
    if (baseAsset) {
      whereClause.baseAsset = baseAsset;
    }

    const allResults = await this.prisma.optimizationResults.findMany({
      where: whereClause,
      orderBy: { [metric]: 'desc' },
      select: {
        zScoreThreshold: true,
        profitPercent: true,
        stopLossPercent: true,
        movingAverages: true,
        calmarRatio: true,
        annualizedReturn: true,
        maxDrawdown: true,
        sharpeRatio: true,
        totalTrades: true,
        baseAsset: true,
        quoteAsset: true,
        startTime: true
      }
    });

    // Deduplicate by parameter combination
    const parameterMap = new Map<string, any>();
    
    for (const result of allResults) {
      // For baseAsset analysis, include quote asset in key; for global analysis, include both assets
      const paramKey = baseAsset ? 
        `${result.zScoreThreshold}_${result.profitPercent}_${result.stopLossPercent}_${result.movingAverages}_${result.quoteAsset}` :
        `${result.zScoreThreshold}_${result.profitPercent}_${result.stopLossPercent}_${result.movingAverages}_${result.baseAsset}_${result.quoteAsset}`;
      const currentValue = parseFloat(result[metric]!.toString());
      
      if (!parameterMap.has(paramKey) || currentValue > parseFloat(parameterMap.get(paramKey)[metric].toString())) {
        parameterMap.set(paramKey, result);
      }
    }

    // Convert back to array and sort, then take top N
    return Array.from(parameterMap.values())
      .sort((a, b) => parseFloat(b[metric]!.toString()) - parseFloat(a[metric]!.toString()))
      .slice(0, limit);
  }

  /**
   * Display comparison table
   */
  async compareTopPerformers(baseAsset?: string): Promise<void> {
    const title = baseAsset ? 
      `🚀 PERFORMANCE COMPARISON: RAW RETURNS vs RISK-ADJUSTED - ${baseAsset} (ALL QUOTE ASSETS)` :
      '🚀 PERFORMANCE COMPARISON: RAW RETURNS vs RISK-ADJUSTED - ALL ASSETS';
    console.log(`\n${title}`);
    console.log('=' .repeat(140));

    const topReturns = await this.getTopPerformers('annualizedReturn', 10, baseAsset);
    const topCalmar = await this.getTopPerformers('calmarRatio', 10, baseAsset);

    console.log(`\n${'HIGHEST RETURNS'.padEnd(70)} ${'BEST RISK-ADJUSTED (CALMAR)'.padEnd(70)}`);
    console.log(`${'Parameters | Return% | Drawdown%'.padEnd(70)} ${'Parameters | Calmar | Return%'.padEnd(70)}`);
    console.log('-'.repeat(140));

    const maxRows = Math.max(topReturns.length, topCalmar.length);
    
    for (let i = 0; i < maxRows; i++) {
      const returnResult = i < topReturns.length ? topReturns[i] : null;
      const calmarResult = i < topCalmar.length ? topCalmar[i] : null;
      
      let returnStr = '';
      let calmarStr = '';
      
      if (returnResult) {
        const returnParams = `${returnResult.zScoreThreshold}/${returnResult.profitPercent}%/${returnResult.stopLossPercent}%`;
        const returnPct = parseFloat(returnResult.annualizedReturn.toString()).toFixed(1);
        const returnDraw = parseFloat(returnResult.maxDrawdown.toString()).toFixed(1);
        returnStr = `#${i+1} ${returnParams.padEnd(15)} | ${returnPct.padEnd(6)}% | ${returnDraw.padEnd(6)}%`;
      }
      
      if (calmarResult) {
        const calmarParams = `${calmarResult.zScoreThreshold}/${calmarResult.profitPercent}%/${calmarResult.stopLossPercent}%`;
        const calmarRatio = parseFloat(calmarResult.calmarRatio!.toString()).toFixed(2);
        const calmarReturn = parseFloat(calmarResult.annualizedReturn.toString()).toFixed(1);
        calmarStr = `#${i+1} ${calmarParams.padEnd(15)} | ${calmarRatio.padEnd(5)} | ${calmarReturn.padEnd(6)}%`;
      }
      
      console.log(`${returnStr.padEnd(70)} ${calmarStr.padEnd(70)}`);
    }
  }

  /**
   * Analyze overlap between top performers
   */
  async analyzeOverlap(baseAsset?: string): Promise<void> {
    const title = baseAsset ? 
      `🔍 OVERLAP ANALYSIS - ${baseAsset}` :
      '🔍 OVERLAP ANALYSIS - ALL ASSETS';
    console.log(`\n${title}`);
    console.log('=' .repeat(80));

    const topReturns = await this.getTopPerformers('annualizedReturn', 15, baseAsset);
    const topCalmar = await this.getTopPerformers('calmarRatio', 15, baseAsset);

    const returnParams = new Set(topReturns.map(r => `${r.zScoreThreshold}/${r.profitPercent}%/${r.stopLossPercent}%`));
    const calmarParams = new Set(topCalmar.map(r => `${r.zScoreThreshold}/${r.profitPercent}%/${r.stopLossPercent}%`));

    const overlap = new Set(Array.from(returnParams).filter(x => calmarParams.has(x)));
    const onlyReturns = new Set(Array.from(returnParams).filter(x => !calmarParams.has(x)));
    const onlyCalmar = new Set(Array.from(calmarParams).filter(x => !returnParams.has(x)));

    console.log(`Strategies in BOTH top 15 lists: ${overlap.size} (${(overlap.size/15*100).toFixed(1)}%)`);
    if (overlap.size > 0) {
      console.log('   Overlap strategies:', Array.from(overlap).join(', '));
    }

    console.log(`\nStrategies ONLY in top returns: ${onlyReturns.size} (${(onlyReturns.size/15*100).toFixed(1)}%)`);
    if (onlyReturns.size > 0) {
      console.log('   Returns-only:', Array.from(onlyReturns).slice(0, 5).join(', '), onlyReturns.size > 5 ? '...' : '');
    }

    console.log(`\nStrategies ONLY in top Calmar: ${onlyCalmar.size} (${(onlyCalmar.size/15*100).toFixed(1)}%)`);
    if (onlyCalmar.size > 0) {
      console.log('   Calmar-only:', Array.from(onlyCalmar).slice(0, 5).join(', '), onlyCalmar.size > 5 ? '...' : '');
    }
  }

  /**
   * Show risk analysis comparison
   */
  async showRiskComparison(baseAsset?: string): Promise<void> {
    const title = baseAsset ? 
      `⚠️ RISK ANALYSIS COMPARISON - ${baseAsset}` :
      '⚠️ RISK ANALYSIS COMPARISON - ALL ASSETS';
    console.log(`\n${title}`);
    console.log('=' .repeat(80));

    const topReturns = await this.getTopPerformers('annualizedReturn', 10, baseAsset);
    const topCalmar = await this.getTopPerformers('calmarRatio', 10, baseAsset);

    // Calculate averages for top returns strategies
    const avgReturnReturn = topReturns.reduce((sum, r) => sum + parseFloat(r.annualizedReturn.toString()), 0) / topReturns.length;
    const avgReturnDrawdown = topReturns.reduce((sum, r) => sum + parseFloat(r.maxDrawdown.toString()), 0) / topReturns.length;
    const avgReturnCalmar = topReturns.reduce((sum, r) => sum + parseFloat(r.calmarRatio!.toString()), 0) / topReturns.length;

    // Calculate averages for top Calmar strategies  
    const avgCalmarReturn = topCalmar.reduce((sum, r) => sum + parseFloat(r.annualizedReturn.toString()), 0) / topCalmar.length;
    const avgCalmarDrawdown = topCalmar.reduce((sum, r) => sum + parseFloat(r.maxDrawdown.toString()), 0) / topCalmar.length;
    const avgCalmarCalmar = topCalmar.reduce((sum, r) => sum + parseFloat(r.calmarRatio!.toString()), 0) / topCalmar.length;

    console.log(`${'Metric'.padEnd(25)} ${'Top Returns'.padEnd(15)} ${'Top Calmar'.padEnd(15)} ${'Difference'.padEnd(15)}`);
    console.log('-'.repeat(80));
    console.log(`${'Average Return %'.padEnd(25)} ${avgReturnReturn.toFixed(1).padEnd(15)} ${avgCalmarReturn.toFixed(1).padEnd(15)} ${(avgReturnReturn - avgCalmarReturn).toFixed(1).padEnd(15)}`);
    console.log(`${'Average Drawdown %'.padEnd(25)} ${avgReturnDrawdown.toFixed(1).padEnd(15)} ${avgCalmarDrawdown.toFixed(1).padEnd(15)} ${(avgReturnDrawdown - avgCalmarDrawdown).toFixed(1).padEnd(15)}`);
    console.log(`${'Average Calmar Ratio'.padEnd(25)} ${avgReturnCalmar.toFixed(2).padEnd(15)} ${avgCalmarCalmar.toFixed(2).padEnd(15)} ${(avgCalmarCalmar - avgReturnCalmar).toFixed(2).padEnd(15)}`);

    console.log('\n💡 KEY INSIGHTS:');
    console.log(`   • High-return strategies have ${(avgReturnReturn - avgCalmarReturn).toFixed(1)}% higher returns`);
    console.log(`   • But also ${(avgReturnDrawdown - avgCalmarDrawdown).toFixed(1)}% higher drawdowns`);
    console.log(`   • Calmar-optimized strategies have ${(avgCalmarCalmar - avgReturnCalmar).toFixed(2)}x better risk-adjusted performance`);
    
    if (avgReturnDrawdown > avgCalmarDrawdown * 1.5) {
      console.log(`   • ⚠️  High-return strategies have SIGNIFICANTLY higher risk`);
    }
    if (avgCalmarCalmar > avgReturnCalmar * 2) {
      console.log(`   • ✅ Risk-adjusted strategies are clearly superior for sustainable trading`);
    }
  }

  /**
   * Compare performance across quote assets for a specific baseAsset
   */
  async compareQuoteAssetPerformance(baseAsset: string): Promise<void> {
    console.log(`\n📊 QUOTE ASSET PERFORMANCE COMPARISON - ${baseAsset}`);
    console.log('=' .repeat(100));

    // Get top performers for each quote asset
    const allResults = await this.prisma.optimizationResults.findMany({
      where: {
        baseAsset,
        calmarRatio: { not: null },
        totalTrades: { gt: 5 }
      },
      orderBy: { calmarRatio: 'desc' },
      select: {
        quoteAsset: true,
        zScoreThreshold: true,
        profitPercent: true,
        stopLossPercent: true,
        calmarRatio: true,
        annualizedReturn: true,
        maxDrawdown: true,
        sharpeRatio: true
      }
    });

    // Group by quote asset and find best performer for each
    const quoteGroups = new Map<string, any[]>();
    for (const result of allResults) {
      if (!quoteGroups.has(result.quoteAsset)) {
        quoteGroups.set(result.quoteAsset, []);
      }
      quoteGroups.get(result.quoteAsset)!.push(result);
    }

    // Get best strategy for each quote asset
    const quoteBestStrategies = [];
    for (const [quoteAsset, results] of Array.from(quoteGroups.entries())) {
      const bestByCalmar = results[0]; // Already sorted by Calmar desc
      const bestByReturn = results.sort((a, b) => parseFloat(b.annualizedReturn.toString()) - parseFloat(a.annualizedReturn.toString()))[0];
      
      quoteBestStrategies.push({
        quoteAsset,
        count: results.length,
        bestCalmarStrategy: {
          params: `${bestByCalmar.zScoreThreshold}/${bestByCalmar.profitPercent}%/${bestByCalmar.stopLossPercent}%`,
          calmarRatio: parseFloat(bestByCalmar.calmarRatio!.toString()),
          annualizedReturn: parseFloat(bestByCalmar.annualizedReturn.toString()),
          maxDrawdown: parseFloat(bestByCalmar.maxDrawdown.toString())
        },
        bestReturnStrategy: {
          params: `${bestByReturn.zScoreThreshold}/${bestByReturn.profitPercent}%/${bestByReturn.stopLossPercent}%`,
          calmarRatio: parseFloat(bestByReturn.calmarRatio!.toString()),
          annualizedReturn: parseFloat(bestByReturn.annualizedReturn.toString()),
          maxDrawdown: parseFloat(bestByReturn.maxDrawdown.toString())
        }
      });
    }

    // Sort by best Calmar ratio
    quoteBestStrategies.sort((a, b) => b.bestCalmarStrategy.calmarRatio - a.bestCalmarStrategy.calmarRatio);

    console.log(`${'Quote'.padEnd(8)} ${'Strategies'.padEnd(10)} ${'Best Calmar Strategy'.padEnd(35)} ${'Best Return Strategy'.padEnd(35)}`);
    console.log('-'.repeat(100));

    for (const quote of quoteBestStrategies) {
      console.log(`${quote.quoteAsset.padEnd(8)} ${quote.count.toString().padEnd(10)} ${`${quote.bestCalmarStrategy.params} (${quote.bestCalmarStrategy.calmarRatio.toFixed(2)})`.padEnd(35)} ${`${quote.bestReturnStrategy.params} (${quote.bestReturnStrategy.annualizedReturn.toFixed(1)}%)`.padEnd(35)}`);
    }

    // Show insights
    console.log('\n💡 Key Insights:');
    const bestQuote = quoteBestStrategies[0];
    const worstQuote = quoteBestStrategies[quoteBestStrategies.length - 1];
    
    console.log(`   • Best performing quote asset: ${bestQuote.quoteAsset} (Calmar: ${bestQuote.bestCalmarStrategy.calmarRatio.toFixed(2)})`);
    console.log(`   • Worst performing quote asset: ${worstQuote.quoteAsset} (Calmar: ${worstQuote.bestCalmarStrategy.calmarRatio.toFixed(2)})`);
    
    const avgCalmar = quoteBestStrategies.reduce((sum, q) => sum + q.bestCalmarStrategy.calmarRatio, 0) / quoteBestStrategies.length;
    console.log(`   • Average best Calmar across quote assets: ${avgCalmar.toFixed(2)}`);
  }

  /**
   * Main execution function
   */
  async run(): Promise<void> {
    try {
      await this.initialize();
      
      // Parse command line arguments
      const args = process.argv.slice(2);
      const baseAsset = args[0] ? args[0].toUpperCase() : undefined;
      
      if (baseAsset) {
        console.log(`🎯 Running performance comparison for baseAsset: ${baseAsset}`);
        await this.compareQuoteAssetPerformance(baseAsset);
      } else {
        console.log('🎯 Running performance comparison for all assets');
      }
      
      await this.compareTopPerformers(baseAsset);
      await this.analyzeOverlap(baseAsset);
      await this.showRiskComparison(baseAsset);
      
      console.log('\n✅ Performance comparison analysis complete!');
      
    } catch (error) {
      console.error('❌ Error in comparison:', error);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }
}

// Main execution
async function main() {
  const comparator = new PerformanceComparator();
  await comparator.run();
}

if (require.main === module) {
  main().catch(console.error);
}

export { PerformanceComparator };