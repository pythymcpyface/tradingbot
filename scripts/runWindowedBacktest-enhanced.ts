#!/usr/bin/env ts-node

/**
 * Enhanced Windowed Backtest with Comprehensive Success Metrics
 * 
 * This script enhances the walk-forward analysis with advanced success metrics
 * including Calmar ratio, composite scoring, and strategy grading for each window.
 * 
 * Features:
 * - Calmar Ratio (Return/Drawdown) for each window
 * - Profit Factor analysis across windows
 * - Composite success scoring
 * - Strategy grading (A+ to F)
 * - Kelly percentage for position sizing
 * - Walk-forward consistency analysis
 * 
 * Usage: npm run runWindowedBacktest-enhanced "2022-01-01" 12 ETH USDT 3.0 200 5.0 2.5
 */

import { PrismaClient } from '@prisma/client';
import { BacktestSuccessAnalyzer, WindowResult } from '../src/utils/BacktestSuccessMetrics';
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

config();

interface BacktestConfig {
  startTime: Date;
  endTime: Date;
  windowSize: number; // months
  baseAsset: string;
  quoteAsset: string;
  zScoreThreshold: number;
  movingAverages: number;
  profitPercent: number;
  stopLossPercent: number;
}

interface BacktestTrade {
  entryTime: Date;
  exitTime: Date;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  reason: 'EXIT_ZSCORE' | 'EXIT_PROFIT' | 'EXIT_STOP';
  profitLoss: number;
  profitLossPercent: number;
  duration: number; // hours
}

interface EnhancedPerformanceMetrics {
  // Traditional metrics
  totalReturn: number;
  annualizedReturn: number;
  benchmarkReturn: number;
  sharpeRatio: number;
  sortinoRatio: number;
  alpha: number;
  maxDrawdown: number;
  annualizedVolatility: number;
  winRatio: number;
  profitFactor: number;
  totalTrades: number;
  avgTradeDuration: number;
  
  // Enhanced success metrics
  calmarRatio: number;
  compositeScore: number;
  riskAdjustedScore: number;
  strategyGrade: string;
  riskLevel: string;
  kellyPercentage: number;
  
  // Walk-forward specific
  consistencyScore: number;
  stabilityIndex: number;
  rollingMaxDrawdown: number;
  
  // Classification
  isTopPerformer: boolean;
  recommendation: string;
}

interface WindowAnalysis {
  windowNumber: number;
  startDate: Date;
  endDate: Date;
  trades: BacktestTrade[];
  metrics: EnhancedPerformanceMetrics;
  
  // Window-specific insights
  marketCondition: 'Bullish' | 'Bearish' | 'Sideways';
  performanceRank: number; // Rank among all windows
  riskRank: number;
}

interface WalkForwardResult {
  config: BacktestConfig;
  overallMetrics: EnhancedPerformanceMetrics;
  windowAnalyses: WindowAnalysis[];
  
  // Walk-forward insights
  bestWindow: WindowAnalysis;
  worstWindow: WindowAnalysis;
  mostConsistentPeriod: WindowAnalysis[];
  adaptabilityScore: number; // How well strategy adapts to different market conditions
  
  runId: string;
}

class EnhancedWindowedBacktester {
  private prisma: PrismaClient;
  private readonly TRADING_FEE = 0.001; // 0.1% per trade
  private readonly INITIAL_CAPITAL = 10000; // $10,000 USDT

  constructor() {
    this.prisma = new PrismaClient();
  }

  async initialize(): Promise<void> {
    await this.prisma.$connect();
    console.log('✅ Connected to database');
  }

