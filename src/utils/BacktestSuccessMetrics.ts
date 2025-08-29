/**
 * Comprehensive Backtest Success Measurement
 * 
 * Evaluates strategy performance across multiple dimensions when dealing
 * with mixed positive/negative window returns but positive average returns.
 */

import { VectorizedOperations, FinancialVectorOperations } from '../lib/algorithms/VectorizedOperations';

interface WindowResult {
  return: number;
  duration: number; // in days
  startDate: Date;
  endDate: Date;
  trades: number;
  maxDrawdownInWindow?: number;
}

interface SuccessMetrics {
  // Primary Performance Metrics
  totalReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  
  // Win/Loss Analysis
  winRate: number; // % of profitable windows
  profitFactor: number; // Total gains / Total losses
  averageWin: number;
  averageLoss: number;
  largestWin: number;
  largestLoss: number;
  
  // Risk Metrics
  maxDrawdown: number;
  volatility: number;
  downsideDeviation: number;
  valueAtRisk95: number; // 95% VaR
  
  // Consistency Metrics
  consistency: number; // % of rolling periods that are positive
  stabilityIndex: number; // How steady the returns are
  
  // Position Sizing
  kellyPercentage: number; // Optimal position size
  
  // Overall Score
  compositeScore: number; // Weighted combination of all metrics
  riskAdjustedScore: number;
  
  // Classification
  strategyGrade: 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'F';
  riskLevel: 'Low' | 'Medium' | 'High' | 'Very High';
  recommendation: string;
}

class BacktestSuccessAnalyzer {
  
  /**
   * Comprehensive analysis of backtest success across multiple windows
   */
  static analyzeWindowResults(windowResults: WindowResult[]): SuccessMetrics {
    const returns = new Float64Array(windowResults.map(w => w.return));
    const positiveReturns = windowResults.filter(w => w.return > 0);
    const negativeReturns = windowResults.filter(w => w.return < 0);
    
    // Basic calculations
    const totalReturn = this.calculateTotalReturn(returns);
    const annualizedReturn = this.calculateAnnualizedReturn(windowResults);
    
    // Risk-adjusted metrics
    const sharpeRatio = FinancialVectorOperations.sharpeRatio(returns);
    const sortinoRatio = FinancialVectorOperations.sortinoRatio(returns);
    const maxDrawdown = FinancialVectorOperations.maxDrawdown(returns);
    const calmarRatio = annualizedReturn / (maxDrawdown > 0 ? maxDrawdown : 1);
    
    // Win/Loss analysis
    const winRate = (positiveReturns.length / windowResults.length) * 100;
    const totalGains = positiveReturns.reduce((sum, w) => sum + w.return, 0);
    const totalLosses = Math.abs(negativeReturns.reduce((sum, w) => sum + w.return, 0));
    const profitFactor = totalLosses > 0 ? totalGains / totalLosses : Infinity;
    
    const averageWin = positiveReturns.length > 0 ? totalGains / positiveReturns.length : 0;
    const averageLoss = negativeReturns.length > 0 ? totalLosses / negativeReturns.length : 0;
    const largestWin = positiveReturns.length > 0 ? Math.max(...positiveReturns.map(w => w.return)) : 0;
    const largestLoss = negativeReturns.length > 0 ? Math.min(...negativeReturns.map(w => w.return)) : 0;
    
    // Risk metrics
    const volatility = VectorizedOperations.standardDeviation(returns);
    const downsideDeviation = this.calculateDownsideDeviation(returns);
    const valueAtRisk95 = VectorizedOperations.percentile(returns, 5); // 5th percentile
    
    // Consistency metrics
    const consistency = this.calculateConsistency(returns);
    const stabilityIndex = this.calculateStabilityIndex(returns);
    
    // Position sizing
    const kellyPercentage = this.calculateKellyPercentage(winRate / 100, averageWin, averageLoss);
    
    // Composite scores
    const compositeScore = this.calculateCompositeScore({
      sharpeRatio,
      winRate,
      profitFactor,
      maxDrawdown,
      consistency
    });
    
    const riskAdjustedScore = this.calculateRiskAdjustedScore({
      annualizedReturn,
      maxDrawdown,
      sharpeRatio,
      sortinoRatio
    });
    
    // Classification
    const strategyGrade = this.gradeStrategy(compositeScore);
    const riskLevel = this.assessRiskLevel(maxDrawdown, volatility);
    const recommendation = this.generateRecommendation({
      strategyGrade,
      riskLevel,
      winRate,
      profitFactor,
      sharpeRatio,
      kellyPercentage
    });
    
    return {
      totalReturn,
      annualizedReturn,
      sharpeRatio,
      sortinoRatio,
      calmarRatio,
      winRate,
      profitFactor,
      averageWin,
      averageLoss,
      largestWin,
      largestLoss,
      maxDrawdown,
      volatility,
      downsideDeviation,
      valueAtRisk95,
      consistency,
      stabilityIndex,
      kellyPercentage,
      compositeScore,
      riskAdjustedScore,
      strategyGrade,
      riskLevel,
      recommendation
    };
  }
  
