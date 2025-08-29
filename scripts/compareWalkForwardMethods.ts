#!/usr/bin/env ts-node

/**
 * Compare Traditional vs Enhanced Walk-Forward Analysis
 * 
 * Demonstrates the difference between basic return-focused walk-forward
 * and comprehensive success metrics walk-forward analysis.
 */

import { PrismaClient } from '@prisma/client';
import { BacktestSuccessAnalyzer } from '../src/utils/BacktestSuccessMetrics';
import { config } from 'dotenv';

config();

interface TraditionalWindow {
  windowNumber: number;
  startDate: Date;
  endDate: Date;
  totalReturn: number;
  annualizedReturn: number;
  maxDrawdown: number;
  sharpeRatio: number;
  winRatio: number;
  totalTrades: number;
}

interface EnhancedWindow {
  windowNumber: number;
  startDate: Date;
  endDate: Date;
  
  // Traditional metrics
  totalReturn: number;
  annualizedReturn: number;
  maxDrawdown: number;
  sharpeRatio: number;
  winRatio: number;
  totalTrades: number;
  
  // Enhanced metrics
  calmarRatio: number;
  compositeScore: number;
  strategyGrade: string;
  riskLevel: string;
  kellyPercentage: number;
  
  // Ranking differences
  traditionalRank: number;
  enhancedRank: number;
  rankingImprovement: number;
}

interface ComparisonInsights {
  // Overall comparison
  traditionalBestWindow: TraditionalWindow;
  enhancedBestWindow: EnhancedWindow;
  
  // Ranking analysis
  biggestRankingGainer: EnhancedWindow;
  biggestRankingLoser: EnhancedWindow;
  
  // Strategy insights
  gradeDistribution: Record<string, number>;
  riskDistribution: Record<string, number>;
  
  // Recommendations
  traditionalRecommendation: string;
  enhancedRecommendation: string;
  whyEnhancedIsBetter: string[];
}

class WalkForwardComparer {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async initialize(): Promise<void> {
    await this.prisma.$connect();
    console.log('✅ Connected to database');
  }

  /**
   * Compare walk-forward methods using historical data
   */
  async compareWalkForwardMethods(
    baseAsset: string = 'ETH', 
    quoteAsset: string = 'USDT'
  ): Promise<void> {
    console.log('🔄 Comparing Traditional vs Enhanced Walk-Forward Analysis');
    console.log('=' .repeat(80));
    
    // Get sample backtest runs (simulating different windows)
    const backtestRuns = await this.getSampleBacktestRuns(baseAsset, quoteAsset);
    
    if (backtestRuns.length < 5) {
      console.log('❌ Need at least 5 backtest runs to demonstrate walk-forward analysis');
      return;
    }

    console.log(`📊 Analyzing ${backtestRuns.length} backtest windows...\n`);

    // Traditional analysis
    const traditionalWindows = this.performTraditionalAnalysis(backtestRuns);
    
    // Enhanced analysis  
    const enhancedWindows = this.performEnhancedAnalysis(backtestRuns);
    
    // Generate comparison insights
    const insights = this.generateComparisonInsights(traditionalWindows, enhancedWindows);
    
    // Display results
    this.displayComparison(traditionalWindows, enhancedWindows, insights);
  }

  /**
   * Get sample backtest runs from database
   */
  private async getSampleBacktestRuns(baseAsset: string, quoteAsset: string) {
    // Get diverse backtest runs with different parameters
    const runs = await this.prisma.optimizationResults.findMany({
      where: {
        baseAsset,
        quoteAsset,
        totalTrades: { gt: 5 } // Only runs with meaningful trade count
      },
      orderBy: { annualizedReturn: 'desc' },
      take: 12 // Simulate 12 monthly windows
    });

    return runs.map((run, index) => ({
      windowNumber: index + 1,
      startDate: run.startTime,
      endDate: run.endTime,
      totalReturn: parseFloat(run.totalReturn.toString()),
      annualizedReturn: parseFloat(run.annualizedReturn.toString()),
      maxDrawdown: parseFloat(run.maxDrawdown.toString()),
      sharpeRatio: parseFloat(run.sharpeRatio.toString()),
      winRatio: parseFloat(run.winRatio.toString()),
      totalTrades: run.totalTrades,
      profitFactor: parseFloat((run.profitFactor || 1).toString()),
      zScore: parseFloat(run.zScoreThreshold.toString()),
      profitPercent: parseFloat(run.profitPercent.toString()),
      stopPercent: parseFloat(run.stopLossPercent.toString())
    }));
  }