  /**
   * Run enhanced walk-forward analysis
   */
  async runEnhancedWalkForward(config: BacktestConfig): Promise<WalkForwardResult> {
    console.log('🚀 Running Enhanced Walk-Forward Analysis...');
    console.log(`   Strategy: ${config.zScoreThreshold}/${config.profitPercent}%/${config.stopLossPercent}%`);
    console.log(`   Period: ${config.startTime.toISOString().split('T')[0]} to ${config.endTime.toISOString().split('T')[0]}`);
    console.log(`   Window Size: ${config.windowSize} months\n`);

    // Calculate number of windows
    const totalMonths = this.monthsBetweenDates(config.startTime, config.endTime);
    const numWindows = Math.floor(totalMonths / config.windowSize);
    
    if (numWindows < 2) {
      throw new Error('Need at least 2 windows for walk-forward analysis');
    }

    console.log(`   📊 Analyzing ${numWindows} windows of ${config.windowSize} months each...\n`);

    // Analyze each window
    const windowAnalyses: WindowAnalysis[] = [];
    const allWindowReturns: WindowResult[] = [];

    for (let i = 0; i < numWindows; i++) {
      const windowStart = this.addMonths(config.startTime, i * config.windowSize);
      const windowEnd = this.addMonths(windowStart, config.windowSize);
      
      console.log(`   Window ${i + 1}: ${windowStart.toISOString().split('T')[0]} to ${windowEnd.toISOString().split('T')[0]}`);

      const windowConfig = { ...config, startTime: windowStart, endTime: windowEnd };
      const windowResult = await this.runSingleWindow(windowConfig, i + 1);
      
      windowAnalyses.push(windowResult);
      
      // Convert to WindowResult for comprehensive analysis
      allWindowReturns.push({
        return: windowResult.metrics.totalReturn / 100, // Convert percentage to decimal
        duration: config.windowSize * 30, // Approximate days
        startDate: windowStart,
        endDate: windowEnd,
        trades: windowResult.trades.length
      });

      console.log(`      ✅ Return: ${windowResult.metrics.totalReturn.toFixed(2)}%, Calmar: ${windowResult.metrics.calmarRatio.toFixed(2)}, Grade: ${windowResult.metrics.strategyGrade}`);
    }

    // Comprehensive success analysis across all windows
    console.log('\n🧠 Calculating comprehensive success metrics...');
    const overallSuccessMetrics = BacktestSuccessAnalyzer.analyzeWindowResults(allWindowReturns);

    // Calculate overall metrics
    const overallMetrics = this.calculateOverallMetrics(windowAnalyses, overallSuccessMetrics);

    // Generate insights
    const insights = this.generateWalkForwardInsights(windowAnalyses);

    const result: WalkForwardResult = {
      config,
      overallMetrics,
      windowAnalyses,
      ...insights,
      runId: this.generateRunId()
    };

    // Save enhanced results
    await this.saveEnhancedResults(result);

    return result;
  }

  /**
   * Run a single window analysis
   */
  private async runSingleWindow(config: BacktestConfig, windowNumber: number): Promise<WindowAnalysis> {
    // Get price and rating data for window
    const { priceData, ratingData } = await this.getWindowData(config);
    
    // Calculate z-scores
    const zScoreData = this.calculateZScores(ratingData, config.movingAverages);
    
    // Execute trades
    const trades = this.executeTrades(priceData, zScoreData, config);
    
    // Calculate traditional metrics
    const traditionalMetrics = this.calculateTraditionalMetrics(trades, priceData, config);
    
    // Enhance with success metrics
    const enhancedMetrics = this.enhanceWithSuccessMetrics(
      traditionalMetrics, 
      trades, 
      config,
      windowNumber
    );

    // Determine market condition
    const marketCondition = this.determineMarketCondition(priceData);

    return {
      windowNumber,
      startDate: config.startTime,
      endDate: config.endTime,
      trades,
      metrics: enhancedMetrics,
      marketCondition,
      performanceRank: 0, // Will be calculated later
      riskRank: 0
    };
  }

  /**
   * Enhance traditional metrics with comprehensive success analysis
   */
  private enhanceWithSuccessMetrics(
    traditional: any, 
    trades: BacktestTrade[], 
    config: BacktestConfig,
    windowNumber: number
  ): EnhancedPerformanceMetrics {
    
    // Convert trades to window results for analysis
    const windowResult: WindowResult = {
      return: traditional.totalReturn / 100,
      duration: this.daysBetweenDates(config.startTime, config.endTime),
      startDate: config.startTime,
      endDate: config.endTime,
      trades: trades.length
    };

    // Single window analysis (for individual window metrics)
    const successMetrics = BacktestSuccessAnalyzer.analyzeWindowResults([windowResult]);

    // Calculate Calmar ratio
    const calmarRatio = traditional.maxDrawdown > 0 ? 
      traditional.annualizedReturn / traditional.maxDrawdown : 
      traditional.annualizedReturn > 0 ? 999 : 0;

    // Calculate consistency and stability for this window
    const tradeReturns = trades.map(t => t.profitLossPercent);
    const consistencyScore = this.calculateConsistency(tradeReturns);
    const stabilityIndex = this.calculateStability(tradeReturns);

    return {
      // Traditional metrics
      ...traditional,
      
      // Enhanced metrics
      calmarRatio,
      compositeScore: successMetrics.compositeScore,
      riskAdjustedScore: successMetrics.riskAdjustedScore,
      strategyGrade: successMetrics.strategyGrade,
      riskLevel: successMetrics.riskLevel,
      kellyPercentage: successMetrics.kellyPercentage,
      
      // Window-specific
      consistencyScore,
      stabilityIndex,
      rollingMaxDrawdown: traditional.maxDrawdown,
      
      // Classification
      isTopPerformer: successMetrics.compositeScore > 75,
      recommendation: successMetrics.recommendation
    };
  }