  /**
   * Calculate total cumulative return
   */
  private static calculateTotalReturn(returns: Float64Array): number {
    let cumulative = 1.0;
    for (let i = 0; i < returns.length; i++) {
      cumulative *= (1 + returns[i]);
    }
    return cumulative - 1;
  }
  
  /**
   * Calculate annualized return based on window durations
   */
  private static calculateAnnualizedReturn(windowResults: WindowResult[]): number {
    const totalReturn = this.calculateTotalReturn(
      new Float64Array(windowResults.map(w => w.return))
    );
    
    const totalDays = windowResults.reduce((sum, w) => sum + w.duration, 0);
    const years = totalDays / 365.25;
    
    return years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : 0;
  }
  
  /**
   * Calculate downside deviation (only negative returns)
   */
  private static calculateDownsideDeviation(returns: Float64Array, targetReturn: number = 0): number {
    const downsideReturns = VectorizedOperations.filter(returns, (r) => r < targetReturn);
    return downsideReturns.length > 0 ? VectorizedOperations.standardDeviation(downsideReturns) : 0;
  }
  
  /**
   * Calculate consistency (rolling period analysis)
   */
  private static calculateConsistency(returns: Float64Array, rollingPeriod: number = 12): number {
    if (returns.length < rollingPeriod) return 0;
    
    let positiveRollingPeriods = 0;
    for (let i = rollingPeriod - 1; i < returns.length; i++) {
      const rollingReturn = VectorizedOperations.sum(
        VectorizedOperations.slice(returns, i - rollingPeriod + 1, i + 1)
      );
      if (rollingReturn > 0) positiveRollingPeriods++;
    }
    
    const totalRollingPeriods = returns.length - rollingPeriod + 1;
    return (positiveRollingPeriods / totalRollingPeriods) * 100;
  }
  
  /**
   * Calculate stability index (inverse of volatility relative to returns)
   */
  private static calculateStabilityIndex(returns: Float64Array): number {
    const mean = VectorizedOperations.mean(returns);
    const std = VectorizedOperations.standardDeviation(returns);
    
    if (std === 0) return 100;
    if (mean <= 0) return 0;
    
    return Math.min(100, (mean / std) * 10); // Scale to 0-100
  }
  
  /**
   * Calculate Kelly percentage for optimal position sizing
   */
  private static calculateKellyPercentage(winRate: number, averageWin: number, averageLoss: number): number {
    if (averageWin <= 0 || averageLoss <= 0) return 0;
    
    const kelly = (winRate * averageWin - (1 - winRate) * averageLoss) / averageWin;
    return Math.max(0, Math.min(1, kelly)); // Cap at 0-100%
  }
  
  /**
   * Calculate composite performance score
   */
  private static calculateCompositeScore(metrics: {
    sharpeRatio: number;
    winRate: number;
    profitFactor: number;
    maxDrawdown: number;
    consistency: number;
  }): number {
    // Normalize each metric to 0-100 scale
    const normalizedSharpe = Math.min(100, Math.max(0, (metrics.sharpeRatio + 1) * 25)); // -1 to 3 -> 0 to 100
    const normalizedWinRate = metrics.winRate; // Already 0-100
    const normalizedProfitFactor = Math.min(100, (metrics.profitFactor - 1) * 25); // 1 to 5 -> 0 to 100
    const normalizedDrawdown = Math.max(0, 100 - (metrics.maxDrawdown * 200)); // 0 to 50% -> 100 to 0
    const normalizedConsistency = metrics.consistency; // Already 0-100
    
    // Weighted average (risk-adjusted focus)
    return (
      normalizedSharpe * 0.25 +
      normalizedWinRate * 0.20 +
      normalizedProfitFactor * 0.20 +
      normalizedDrawdown * 0.25 +
      normalizedConsistency * 0.10
    );
  }
  