  /**
   * Traditional walk-forward analysis (just ranking by return)
   */
  private performTraditionalAnalysis(runs: any[]): TraditionalWindow[] {
    // Traditional method: rank windows by annualized return
    const sortedRuns = [...runs].sort((a, b) => b.annualizedReturn - a.annualizedReturn);
    
    return sortedRuns.map((run, index) => ({
      windowNumber: run.windowNumber,
      startDate: run.startDate,
      endDate: run.endDate,
      totalReturn: run.totalReturn,
      annualizedReturn: run.annualizedReturn,
      maxDrawdown: run.maxDrawdown,
      sharpeRatio: run.sharpeRatio,
      winRatio: run.winRatio,
      totalTrades: run.totalTrades,
      traditionalRank: index + 1
    }));
  }

  /**
   * Enhanced walk-forward analysis with success metrics
   */
  private performEnhancedAnalysis(runs: any[]): EnhancedWindow[] {
    const enhancedWindows: EnhancedWindow[] = [];

    for (const run of runs) {
      // Simulate window results for comprehensive analysis
      const windowResults = this.simulateWindowResult(run);
      const successMetrics = BacktestSuccessAnalyzer.analyzeWindowResults([windowResults]);
      
      // Calculate Calmar ratio
      const calmarRatio = run.maxDrawdown > 0 ? run.annualizedReturn / run.maxDrawdown : 999;
      
      enhancedWindows.push({
        windowNumber: run.windowNumber,
        startDate: run.startDate,
        endDate: run.endDate,
        
        // Traditional
        totalReturn: run.totalReturn,
        annualizedReturn: run.annualizedReturn,
        maxDrawdown: run.maxDrawdown,
        sharpeRatio: run.sharpeRatio,
        winRatio: run.winRatio,
        totalTrades: run.totalTrades,
        
        // Enhanced
        calmarRatio,
        compositeScore: successMetrics.compositeScore,
        strategyGrade: successMetrics.strategyGrade,
        riskLevel: successMetrics.riskLevel,
        kellyPercentage: successMetrics.kellyPercentage,
        
        // Rankings (will be filled later)
        traditionalRank: 0,
        enhancedRank: 0,
        rankingImprovement: 0
      });
    }

    // Rank by traditional method
    const traditionalSorted = [...enhancedWindows].sort((a, b) => b.annualizedReturn - a.annualizedReturn);
    traditionalSorted.forEach((window, index) => {
      const originalWindow = enhancedWindows.find(w => w.windowNumber === window.windowNumber);
      if (originalWindow) originalWindow.traditionalRank = index + 1;
    });

    // Rank by enhanced method (Calmar ratio)
    const enhancedSorted = [...enhancedWindows].sort((a, b) => b.calmarRatio - a.calmarRatio);
    enhancedSorted.forEach((window, index) => {
      const originalWindow = enhancedWindows.find(w => w.windowNumber === window.windowNumber);
      if (originalWindow) {
        originalWindow.enhancedRank = index + 1;
        originalWindow.rankingImprovement = originalWindow.traditionalRank - originalWindow.enhancedRank;
      }
    });

    return enhancedWindows;
  }

  /**
   * Simulate window result for comprehensive analysis
   */
  private simulateWindowResult(run: any) {
    return {
      return: run.totalReturn / 100, // Convert percentage to decimal
      duration: 30, // Assume monthly windows
      startDate: run.startDate,
      endDate: run.endDate,
      trades: run.totalTrades
    };
  }