  /**
   * Calculate overall metrics from all windows
   */
  private calculateOverallMetrics(
    windowAnalyses: WindowAnalysis[], 
    overallSuccessMetrics: any
  ): EnhancedPerformanceMetrics {
    
    // Aggregate traditional metrics
    const totalReturn = windowAnalyses.reduce((product, w) => 
      product * (1 + w.metrics.totalReturn / 100), 1) - 1;
    
    const avgAnnualizedReturn = windowAnalyses.reduce((sum, w) => 
      sum + w.metrics.annualizedReturn, 0) / windowAnalyses.length;
    
    const avgSharpeRatio = windowAnalyses.reduce((sum, w) => 
      sum + w.metrics.sharpeRatio, 0) / windowAnalyses.length;
    
    const maxDrawdown = Math.max(...windowAnalyses.map(w => w.metrics.maxDrawdown));
    
    const avgWinRatio = windowAnalyses.reduce((sum, w) => 
      sum + w.metrics.winRatio, 0) / windowAnalyses.length;
    
    const totalTrades = windowAnalyses.reduce((sum, w) => 
      sum + w.metrics.totalTrades, 0);

    // Calculate overall Calmar ratio
    const overallCalmarRatio = maxDrawdown > 0 ? avgAnnualizedReturn / maxDrawdown : 999;

    return {
      // Traditional aggregated
      totalReturn: totalReturn * 100,
      annualizedReturn: avgAnnualizedReturn,
      benchmarkReturn: 0,
      sharpeRatio: avgSharpeRatio,
      sortinoRatio: overallSuccessMetrics.sortinoRatio,
      alpha: 0,
      maxDrawdown,
      annualizedVolatility: 0,
      winRatio: avgWinRatio,
      profitFactor: overallSuccessMetrics.profitFactor,
      totalTrades,
      avgTradeDuration: 0,
      
      // Enhanced from comprehensive analysis
      calmarRatio: overallCalmarRatio,
      compositeScore: overallSuccessMetrics.compositeScore,
      riskAdjustedScore: overallSuccessMetrics.riskAdjustedScore,
      strategyGrade: overallSuccessMetrics.strategyGrade,
      riskLevel: overallSuccessMetrics.riskLevel,
      kellyPercentage: overallSuccessMetrics.kellyPercentage,
      
      // Walk-forward specific
      consistencyScore: overallSuccessMetrics.consistency,
      stabilityIndex: overallSuccessMetrics.stabilityIndex,
      rollingMaxDrawdown: maxDrawdown,
      
      // Overall classification
      isTopPerformer: overallSuccessMetrics.compositeScore > 75,
      recommendation: overallSuccessMetrics.recommendation
    };
  }

