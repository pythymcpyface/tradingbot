#!/usr/bin/env ts-node

/**
 * Analyze Backtest Success Example
 * 
 * Demonstrates how to use the comprehensive success measurement
 * for backtests with mixed positive/negative windows.
 */

import { BacktestSuccessAnalyzer, WindowResult } from '../src/utils/BacktestSuccessMetrics';

// Example: Mixed results (some negative, some positive, but positive average)
const exampleWindowResults: WindowResult[] = [
  { return: 0.15, duration: 30, startDate: new Date('2024-01-01'), endDate: new Date('2024-01-31'), trades: 12 },
  { return: -0.08, duration: 30, startDate: new Date('2024-02-01'), endDate: new Date('2024-02-29'), trades: 8 },
  { return: 0.22, duration: 30, startDate: new Date('2024-03-01'), endDate: new Date('2024-03-31'), trades: 15 },
  { return: -0.12, duration: 30, startDate: new Date('2024-04-01'), endDate: new Date('2024-04-30'), trades: 6 },
  { return: 0.18, duration: 30, startDate: new Date('2024-05-01'), endDate: new Date('2024-05-31'), trades: 11 },
  { return: 0.09, duration: 30, startDate: new Date('2024-06-01'), endDate: new Date('2024-06-30'), trades: 9 },
  { return: -0.05, duration: 30, startDate: new Date('2024-07-01'), endDate: new Date('2024-07-31'), trades: 4 },
  { return: 0.28, duration: 30, startDate: new Date('2024-08-01'), endDate: new Date('2024-08-31'), trades: 18 },
];

function analyzeResults() {
  console.log('📊 Comprehensive Backtest Success Analysis');
  console.log('=' .repeat(80));
  
  const metrics = BacktestSuccessAnalyzer.analyzeWindowResults(exampleWindowResults);
  
  console.log('\n🎯 PRIMARY PERFORMANCE METRICS:');
  console.log(`   Total Return: ${(metrics.totalReturn * 100).toFixed(2)}%`);
  console.log(`   Annualized Return: ${(metrics.annualizedReturn * 100).toFixed(2)}%`);
  console.log(`   Sharpe Ratio: ${metrics.sharpeRatio.toFixed(3)}`);
  console.log(`   Sortino Ratio: ${metrics.sortinoRatio.toFixed(3)}`);
  console.log(`   Calmar Ratio: ${metrics.calmarRatio.toFixed(3)}`);
  
  console.log('\n📈 WIN/LOSS ANALYSIS:');
  console.log(`   Win Rate: ${metrics.winRate.toFixed(1)}%`);
  console.log(`   Profit Factor: ${metrics.profitFactor.toFixed(2)}`);
  console.log(`   Average Win: ${(metrics.averageWin * 100).toFixed(2)}%`);
  console.log(`   Average Loss: ${(metrics.averageLoss * 100).toFixed(2)}%`);
  console.log(`   Largest Win: ${(metrics.largestWin * 100).toFixed(2)}%`);
  console.log(`   Largest Loss: ${(metrics.largestLoss * 100).toFixed(2)}%`);
  
  console.log('\n⚠️ RISK METRICS:');
  console.log(`   Maximum Drawdown: ${(metrics.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`   Volatility: ${(metrics.volatility * 100).toFixed(2)}%`);
  console.log(`   95% Value at Risk: ${(metrics.valueAtRisk95 * 100).toFixed(2)}%`);
  console.log(`   Risk Level: ${metrics.riskLevel}`);
  
  console.log('\n🎯 CONSISTENCY METRICS:');
  console.log(`   Consistency: ${metrics.consistency.toFixed(1)}%`);
  console.log(`   Stability Index: ${metrics.stabilityIndex.toFixed(1)}/100`);
  
  console.log('\n💰 POSITION SIZING:');
  console.log(`   Kelly Percentage: ${(metrics.kellyPercentage * 100).toFixed(1)}%`);
  
  console.log('\n🏆 OVERALL ASSESSMENT:');
  console.log(`   Strategy Grade: ${metrics.strategyGrade}`);
  console.log(`   Composite Score: ${metrics.compositeScore.toFixed(1)}/100`);
  console.log(`   Risk-Adjusted Score: ${metrics.riskAdjustedScore.toFixed(1)}/100`);
  
  console.log('\n💡 RECOMMENDATION:');
  console.log(`   ${metrics.recommendation}`);
  
  // Interpretation guide
  console.log('\n📚 INTERPRETATION GUIDE:');
  console.log('   Sharpe Ratio: >1.0 good, >2.0 excellent');
  console.log('   Win Rate: >50% is positive, >60% is very good');
  console.log('   Profit Factor: >1.5 good, >2.0 excellent');
  console.log('   Max Drawdown: <20% acceptable, <10% excellent');
  console.log('   Kelly %: Optimal position size for growth');
}

if (require.main === module) {
  analyzeResults();
}