  /**
   * Calculate risk-adjusted score
   */
  private static calculateRiskAdjustedScore(metrics: {
    annualizedReturn: number;
    maxDrawdown: number;
    sharpeRatio: number;
    sortinoRatio: number;
  }): number {
    // Focus on risk-adjusted metrics
    const returnScore = Math.min(100, Math.max(0, metrics.annualizedReturn * 200)); // 0 to 50% -> 0 to 100
    const drawdownPenalty = metrics.maxDrawdown * 100; // 0 to 1 -> 0 to 100
    const sharpeScore = Math.min(100, Math.max(0, metrics.sharpeRatio * 25)); // 0 to 4 -> 0 to 100
    const sortinoScore = Math.min(100, Math.max(0, metrics.sortinoRatio * 20)); // 0 to 5 -> 0 to 100
    
    return Math.max(0, (returnScore + sharpeScore + sortinoScore) / 3 - drawdownPenalty);
  }
  
  /**
   * Grade strategy performance
   */
  private static gradeStrategy(compositeScore: number): 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'F' {
    if (compositeScore >= 90) return 'A+';
    if (compositeScore >= 85) return 'A';
    if (compositeScore >= 80) return 'B+';
    if (compositeScore >= 75) return 'B';
    if (compositeScore >= 70) return 'C+';
    if (compositeScore >= 65) return 'C';
    if (compositeScore >= 60) return 'D';
    return 'F';
  }
  
  /**
   * Assess risk level
   */
  private static assessRiskLevel(maxDrawdown: number, volatility: number): 'Low' | 'Medium' | 'High' | 'Very High' {
    const riskScore = (maxDrawdown * 0.6 + volatility * 0.4) * 100;
    
    if (riskScore < 10) return 'Low';
    if (riskScore < 20) return 'Medium';
    if (riskScore < 35) return 'High';
    return 'Very High';
  }
  
  /**
   * Generate recommendation
   */
  private static generateRecommendation(metrics: {
    strategyGrade: string;
    riskLevel: string;
    winRate: number;
    profitFactor: number;
    sharpeRatio: number;
    kellyPercentage: number;
  }): string {
    const recommendations: string[] = [];
    
    // Overall assessment
    if (metrics.strategyGrade === 'A+' || metrics.strategyGrade === 'A') {
      recommendations.push("Excellent strategy - ready for live trading");
    } else if (metrics.strategyGrade === 'B+' || metrics.strategyGrade === 'B') {
      recommendations.push("Good strategy - consider optimization");
    } else if (metrics.strategyGrade === 'C+' || metrics.strategyGrade === 'C') {
      recommendations.push("Marginal strategy - needs improvement");
    } else {
      recommendations.push("Poor strategy - requires significant changes");
    }
    
    // Risk assessment
    if (metrics.riskLevel === 'Very High') {
      recommendations.push("HIGH RISK: Reduce position size significantly");
    } else if (metrics.riskLevel === 'High') {
      recommendations.push("Use conservative position sizing");
    }
    
    // Specific improvements
    if (metrics.winRate < 40) {
      recommendations.push("Low win rate - improve entry signals");
    }
    if (metrics.profitFactor < 1.2) {
      recommendations.push("Poor profit factor - optimize exit strategy");
    }
    if (metrics.sharpeRatio < 0.5) {
      recommendations.push("Low risk-adjusted returns - reduce volatility");
    }
    
    // Position sizing
    if (metrics.kellyPercentage > 0) {
      recommendations.push(`Optimal position size: ${(metrics.kellyPercentage * 100).toFixed(1)}%`);
    }
    
    return recommendations.join(". ");
  }
}

export { BacktestSuccessAnalyzer, SuccessMetrics, WindowResult };