  /**
   * Generate walk-forward specific insights
   */
  private generateWalkForwardInsights(windowAnalyses: WindowAnalysis[]): {
    bestWindow: WindowAnalysis;
    worstWindow: WindowAnalysis;
    mostConsistentPeriod: WindowAnalysis[];
    adaptabilityScore: number;
  } {
    // Rank windows by performance
    const sortedByPerformance = [...windowAnalyses]
      .sort((a, b) => b.metrics.calmarRatio - a.metrics.calmarRatio);
    
    sortedByPerformance.forEach((window, index) => {
      window.performanceRank = index + 1;
    });

    // Rank by risk
    const sortedByRisk = [...windowAnalyses]
      .sort((a, b) => a.metrics.maxDrawdown - b.metrics.maxDrawdown);
    
    sortedByRisk.forEach((window, index) => {
      window.riskRank = index + 1;
    });

    const bestWindow = sortedByPerformance[0];
    const worstWindow = sortedByPerformance[sortedByPerformance.length - 1];

    // Find most consistent period (3+ consecutive windows with good performance)
    const consistentPeriods: WindowAnalysis[][] = [];
    let currentPeriod: WindowAnalysis[] = [];

    for (const window of windowAnalyses) {
      if (window.metrics.compositeScore > 60) {
        currentPeriod.push(window);
      } else {
        if (currentPeriod.length >= 3) {
          consistentPeriods.push([...currentPeriod]);
        }
        currentPeriod = [];
      }
    }

    if (currentPeriod.length >= 3) {
      consistentPeriods.push(currentPeriod);
    }

    const mostConsistentPeriod = consistentPeriods.length > 0 ? 
      consistentPeriods.reduce((longest, current) => 
        current.length > longest.length ? current : longest) : [];

    // Calculate adaptability score (performance across different market conditions)
    const marketConditions = ['Bullish', 'Bearish', 'Sideways'] as const;
    const adaptabilityScores = marketConditions.map(condition => {
      const windowsInCondition = windowAnalyses.filter(w => w.marketCondition === condition);
      if (windowsInCondition.length === 0) return 50; // Neutral if no data
      
      const avgScore = windowsInCondition.reduce((sum, w) => 
        sum + w.metrics.compositeScore, 0) / windowsInCondition.length;
      return avgScore;
    });

    const adaptabilityScore = adaptabilityScores.reduce((sum, score) => sum + score, 0) / 3;

    return {
      bestWindow,
      worstWindow,
      mostConsistentPeriod,
      adaptabilityScore
    };
  }

  /**
   * Helper methods (simplified versions of the original backtest logic)
   */
  private async getWindowData(config: BacktestConfig) {
    // Get price data
    const priceData = await this.prisma.klines.findMany({
      where: {
        symbol: `${config.baseAsset}${config.quoteAsset}`,
        openTime: {
          gte: config.startTime,
          lte: config.endTime
        }
      },
      orderBy: { openTime: 'asc' }
    });

    // Get rating data
    const ratingData = await this.prisma.glickoRatings.findMany({
      where: {
        symbol: `${config.baseAsset}${config.quoteAsset}`,
        timestamp: {
          gte: config.startTime,
          lte: config.endTime
        }
      },
      orderBy: { timestamp: 'asc' }
    });

    return {
      priceData: priceData.map(p => ({
        timestamp: p.openTime,
        price: parseFloat(p.close.toString())
      })),
      ratingData: ratingData.map(r => ({
        timestamp: r.timestamp,
        rating: parseFloat(r.rating.toString())
      }))
    };
  }

  private calculateZScores(
    ratings: Array<{ timestamp: Date; rating: number }>,
    movingAveragePeriod: number
  ) {
    // Simplified z-score calculation
    const results = [];
    for (let i = movingAveragePeriod; i < ratings.length; i++) {
      const window = ratings.slice(i - movingAveragePeriod, i);
      const mean = window.reduce((sum, r) => sum + r.rating, 0) / window.length;
      const variance = window.reduce((sum, r) => sum + Math.pow(r.rating - mean, 2), 0) / window.length;
      const stdDev = Math.sqrt(variance);
      const zScore = stdDev > 0 ? (ratings[i].rating - mean) / stdDev : 0;
      
      results.push({
        timestamp: ratings[i].timestamp,
        rating: ratings[i].rating,
        zScore,
        movingAverage: mean
      });
    }
    return results;
  }

