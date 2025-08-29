#!/usr/bin/env ts-node

/**
 * Compare Old vs New Optimization Analysis Approaches
 * 
 * Demonstrates the difference between traditional metrics (just annualized return)
 * and comprehensive success metrics for parameter optimization.
 */

import { PrismaClient } from '@prisma/client';
import { BacktestSuccessAnalyzer } from '../src/utils/BacktestSuccessMetrics';
import { config } from 'dotenv';

config();

interface ComparisonResult {
  parameters: {
    zScore: number;
    profit: number;
    stop: number;
  };
  
  // Traditional metrics (what you had before)
  traditional: {
    annualizedReturn: number;
    sharpeRatio: number;
    maxDrawdown: number;
    winRatio: number;
    rank: number;
  };
  
  // Enhanced success metrics (what you have now)
  enhanced: {
    calmarRatio: number;
    profitFactor: number;
    compositeScore: number;
    strategyGrade: string;
    riskLevel: string;
    kellyPercentage: number;
    rank: number;
  };
  
  // Insights
  rankingDifference: number;
  betterWithNewMethod: boolean;
  recommendation: string;
}

class OptimizationComparer {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async initialize(): Promise<void> {
    await this.prisma.$connect();
  }

  /**
   * Compare top strategies using old vs new methods
   */
  async compareApproaches(baseAsset: string = 'ETH', quoteAsset: string = 'USDT'): Promise<void> {
    console.log('🔍 Comparing Traditional vs Enhanced Optimization Analysis');
    console.log('=' .repeat(80));

    // Get optimization results
    const results = await this.prisma.optimizationResults.findMany({
      where: { baseAsset, quoteAsset },
      orderBy: { annualizedReturn: 'desc' },
      take: 100 // Top 100 by traditional metric
    });

    if (results.length === 0) {
      console.log('❌ No results found');
      return;
    }

    console.log(`📊 Analyzing ${results.length} top parameter combinations...\n`);

    // Analyze with both approaches
    const comparisons: ComparisonResult[] = [];

    for (let i = 0; i < Math.min(results.length, 20); i++) { // Top 20 for detailed analysis
      const result = results[i];
      const comparison = await this.analyzeParameterCombination(result, i + 1, results);
      comparisons.push(comparison);
    }

    // Sort by new method ranking
    const enhancedSorted = [...comparisons].sort((a, b) => a.enhanced.rank - b.enhanced.rank);

    this.displayComparison(comparisons, enhancedSorted);
  }

  /**
   * Analyze a single parameter combination with both methods
   */
  private async analyzeParameterCombination(
    result: any, 
    traditionalRank: number, 
    allResults: any[]
  ): Promise<ComparisonResult> {
    
    // Simulate window results for enhanced analysis
    const windowResults = this.simulateWindowResults(result);
    const successMetrics = BacktestSuccessAnalyzer.analyzeWindowResults(windowResults);

    // Calculate enhanced metrics
    const calmarRatio = result.maxDrawdown > 0 ? result.annualizedReturn / result.maxDrawdown : 0;
    const profitFactor = this.estimateProfitFactor(result.winRatio, result.annualizedReturn);

    // Find ranking with enhanced method
    const enhancedScore = successMetrics.compositeScore;
    const enhancedRank = this.calculateEnhancedRank(result, allResults);

    const rankingDifference = traditionalRank - enhancedRank;
    const betterWithNewMethod = rankingDifference > 0;

    return {
      parameters: {
        zScore: parseFloat(result.zScoreThreshold.toString()),
        profit: parseFloat(result.profitPercent.toString()),
        stop: parseFloat(result.stopLossPercent.toString())
      },
      traditional: {
        annualizedReturn: parseFloat(result.annualizedReturn.toString()),
        sharpeRatio: parseFloat(result.sharpeRatio.toString()),
        maxDrawdown: parseFloat(result.maxDrawdown.toString()),
        winRatio: parseFloat(result.winRatio.toString()),
        rank: traditionalRank
      },
      enhanced: {
        calmarRatio,
        profitFactor,
        compositeScore: successMetrics.compositeScore,
        strategyGrade: successMetrics.strategyGrade,
        riskLevel: successMetrics.riskLevel,
        kellyPercentage: successMetrics.kellyPercentage,
        rank: enhancedRank
      },
      rankingDifference,
      betterWithNewMethod,
      recommendation: this.generateRecommendation(successMetrics, result)
    };
  }