  /**
   * Generate comprehensive comparison insights
   */
  private generateComparisonInsights(
    traditional: TraditionalWindow[], 
    enhanced: EnhancedWindow[]
  ): ComparisonInsights {
    
    const traditionalBestWindow = traditional[0]; // Already sorted by return
    const enhancedBestWindow = enhanced.reduce((best, curr) => 
      curr.calmarRatio > best.calmarRatio ? curr : best);

    const biggestRankingGainer = enhanced.reduce((best, curr) => 
      curr.rankingImprovement > best.rankingImprovement ? curr : best);
    
    const biggestRankingLoser = enhanced.reduce((worst, curr) => 
      curr.rankingImprovement < worst.rankingImprovement ? curr : worst);

    // Grade distribution
    const gradeDistribution: Record<string, number> = {};
    enhanced.forEach(window => {
      gradeDistribution[window.strategyGrade] = (gradeDistribution[window.strategyGrade] || 0) + 1;
    });

    // Risk distribution
    const riskDistribution: Record<string, number> = {};
    enhanced.forEach(window => {
      riskDistribution[window.riskLevel] = (riskDistribution[window.riskLevel] || 0) + 1;
    });

    // Recommendations
    const traditionalRecommendation = `Use Window ${traditionalBestWindow.windowNumber} parameters (highest return: ${traditionalBestWindow.annualizedReturn.toFixed(1)}%)`;
    
    const enhancedRecommendation = `Use Window ${enhancedBestWindow.windowNumber} parameters (best risk-adjusted: Calmar ${enhancedBestWindow.calmarRatio.toFixed(2)}, Grade ${enhancedBestWindow.strategyGrade})`;

    const whyEnhancedIsBetter = [
      'Accounts for drawdown risk in performance measurement',
      'Identifies sustainable strategies vs high-risk gambits',
      'Provides position sizing guidance through Kelly percentage',
      'Grades strategies using institutional-level analysis',
      'Better identifies periods where high returns came with excessive risk'
    ];

    return {
      traditionalBestWindow,
      enhancedBestWindow,
      biggestRankingGainer,
      biggestRankingLoser,
      gradeDistribution,
      riskDistribution,
      traditionalRecommendation,
      enhancedRecommendation,
      whyEnhancedIsBetter
    };
  }

  /**
   * Display comprehensive comparison
   */
  private displayComparison(
    traditional: TraditionalWindow[],
    enhanced: EnhancedWindow[],
    insights: ComparisonInsights
  ): void {
    
    console.log('📊 WINDOW-BY-WINDOW COMPARISON (Top 10)');
    console.log('=' .repeat(140));
    console.log(`${'Window'.padEnd(8)} ${'Period'.padEnd(12)} ${'Return%'.padEnd(8)} ${'Trad Rank'.padEnd(10)} ${'Enh Rank'.padEnd(9)} ${'Calmar'.padEnd(8)} ${'Grade'.padEnd(6)} ${'Risk'.padEnd(10)} ${'Change'.padEnd(8)}`);
    console.log('-'.repeat(140));

    for (let i = 0; i < Math.min(10, enhanced.length); i++) {
      const window = enhanced[i];
      const period = window.startDate ? window.startDate.toISOString().split('T')[0].substr(5) : 'N/A';
      const returnStr = window.totalReturn.toFixed(1);
      const tradRank = `#${window.traditionalRank}`;
      const enhRank = `#${window.enhancedRank}`;
      const calmar = window.calmarRatio.toFixed(1);
      const grade = window.strategyGrade;
      const risk = window.riskLevel;
      
      const changeIcon = window.rankingImprovement > 0 ? '📈' : 
                        window.rankingImprovement < 0 ? '📉' : '➡️';
      const changeText = `${changeIcon}${Math.abs(window.rankingImprovement)}`;

      console.log(`${`W${window.windowNumber}`.padEnd(8)} ${period.padEnd(12)} ${returnStr.padEnd(8)} ${tradRank.padEnd(10)} ${enhRank.padEnd(9)} ${calmar.padEnd(8)} ${grade.padEnd(6)} ${risk.padEnd(10)} ${changeText.padEnd(8)}`);
    }

    console.log('\n🏆 BEST WINDOW COMPARISON');
    console.log('=' .repeat(80));
    console.log('Traditional Best (Highest Return):');
    console.log(`   Window ${insights.traditionalBestWindow.windowNumber}: ${insights.traditionalBestWindow.annualizedReturn.toFixed(1)}% return, ${insights.traditionalBestWindow.maxDrawdown.toFixed(1)}% drawdown`);
    console.log(`   Risk Assessment: ${insights.traditionalBestWindow.maxDrawdown > 20 ? '⚠️ HIGH RISK' : '✅ Acceptable Risk'}`);

    console.log('\nEnhanced Best (Best Risk-Adjusted):');
    console.log(`   Window ${insights.enhancedBestWindow.windowNumber}: ${insights.enhancedBestWindow.annualizedReturn.toFixed(1)}% return, Calmar ${insights.enhancedBestWindow.calmarRatio.toFixed(2)}`);
    console.log(`   Grade: ${insights.enhancedBestWindow.strategyGrade}, Risk Level: ${insights.enhancedBestWindow.riskLevel}`);
    console.log(`   Position Size: ${(insights.enhancedBestWindow.kellyPercentage * 100).toFixed(1)}%`);

    console.log('\n📈 RANKING CHANGES');
    console.log('=' .repeat(80));
    console.log(`Biggest Gainer: Window ${insights.biggestRankingGainer.windowNumber}`);
    console.log(`   Moved from #${insights.biggestRankingGainer.traditionalRank} to #${insights.biggestRankingGainer.enhancedRank}`);
    console.log(`   Why: Calmar ratio ${insights.biggestRankingGainer.calmarRatio.toFixed(2)} shows excellent risk-adjusted returns`);

    console.log(`\nBiggest Loser: Window ${insights.biggestRankingLoser.windowNumber}`);
    console.log(`   Moved from #${insights.biggestRankingLoser.traditionalRank} to #${insights.biggestRankingLoser.enhancedRank}`);
    console.log(`   Why: High return came with excessive drawdown (${insights.biggestRankingLoser.maxDrawdown.toFixed(1)}%)`);

    console.log('\n📊 STRATEGY QUALITY DISTRIBUTION');
    console.log('=' .repeat(80));
    const totalWindows = enhanced.length;
    console.log('Strategy Grades:');
    Object.entries(insights.gradeDistribution)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([grade, count]) => {
        const percentage = (count / totalWindows * 100).toFixed(1);
        console.log(`   ${grade}: ${count} windows (${percentage}%)`);
      });