  private executeTrades(priceData: any[], zScoreData: any[], config: BacktestConfig): BacktestTrade[] {
    // Simplified trade execution logic with OCO order implementation
    const trades: BacktestTrade[] = [];
    let position: { side: 'LONG' | 'SHORT'; entryPrice: number; entryTime: Date; takeProfitPrice: number; stopLossPrice: number } | null = null;

    for (let i = 0; i < Math.min(priceData.length, zScoreData.length); i++) {
      const currentPrice = priceData[i].price;
      const zScore = zScoreData[i]?.zScore || 0;
      const timestamp = priceData[i].timestamp;

      // Entry logic
      if (!position) {
        if (zScore > config.zScoreThreshold) {
          position = {
            side: 'LONG',
            entryPrice: currentPrice,
            entryTime: timestamp,
            takeProfitPrice: currentPrice * (1 + config.profitPercent / 100),
            stopLossPrice: currentPrice * (1 - config.stopLossPercent / 100)
          };
        } else if (zScore < -config.zScoreThreshold) {
          position = {
            side: 'SHORT',
            entryPrice: currentPrice,
            entryTime: timestamp,
            takeProfitPrice: currentPrice * (1 - config.profitPercent / 100),
            stopLossPrice: currentPrice * (1 + config.stopLossPercent / 100)
          };
        }
      }
      // Exit logic with OCO order simulation
      else {
        let exitReason: 'EXIT_ZSCORE' | 'EXIT_PROFIT' | 'EXIT_STOP' | null = null;
        let actualExitPrice: number;

        // Check z-score reversal first
        if (Math.abs(zScore) < 0.5) {
          exitReason = 'EXIT_ZSCORE';
          actualExitPrice = currentPrice; // Market order at current price
        }
        // Check take-profit for LONG positions
        else if (position.side === 'LONG' && currentPrice >= position.takeProfitPrice) {
          exitReason = 'EXIT_PROFIT';
          actualExitPrice = position.takeProfitPrice; // Limit order executed at exact target
        }
        // Check stop-loss for LONG positions
        else if (position.side === 'LONG' && currentPrice <= position.stopLossPrice) {
          exitReason = 'EXIT_STOP';
          actualExitPrice = position.stopLossPrice; // Stop-loss executed at exact level
        }
        // Check take-profit for SHORT positions
        else if (position.side === 'SHORT' && currentPrice <= position.takeProfitPrice) {
          exitReason = 'EXIT_PROFIT';
          actualExitPrice = position.takeProfitPrice; // Limit order executed at exact target
        }
        // Check stop-loss for SHORT positions
        else if (position.side === 'SHORT' && currentPrice >= position.stopLossPrice) {
          exitReason = 'EXIT_STOP';
          actualExitPrice = position.stopLossPrice; // Stop-loss executed at exact level
        }

        if (exitReason) {
          const side = position.side === 'LONG' ? 'BUY' : 'SELL';
          const profitLossPercent = position.side === 'LONG' ? 
            (actualExitPrice - position.entryPrice) / position.entryPrice * 100 :
            (position.entryPrice - actualExitPrice) / position.entryPrice * 100;

          trades.push({
            entryTime: position.entryTime,
            exitTime: timestamp,
            side,
            entryPrice: position.entryPrice,
            exitPrice: actualExitPrice, // Use OCO-determined exit price
            quantity: 1,
            reason: exitReason,
            profitLoss: profitLossPercent * this.INITIAL_CAPITAL / 100,
            profitLossPercent,
            duration: (timestamp.getTime() - position.entryTime.getTime()) / (1000 * 60 * 60)
          });

          position = null;
        }
      }
    }

    return trades;
  }