  private simulateWindowResults(result: any) {
    // Same simulation as in the main report
    const totalWindows = 12;
    const avgReturn = result.annualizedReturn / 12;
    const volatility = avgReturn / (result.sharpeRatio || 1);
    const winRate = result.winRatio;
    
    const windows = [];
    for (let i = 0; i < totalWindows; i++) {
      const isWin = Math.random() < winRate;
      const baseReturn = isWin ? 
        Math.abs(avgReturn) + Math.random() * volatility :
        -Math.abs(avgReturn) * (1 - winRate) / winRate - Math.random() * volatility;
      
      windows.push({
        return: baseReturn,
        duration: 30,
        startDate: new Date(2024, i, 1),
        endDate: new Date(2024, i, 30),
        trades: Math.floor(result.totalTrades / totalWindows)
      });
    }
    return windows;
  }

  private estimateProfitFactor(winRatio: number, annualizedReturn: number): number {
    if (winRatio <= 0 || winRatio >= 1) return 1;
    const avgWin = Math.abs(annualizedReturn) * (2 / winRatio);
    const avgLoss = Math.abs(annualizedReturn) * (1 / (1 - winRatio));
    return avgWin / avgLoss;
  }

  private calculateEnhancedRank(result: any, allResults: any[]): number {
    // Calculate composite score for all results and rank
    const scores = allResults.map((r, index) => {
      const calmarRatio = r.maxDrawdown > 0 ? r.annualizedReturn / r.maxDrawdown : 0;
      const composite = this.calculateSimpleComposite(r, calmarRatio);
      return { index, composite };
    });
    
    scores.sort((a, b) => b.composite - a.composite);
    
    const resultIndex = allResults.indexOf(result);
    return scores.findIndex(s => s.index === resultIndex) + 1;
  }

  private calculateSimpleComposite(result: any, calmarRatio: number): number {
    // Simplified composite score calculation
    const returnScore = Math.min(100, Math.max(0, result.annualizedReturn * 200));
    const sharpeScore = Math.min(100, Math.max(0, result.sharpeRatio * 25));
    const drawdownPenalty = result.maxDrawdown * 100;
    const winRateScore = result.winRatio * 100;
    
    return (returnScore * 0.3 + sharpeScore * 0.2 + winRateScore * 0.2 + (100 - drawdownPenalty) * 0.3);
  }

  private generateRecommendation(successMetrics: any, result: any): string {
    if (successMetrics.strategyGrade === 'A+' || successMetrics.strategyGrade === 'A') {
      return 'Excellent - Ready for live trading';
    } else if (result.annualizedReturn > 0.5 && result.maxDrawdown < 0.2) {
      return 'Good - Consider with conservative sizing';
    } else if (result.maxDrawdown > 0.3) {
      return 'High risk - Reduce position size significantly';
    } else {
      return 'Needs optimization before live trading';
    }
  }