    console.log('\nRisk Levels:');
    Object.entries(insights.riskDistribution).forEach(([risk, count]) => {
      const percentage = (count / totalWindows * 100).toFixed(1);
      console.log(`   ${risk}: ${count} windows (${percentage}%)`);
    });

    console.log('\n💡 RECOMMENDATIONS');
    console.log('=' .repeat(80));
    console.log('Traditional Method:');
    console.log(`   ${insights.traditionalRecommendation}`);
    console.log(`   Risk: May select high-risk strategies with unsustainable returns`);

    console.log('\nEnhanced Method:');
    console.log(`   ${insights.enhancedRecommendation}`);
    console.log(`   Benefit: Balances return with risk for sustainable performance`);

    console.log('\n🎯 WHY ENHANCED WALK-FORWARD IS SUPERIOR');
    console.log('=' .repeat(80));
    insights.whyEnhancedIsBetter.forEach((reason, index) => {
      console.log(`   ${index + 1}. ${reason}`);
    });

    console.log('\n📈 PRACTICAL IMPACT');
    console.log('=' .repeat(80));
    const highRiskWindows = enhanced.filter(w => w.riskLevel === 'High' || w.riskLevel === 'Very High').length;
    const highGradeWindows = enhanced.filter(w => w.strategyGrade === 'A+' || w.strategyGrade === 'A').length;
    
    console.log(`   Traditional approach would miss: ${highRiskWindows}/${totalWindows} high-risk periods`);
    console.log(`   Enhanced approach identifies: ${highGradeWindows}/${totalWindows} truly excellent periods`);
    console.log(`   Average optimal position size: ${(enhanced.reduce((sum, w) => sum + w.kellyPercentage, 0) / totalWindows * 100).toFixed(1)}%`);

    const traditionalBestRisk = insights.traditionalBestWindow.maxDrawdown;
    const enhancedBestRisk = insights.enhancedBestWindow.maxDrawdown;
    const riskReduction = ((traditionalBestRisk - enhancedBestRisk) / traditionalBestRisk * 100).toFixed(1);
    
    if (enhancedBestRisk < traditionalBestRisk) {
      console.log(`   Risk Reduction: Enhanced method reduces drawdown by ${riskReduction}%`);
    }
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

// Main execution
async function main() {
  const comparer = new WalkForwardComparer();
  
  try {
    await comparer.initialize();
    await comparer.compareWalkForwardMethods('ETH', 'USDT');
    
    console.log('\n✅ Walk-forward method comparison complete!');
    console.log('\n🚀 Next Steps:');
    console.log('   1. Use enhanced walk-forward for better strategy selection');
    console.log('   2. Focus on Calmar ratio instead of raw returns');
    console.log('   3. Apply Kelly percentage for position sizing');
    console.log('   4. Monitor strategy grades across different market conditions');
    
  } catch (error) {
    console.error('❌ Comparison failed:', error);
  } finally {
    await comparer.cleanup();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { WalkForwardComparer };