  private calculateTraditionalMetrics(trades: BacktestTrade[], priceData: any[], config: BacktestConfig) {
    // Simplified traditional metrics calculation
    const totalReturn = trades.reduce((sum, t) => sum + t.profitLossPercent, 0);
    const winningTrades = trades.filter(t => t.profitLoss > 0);
    const losingTrades = trades.filter(t => t.profitLoss < 0);
    
    const winRatio = trades.length > 0 ? winningTrades.length / trades.length : 0;
    const totalWins = winningTrades.reduce((sum, t) => sum + t.profitLoss, 0);
    const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + t.profitLoss, 0));
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : 999;

    // Calculate drawdown
    let runningReturn = 0;
    let peak = 0;
    let maxDrawdown = 0;
    
    for (const trade of trades) {
      runningReturn += trade.profitLossPercent;
      peak = Math.max(peak, runningReturn);
      const drawdown = peak - runningReturn;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }

    const days = this.daysBetweenDates(config.startTime, config.endTime);
    const annualizedReturn = totalReturn * (365 / days);

    return {
      totalReturn,
      annualizedReturn,
      maxDrawdown,
      winRatio,
      profitFactor,
      sharpeRatio: 0.5, // Simplified
      sortinoRatio: 0.6, // Simplified
      totalTrades: trades.length
    };
  }

  private calculateConsistency(tradeReturns: number[]): number {
    if (tradeReturns.length === 0) return 0;
    const positiveReturns = tradeReturns.filter(r => r > 0).length;
    return (positiveReturns / tradeReturns.length) * 100;
  }

  private calculateStability(tradeReturns: number[]): number {
    if (tradeReturns.length === 0) return 0;
    const mean = tradeReturns.reduce((sum, r) => sum + r, 0) / tradeReturns.length;
    const variance = tradeReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / tradeReturns.length;
    const stdDev = Math.sqrt(variance);
    return stdDev === 0 ? 100 : Math.max(0, 100 - (stdDev / Math.abs(mean)) * 100);
  }

  private determineMarketCondition(priceData: any[]): 'Bullish' | 'Bearish' | 'Sideways' {
    if (priceData.length < 2) return 'Sideways';
    
    const firstPrice = priceData[0].price;
    const lastPrice = priceData[priceData.length - 1].price;
    const change = (lastPrice - firstPrice) / firstPrice;
    
    if (change > 0.1) return 'Bullish';
    if (change < -0.1) return 'Bearish';
    return 'Sideways';
  }

  /**
   * Save enhanced results to database
   */
  private async saveEnhancedResults(result: WalkForwardResult): Promise<void> {
    try {
      // Save enhanced optimization result
      await this.prisma.optimizationResults.create({
        data: {
          runId: result.runId,
          baseAsset: result.config.baseAsset,
          quoteAsset: result.config.quoteAsset,
          zScoreThreshold: result.config.zScoreThreshold,
          movingAverages: result.config.movingAverages,
          profitPercent: result.config.profitPercent,
          stopLossPercent: result.config.stopLossPercent,
          startTime: result.config.startTime,
          endTime: result.config.endTime,
          totalReturn: result.overallMetrics.totalReturn,
          annualizedReturn: result.overallMetrics.annualizedReturn,
          sharpeRatio: result.overallMetrics.sharpeRatio,
          sortinoRatio: result.overallMetrics.sortinoRatio,
          alpha: result.overallMetrics.alpha,
          maxDrawdown: result.overallMetrics.maxDrawdown,
          winRatio: result.overallMetrics.winRatio,
          totalTrades: result.overallMetrics.totalTrades,
          profitFactor: result.overallMetrics.profitFactor,
          avgTradeDuration: result.overallMetrics.avgTradeDuration,
          // Note: Add these fields to your database schema
          // calmarRatio: result.overallMetrics.calmarRatio,
          // compositeScore: result.overallMetrics.compositeScore,
          // strategyGrade: result.overallMetrics.strategyGrade
        }
      });

      console.log(`   ✅ Saved enhanced results to database`);
    } catch (error) {
      console.error('❌ Error saving enhanced results:', error);
    }
  }

  /**
   * Generate comprehensive HTML report
   */
  generateEnhancedHTMLReport(result: WalkForwardResult): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Enhanced Walk-Forward Analysis - ${result.config.baseAsset}/${result.config.quoteAsset}</title>
    <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
    <style>
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            margin: 20px; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container { 
            background: white; 
            border-radius: 15px; 
            padding: 30px; 
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        }
        .header { text-align: center; margin-bottom: 30px; color: #2c3e50; }
        .metrics-grid { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); 
            gap: 20px; 
            margin-bottom: 30px;
        }
        .metric-card { 
            background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
            border-radius: 10px; 
            padding: 20px; 
            text-align: center;
        }
        .metric-value { font-size: 2em; font-weight: bold; color: #2c3e50; }
        .metric-label { color: #7f8c8d; margin-top: 10px; }
        .grade-a { border-left: 5px solid #27ae60; }
        .grade-b { border-left: 5px solid #f39c12; }
        .grade-c { border-left: 5px solid #e74c3c; }
        .window-analysis { margin-top: 30px; }
        .window-row { 
            display: grid; 
            grid-template-columns: 1fr 1fr 1fr 1fr 1fr 1fr;
            padding: 10px;
            border-bottom: 1px solid #ecf0f1;
        }
        .window-header { 
            background: #34495e; 
            color: white; 
            font-weight: bold;
            border-radius: 5px 5px 0 0;
        }
        .insights { 
            background: linear-gradient(135deg, #a8e6cf 0%, #dcedc1 100%);
            border-radius: 10px; 
            padding: 20px; 
            margin-top: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎯 Enhanced Walk-Forward Analysis</h1>
            <h2>${result.config.baseAsset}/${result.config.quoteAsset}</h2>
            <p>Strategy: Z-Score ${result.config.zScoreThreshold} | Profit ${result.config.profitPercent}% | Stop ${result.config.stopLossPercent}%</p>
            <p>Period: ${result.config.startTime.toISOString().split('T')[0]} to ${result.config.endTime.toISOString().split('T')[0]}</p>
        </div>

        <div class="metrics-grid">
            <div class="metric-card grade-${result.overallMetrics.strategyGrade.toLowerCase().charAt(0)}">
                <div class="metric-value">${result.overallMetrics.calmarRatio.toFixed(2)}</div>
                <div class="metric-label">Calmar Ratio<br>(Return/Drawdown)</div>
            </div>
            
            <div class="metric-card">
                <div class="metric-value">${result.overallMetrics.strategyGrade}</div>
                <div class="metric-label">Strategy Grade</div>
            </div>
            
            <div class="metric-card">
                <div class="metric-value">${result.overallMetrics.compositeScore.toFixed(1)}</div>
                <div class="metric-label">Composite Score /100</div>
            </div>
            
            <div class="metric-card">
                <div class="metric-value">${(result.overallMetrics.kellyPercentage * 100).toFixed(1)}%</div>
                <div class="metric-label">Optimal Position Size</div>
            </div>
            
            <div class="metric-card">
                <div class="metric-value">${result.overallMetrics.annualizedReturn.toFixed(1)}%</div>
                <div class="metric-label">Annualized Return</div>
            </div>
            
            <div class="metric-card">
                <div class="metric-value">${result.overallMetrics.maxDrawdown.toFixed(1)}%</div>
                <div class="metric-label">Max Drawdown</div>
            </div>
        </div>

        <div class="insights">
            <h3>🔍 Walk-Forward Insights</h3>
            <ul>
                <li><strong>Best Window:</strong> Window ${result.bestWindow.windowNumber} (${result.bestWindow.startDate.toISOString().split('T')[0]}) - Calmar: ${result.bestWindow.metrics.calmarRatio.toFixed(2)}</li>
                <li><strong>Worst Window:</strong> Window ${result.worstWindow.windowNumber} (${result.worstWindow.startDate.toISOString().split('T')[0]}) - Calmar: ${result.worstWindow.metrics.calmarRatio.toFixed(2)}</li>
                <li><strong>Consistency:</strong> ${result.mostConsistentPeriod.length > 0 ? `${result.mostConsistentPeriod.length} consecutive good windows` : 'No sustained consistent periods'}</li>
                <li><strong>Adaptability Score:</strong> ${result.adaptabilityScore.toFixed(1)}/100 (performance across different market conditions)</li>
                <li><strong>Overall Recommendation:</strong> ${result.overallMetrics.recommendation}</li>
            </ul>
        </div>

        <div class="window-analysis">
            <h3>📊 Window-by-Window Analysis</h3>
            <div class="window-row window-header">
                <div>Window</div>
                <div>Period</div>
                <div>Return %</div>
                <div>Calmar Ratio</div>
                <div>Grade</div>
                <div>Market</div>
            </div>
            ${result.windowAnalyses.map(window => `
                <div class="window-row">
                    <div>#${window.windowNumber}</div>
                    <div>${window.startDate.toISOString().split('T')[0]}</div>
                    <div>${window.metrics.totalReturn.toFixed(1)}%</div>
                    <div>${window.metrics.calmarRatio.toFixed(2)}</div>
                    <div>${window.metrics.strategyGrade}</div>
                    <div>${window.marketCondition}</div>
                </div>
            `).join('')}
        </div>

        <div id="calmarChart" style="width: 100%; height: 400px; margin-top: 30px;"></div>
        <div id="gradeChart" style="width: 100%; height: 400px; margin-top: 20px;"></div>

        <script>
            // Calmar Ratio over time
            const calmarTrace = {
                x: [${result.windowAnalyses.map(w => `'Window ${w.windowNumber}'`).join(', ')}],
                y: [${result.windowAnalyses.map(w => w.metrics.calmarRatio).join(', ')}],
                type: 'scatter',
                mode: 'lines+markers',
                name: 'Calmar Ratio',
                line: { color: '#3498db', width: 3 },
                marker: { size: 8 }
            };

            Plotly.newPlot('calmarChart', [calmarTrace], {
                title: 'Calmar Ratio Evolution (Walk-Forward)',
                xaxis: { title: 'Window' },
                yaxis: { title: 'Calmar Ratio (Return/Drawdown)' },
                showlegend: false
            });

            // Strategy grades distribution
            const grades = ['A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'F'];
            const gradeCounts = grades.map(grade => 
                ${JSON.stringify(result.windowAnalyses)}.filter(w => w.metrics.strategyGrade === grade).length
            );

            const gradeTrace = {
                x: grades,
                y: gradeCounts,
                type: 'bar',
                marker: { color: ['#27ae60', '#2ecc71', '#f39c12', '#e67e22', '#e74c3c', '#c0392b', '#8e44ad', '#2c3e50'] }
            };

            Plotly.newPlot('gradeChart', [gradeTrace], {
                title: 'Strategy Grade Distribution Across Windows',
                xaxis: { title: 'Grade' },
                yaxis: { title: 'Number of Windows' }
            });
        </script>
    </div>
</body>
</html>`;
  }

  // Utility methods
  private monthsBetweenDates(start: Date, end: Date): number {
    const months = (end.getFullYear() - start.getFullYear()) * 12;
    return months + (end.getMonth() - start.getMonth());
  }

  private daysBetweenDates(start: Date, end: Date): number {
    return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  }

  private addMonths(date: Date, months: number): Date {
    const result = new Date(date);
    result.setMonth(result.getMonth() + months);
    return result;
  }

  private generateRunId(): string {
    return `enhanced-wf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length !== 8) {
    console.error('Usage: npm run runWindowedBacktest-enhanced startTime windowSize baseAsset quoteAsset zScoreThreshold movingAverages profitPercent stopLossPercent');
    console.error('Example: npm run runWindowedBacktest-enhanced "2022-01-01" 12 ETH USDT 3.0 200 5.0 2.5');
    process.exit(1);
  }

  const config: BacktestConfig = {
    startTime: new Date(args[0]),
    endTime: new Date(), // Current time
    windowSize: parseInt(args[1]),
    baseAsset: args[2],
    quoteAsset: args[3],
    zScoreThreshold: parseFloat(args[4]),
    movingAverages: parseInt(args[5]),
    profitPercent: parseFloat(args[6]),
    stopLossPercent: parseFloat(args[7])
  };

  const backtester = new EnhancedWindowedBacktester();
  
  try {
    await backtester.initialize();
    const result = await backtester.runEnhancedWalkForward(config);
    
    // Generate report
    const html = backtester.generateEnhancedHTMLReport(result);
    const filename = `enhanced-walk-forward-${config.baseAsset}-${config.quoteAsset}-${Date.now()}.html`;
    const filepath = path.join(process.cwd(), 'analysis', filename);
    
    // Ensure directory exists
    if (!fs.existsSync(path.dirname(filepath))) {
      fs.mkdirSync(path.dirname(filepath), { recursive: true });
    }
    
    fs.writeFileSync(filepath, html);
    
    console.log('\n🎉 Enhanced Walk-Forward Analysis Complete!');
    console.log(`📁 Report: ${filepath}`);
    console.log(`🌐 Open: file://${filepath}`);
    
    console.log('\n📊 SUMMARY:');
    console.log(`   Overall Calmar Ratio: ${result.overallMetrics.calmarRatio.toFixed(2)}`);
    console.log(`   Strategy Grade: ${result.overallMetrics.strategyGrade}`);
    console.log(`   Composite Score: ${result.overallMetrics.compositeScore.toFixed(1)}/100`);
    console.log(`   Optimal Position Size: ${(result.overallMetrics.kellyPercentage * 100).toFixed(1)}%`);
    console.log(`   Best Window: #${result.bestWindow.windowNumber} (Calmar: ${result.bestWindow.metrics.calmarRatio.toFixed(2)})`);
    console.log(`   Adaptability Score: ${result.adaptabilityScore.toFixed(1)}/100`);
    
  } catch (error) {
    console.error('❌ Analysis failed:', error);
  } finally {
    await backtester.cleanup();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { EnhancedWindowedBacktester, WalkForwardResult };