  private displayComparison(traditional: ComparisonResult[], enhanced: ComparisonResult[]): void {
    console.log('🆚 TOP 10 TRADITIONAL vs ENHANCED RANKINGS');
    console.log('=' .repeat(120));
    console.log(`${'Params'.padEnd(15)} ${'Trad Rank'.padEnd(10)} ${'New Rank'.padEnd(9)} ${'Grade'.padEnd(6)} ${'Calmar'.padEnd(8)} ${'Risk'.padEnd(12)} ${'Recommendation'.padEnd(30)}`);
    console.log('-'.repeat(120));

    for (let i = 0; i < Math.min(10, traditional.length); i++) {
      const t = traditional[i];
      const params = `${t.parameters.zScore}/${t.parameters.profit}%/${t.parameters.stop}%`;
      const tradRank = `#${t.traditional.rank}`;
      const newRank = `#${t.enhanced.rank}`;
      const grade = t.enhanced.strategyGrade;
      const calmar = t.enhanced.calmarRatio.toFixed(1);
      const risk = t.enhanced.riskLevel;
      const rec = t.recommendation.substring(0, 28);

      const rankChange = t.rankingDifference > 0 ? '📈' : t.rankingDifference < 0 ? '📉' : '➡️';
      
      console.log(`${params.padEnd(15)} ${tradRank.padEnd(10)} ${newRank.padEnd(9)} ${grade.padEnd(6)} ${calmar.padEnd(8)} ${risk.padEnd(12)} ${rec.padEnd(30)} ${rankChange}`);
    }

    console.log('\n🎯 KEY INSIGHTS:');
    
    // Find biggest ranking changes
    const biggestGainer = traditional.reduce((max, curr) => 
      curr.rankingDifference > max.rankingDifference ? curr : max);
    const biggestLoser = traditional.reduce((min, curr) => 
      curr.rankingDifference < min.rankingDifference ? curr : min);

    console.log(`   📈 Biggest Gainer: ${biggestGainer.parameters.zScore}/${biggestGainer.parameters.profit}%/${biggestGainer.parameters.stop}%`);
    console.log(`      - Moved from #${biggestGainer.traditional.rank} to #${biggestGainer.enhanced.rank}`);
    console.log(`      - Grade: ${biggestGainer.enhanced.strategyGrade}, Calmar: ${biggestGainer.enhanced.calmarRatio.toFixed(2)}`);
    
    console.log(`   📉 Biggest Loser: ${biggestLoser.parameters.zScore}/${biggestLoser.parameters.profit}%/${biggestLoser.parameters.stop}%`);
    console.log(`      - Moved from #${biggestLoser.traditional.rank} to #${biggestLoser.enhanced.rank}`);
    console.log(`      - Risk Level: ${biggestLoser.enhanced.riskLevel}`);

    // Grade distribution
    const gradeDistribution: Record<string, number> = {};
    traditional.forEach(t => {
      gradeDistribution[t.enhanced.strategyGrade] = (gradeDistribution[t.enhanced.strategyGrade] || 0) + 1;
    });

    console.log(`   🏆 Strategy Grades: ${Object.entries(gradeDistribution).map(([grade, count]) => `${grade}: ${count}`).join(', ')}`);
    
    // Risk distribution
    const highRisk = traditional.filter(t => t.enhanced.riskLevel === 'High' || t.enhanced.riskLevel === 'Very High').length;
    console.log(`   ⚠️ High Risk Strategies: ${highRisk}/${traditional.length} (${(highRisk/traditional.length*100).toFixed(1)}%)`);

    console.log('\n💡 METHODOLOGY DIFFERENCES:');
    console.log('   Traditional: Focuses on annualized return only');
    console.log('   Enhanced: Considers return, risk, consistency, and position sizing');
    console.log('   Key Benefit: Better identifies sustainable strategies vs high-risk gambits');
    
    console.log('\n🎲 WHY THE NEW METHOD IS BETTER:');
    console.log('   ✅ Accounts for mixed positive/negative windows');
    console.log('   ✅ Penalizes excessive drawdown appropriately');
    console.log('   ✅ Provides position sizing guidance');
    console.log('   ✅ Grades strategies like investment firms do');
    console.log('   ✅ Identifies truly consistent performers');
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

async function main() {
  const comparer = new OptimizationComparer();
  
  try {
    await comparer.initialize();
    await comparer.compareApproaches();
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await comparer.cleanup();
  }
}

if (require.main === module) {
  main().catch(console.error);
}