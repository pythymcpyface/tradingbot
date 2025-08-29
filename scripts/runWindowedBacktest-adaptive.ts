#!/usr/bin/env ts-node

/**
 * Adaptive Windowed Backtest Script
 * 
 * This script is a modified version of runWindowedBacktest.ts that adapts to sparse data
 * by using intelligent minimum thresholds based on data density.
 */

import { PrismaClient } from '@prisma/client';
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

interface PerformanceMetrics {
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
}

interface BacktestResult {
  config: BacktestConfig;
  trades: BacktestTrade[];
  metrics: PerformanceMetrics;
  equityCurve: Array<{ timestamp: Date; value: number }>;
  priceData: Array<{ timestamp: Date; price: number }>;
  runId: string;
}

class AdaptiveWindowedBacktester {
  private prisma: PrismaClient;
  private readonly TRADING_FEE = 0.001; // 0.1% per trade
  private readonly INITIAL_CAPITAL = 10000; // $10,000 USDT

  constructor() {
    this.prisma = new PrismaClient();
  }

  async initialize(): Promise<void> {
    try {
      await this.prisma.$connect();
      console.log('✅ Connected to database');
    } catch (error) {
      console.error('❌ Database connection failed:', error);
      throw error;
    }
  }

  /**
   * Calculate adaptive minimum threshold based on data characteristics
   */
  private async calculateAdaptiveMinimum(
    symbol: string,
    startTime: Date,
    endTime: Date,
    movingAverages: number
  ): Promise<{ minimum: number; recommended: number; analysis: string }> {
    
    // Get data density for this asset
    const totalRatings = await this.prisma.glickoRatings.count({
      where: { symbol }
    });
    
    const dateRange = await this.prisma.glickoRatings.aggregate({
      where: { symbol },
      _min: { timestamp: true },
      _max: { timestamp: true }
    });
    
    if (!dateRange._min.timestamp || !dateRange._max.timestamp || totalRatings === 0) {
      throw new Error(`No Glicko ratings found for ${symbol}`);
    }
    
    const totalDays = (dateRange._max.timestamp.getTime() - dateRange._min.timestamp.getTime()) / (1000 * 60 * 60 * 24);
    const dataDensity = totalRatings / totalDays; // ratings per day
    
    const windowDays = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24);
    const expectedRatings = Math.floor(dataDensity * windowDays);
    
    // Adaptive thresholds based on data characteristics
    const minimumForMA = movingAverages * 2; // Need at least 2x MA period for stable calculations
    const minimumForSignals = Math.max(30, Math.floor(expectedRatings * 0.3)); // At least 30 or 30% of expected data
    const minimum = Math.max(minimumForMA, minimumForSignals);
    
    // Recommended is higher for better statistical significance
    const recommended = Math.max(minimum * 1.5, movingAverages * 3);
    
    const analysis = `
Asset: ${symbol}
Data density: ${dataDensity.toFixed(2)} ratings/day
Window: ${windowDays.toFixed(0)} days
Expected ratings: ${expectedRatings}
Minimum threshold: ${minimum} (vs hardcoded 110)
Recommended: ${recommended}`;

    return { minimum, recommended, analysis };
  }

  /**
   * Calculate z-scores for the given ratings and moving average period
   */
  private calculateZScores(
    ratings: Array<{ timestamp: Date; rating: number }>,
    movingAveragePeriod: number
  ): Array<{ timestamp: Date; rating: number; zScore: number; movingAverage: number }> {
    const results: Array<{ timestamp: Date; rating: number; zScore: number; movingAverage: number }> = [];

    for (let i = movingAveragePeriod; i < ratings.length; i++) {
      const window = ratings.slice(i - movingAveragePeriod, i);
      const currentRating = ratings[i].rating;
      
      const mean = window.reduce((sum, r) => sum + r.rating, 0) / window.length;
      const variance = window.reduce((sum, r) => sum + Math.pow(r.rating - mean, 2), 0) / window.length;
      const stdDev = Math.sqrt(variance);
      
      const zScore = stdDev > 0 ? (currentRating - mean) / stdDev : 0;
      
      results.push({
        timestamp: ratings[i].timestamp,
        rating: currentRating,
        zScore,
        movingAverage: mean
      });
    }

    return results;
  }

  /**
   * Get price data for the specified period
   */
  private async getPriceData(
    symbol: string,
    startTime: Date,
    endTime: Date
  ): Promise<Array<{ timestamp: Date; price: number }>> {
    const klines = await this.prisma.klines.findMany({
      where: {
        symbol: symbol,
        openTime: {
          gte: startTime,
          lte: endTime
        }
      },
      select: {
        openTime: true,
        close: true
      },
      orderBy: { openTime: 'asc' }
    });

    return klines.map(k => ({
      timestamp: k.openTime,
      price: parseFloat(k.close.toString())
    }));
  }

  /**
   * Run the backtest simulation with adaptive thresholds
   */
  async runBacktest(config: BacktestConfig): Promise<BacktestResult> {
    console.log(`📊 Running adaptive backtest: ${config.baseAsset}/${config.quoteAsset}`);
    console.log(`   Period: ${config.startTime.toISOString().split('T')[0]} to ${config.endTime.toISOString().split('T')[0]}`);
    console.log(`   Parameters: Z=${config.zScoreThreshold}, MA=${config.movingAverages}, P=${config.profitPercent}%, SL=${config.stopLossPercent}%`);

    const symbol = `${config.baseAsset}${config.quoteAsset}`;
    const runId = `${symbol}_${config.startTime.toISOString().split('T')[0]}_${config.endTime.toISOString().split('T')[0]}_${Date.now()}`;

    // Calculate adaptive minimum threshold
    const adaptiveParams = await this.calculateAdaptiveMinimum(
      config.baseAsset,
      config.startTime,
      config.endTime,
      config.movingAverages
    );
    
    console.log(`📈 Adaptive threshold analysis:${adaptiveParams.analysis}`);

    // Get Glicko ratings with buffer for moving average
    const ratingsData = await this.prisma.glickoRatings.findMany({
      where: {
        symbol: config.baseAsset,
        timestamp: {
          gte: new Date(config.startTime.getTime() - config.movingAverages * 60 * 60 * 1000), // Extra data for MA
          lte: config.endTime
        }
      },
      orderBy: { timestamp: 'asc' }
    });

    console.log(`   📊 Retrieved ${ratingsData.length} Glicko ratings`);
    console.log(`   🎯 Minimum required: ${adaptiveParams.minimum}, Recommended: ${adaptiveParams.recommended}`);

    if (ratingsData.length < adaptiveParams.minimum) {
      throw new Error(`Insufficient Glicko ratings data for ${config.baseAsset}. Need at least ${adaptiveParams.minimum} points, got ${ratingsData.length}. This window has too sparse data for reliable analysis.`);
    }

    if (ratingsData.length < adaptiveParams.recommended) {
      console.log(`   ⚠️ Warning: Using ${ratingsData.length} ratings (below recommended ${adaptiveParams.recommended}). Results may be less reliable.`);
    }

    const ratings = ratingsData.map(r => ({
      timestamp: r.timestamp,
      rating: parseFloat(r.rating.toString())
    }));

    // Calculate z-scores
    const zScores = this.calculateZScores(ratings, config.movingAverages);
    console.log(`   ✅ Calculated ${zScores.length} z-score data points`);

    if (zScores.length === 0) {
      throw new Error(`No z-score data points calculated. Need more historical data before start time for moving average calculation.`);
    }

    // Get price data
    const priceData = await this.getPriceData(symbol, config.startTime, config.endTime);
    console.log(`   ✅ Retrieved ${priceData.length} price data points`);

    if (priceData.length === 0) {
      throw new Error(`No price data found for ${symbol} in the specified period`);
    }

    // Create price lookup map
    const priceMap = new Map<string, number>();
    for (const price of priceData) {
      const key = price.timestamp.getTime().toString();
      priceMap.set(key, price.price);
    }

    // Run simulation
    const trades: BacktestTrade[] = [];
    let position: { entryTime: Date; entryPrice: number; quantity: number; takeProfitPrice: number; stopLossPrice: number } | null = null;
    let cash = this.INITIAL_CAPITAL;
    const equityCurve: Array<{ timestamp: Date; value: number }> = [];

    for (const zScore of zScores) {
      if (zScore.timestamp < config.startTime) continue;
      if (zScore.timestamp > config.endTime) break;

      const currentPrice = priceMap.get(zScore.timestamp.getTime().toString());
      if (!currentPrice) continue;

      const currentEquity = position 
        ? (position.quantity * currentPrice) + cash
        : cash;

      equityCurve.push({
        timestamp: zScore.timestamp,
        value: currentEquity
      });

      // Check for entry signal (no position and strong positive z-score)
      if (!position && zScore.zScore >= config.zScoreThreshold) {
        const quantity = (cash * 0.95) / currentPrice; // Use 95% of cash, leave 5% as buffer
        const fees = quantity * currentPrice * this.TRADING_FEE;
        
        position = {
          entryTime: zScore.timestamp,
          entryPrice: currentPrice,
          quantity: quantity,
          takeProfitPrice: currentPrice * (1 + config.profitPercent / 100),
          stopLossPrice: currentPrice * (1 - config.stopLossPercent / 100)
        };

        cash -= (quantity * currentPrice + fees);
        console.log(`   📈 BUY: ${quantity.toFixed(6)} ${config.baseAsset} at $${currentPrice.toFixed(4)} (z-score: ${zScore.zScore.toFixed(2)})`);
      }

      // Check for exit signals
      if (position) {
        let exitReason: 'EXIT_ZSCORE' | 'EXIT_PROFIT' | 'EXIT_STOP' | null = null;

        // Exit on negative z-score (rating reversion)
        if (zScore.zScore <= -config.zScoreThreshold) {
          exitReason = 'EXIT_ZSCORE';
        }
        // Exit on take-profit
        else if (currentPrice >= position.takeProfitPrice) {
          exitReason = 'EXIT_PROFIT';
        }
        // Exit on stop-loss
        else if (currentPrice <= position.stopLossPrice) {
          exitReason = 'EXIT_STOP';
        }

        if (exitReason) {
          // Determine actual exit price based on OCO order logic
          let actualExitPrice: number;
          
          if (exitReason === 'EXIT_PROFIT') {
            // Take profit limit order executed at exact profit target
            actualExitPrice = position.takeProfitPrice;
          } else if (exitReason === 'EXIT_STOP') {
            // Stop loss limit order executed at exact stop loss level
            actualExitPrice = position.stopLossPrice;
          } else {
            // EXIT_ZSCORE - market order at current price
            actualExitPrice = currentPrice;
          }
          
          const proceeds = position.quantity * actualExitPrice;
          const fees = proceeds * this.TRADING_FEE;
          const netProceeds = proceeds - fees;
          
          cash += netProceeds;
          
          const profitLoss = netProceeds - (position.quantity * position.entryPrice);
          const profitLossPercent = (profitLoss / (position.quantity * position.entryPrice)) * 100;
          const duration = (zScore.timestamp.getTime() - position.entryTime.getTime()) / (1000 * 60 * 60); // hours

          trades.push({
            entryTime: position.entryTime,
            exitTime: zScore.timestamp,
            side: 'BUY',
            entryPrice: position.entryPrice,
            exitPrice: actualExitPrice, // Use OCO-determined exit price
            quantity: position.quantity,
            reason: exitReason,
            profitLoss,
            profitLossPercent,
            duration
          });

          console.log(`   📉 SELL: ${position.quantity.toFixed(6)} ${config.baseAsset} at $${actualExitPrice.toFixed(4)} (${exitReason}, P&L: ${profitLossPercent.toFixed(2)}%)`);
          
          position = null;
        }
      }
    }

    // Force close any remaining position at the end
    if (position) {
      const finalPrice = priceData[priceData.length - 1]?.price || position.entryPrice;
      const proceeds = position.quantity * finalPrice;
      const fees = proceeds * this.TRADING_FEE;
      const netProceeds = proceeds - fees;
      
      cash += netProceeds;
      
      const profitLoss = netProceeds - (position.quantity * position.entryPrice);
      const profitLossPercent = (profitLoss / (position.quantity * position.entryPrice)) * 100;
      const duration = (config.endTime.getTime() - position.entryTime.getTime()) / (1000 * 60 * 60);

      trades.push({
        entryTime: position.entryTime,
        exitTime: config.endTime,
        side: 'BUY',
        entryPrice: position.entryPrice,
        exitPrice: finalPrice,
        quantity: position.quantity,
        reason: 'EXIT_STOP', // Force close
        profitLoss,
        profitLossPercent,
        duration
      });
    }

    console.log(`   ✅ Simulation complete: ${trades.length} trades executed`);

    // Calculate performance metrics
    const metrics = this.calculatePerformanceMetrics(trades, equityCurve, priceData, config);
    
    // Save to database
    await this.saveBacktestResults(runId, config, trades, metrics);

    return {
      config,
      trades,
      metrics,
      equityCurve,
      priceData,
      runId
    };
  }

  /**
   * Calculate comprehensive performance metrics
   */
  private calculatePerformanceMetrics(
    trades: BacktestTrade[],
    equityCurve: Array<{ timestamp: Date; value: number }>,
    priceData: Array<{ timestamp: Date; price: number }>,
    config: BacktestConfig
  ): PerformanceMetrics {
    const finalEquity = equityCurve[equityCurve.length - 1]?.value || this.INITIAL_CAPITAL;
    const totalReturn = ((finalEquity - this.INITIAL_CAPITAL) / this.INITIAL_CAPITAL) * 100;
    
    // Calculate time period in years
    const periodDays = (config.endTime.getTime() - config.startTime.getTime()) / (1000 * 60 * 60 * 24);
    const periodYears = periodDays / 365.25;
    const annualizedReturn = Math.pow(finalEquity / this.INITIAL_CAPITAL, 1 / periodYears) - 1;

    // Calculate daily returns for risk metrics
    const dailyReturns: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      const returnPct = (equityCurve[i].value - equityCurve[i-1].value) / equityCurve[i-1].value;
      dailyReturns.push(returnPct);
    }

    // Risk metrics
    const meanReturn = dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / dailyReturns.length;
    const volatility = Math.sqrt(variance);
    const annualizedVolatility = volatility * Math.sqrt(365.25) * 100;

    // Sharpe ratio (assuming 2% risk-free rate)
    const riskFreeRate = 0.02;
    const excessReturn = annualizedReturn - riskFreeRate;
    const sharpeRatio = annualizedVolatility > 0 ? excessReturn / (annualizedVolatility / 100) : 0;

    // Sortino ratio (downside deviation only)
    const downsideReturns = dailyReturns.filter(r => r < 0);
    const downsideVariance = downsideReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / downsideReturns.length;
    const downsideDeviation = Math.sqrt(downsideVariance) * Math.sqrt(365.25);
    const sortinoRatio = downsideDeviation > 0 ? excessReturn / downsideDeviation : 0;

    // Max drawdown
    let peak = this.INITIAL_CAPITAL;
    let maxDrawdown = 0;
    for (const point of equityCurve) {
      if (point.value > peak) peak = point.value;
      const drawdown = (peak - point.value) / peak;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    // Trade analysis
    const winningTrades = trades.filter(t => t.profitLoss > 0);
    const losingTrades = trades.filter(t => t.profitLoss < 0);
    const winRatio = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;
    
    const grossProfits = winningTrades.reduce((sum, t) => sum + t.profitLoss, 0);
    const grossLosses = Math.abs(losingTrades.reduce((sum, t) => sum + t.profitLoss, 0));
    const profitFactor = grossLosses > 0 ? grossProfits / grossLosses : (grossProfits > 0 ? Infinity : 0);
    
    const avgTradeDuration = trades.length > 0 
      ? trades.reduce((sum, t) => sum + t.duration, 0) / trades.length 
      : 0;

    // Calculate benchmark return (buy and hold strategy)
    const filteredPriceData = priceData.filter(p => 
      p.timestamp >= config.startTime && p.timestamp <= config.endTime
    );
    
    const initialPrice = filteredPriceData[0]?.price || 1;
    const finalPrice = filteredPriceData[filteredPriceData.length - 1]?.price || initialPrice;
    const benchmarkTotalReturn = ((finalPrice - initialPrice) / initialPrice) * 100;
    const benchmarkAnnualizedReturn = Math.pow(finalPrice / initialPrice, 1 / periodYears) - 1;
    
    // Calculate alpha (excess return over benchmark) - both in percentage terms
    const alpha = (annualizedReturn * 100) - (benchmarkAnnualizedReturn * 100);

    return {
      totalReturn,
      annualizedReturn: annualizedReturn * 100,
      benchmarkReturn: benchmarkTotalReturn,
      sharpeRatio,
      sortinoRatio,
      alpha: alpha,
      maxDrawdown: maxDrawdown * 100,
      annualizedVolatility,
      winRatio,
      profitFactor,
      totalTrades: trades.length,
      avgTradeDuration
    };
  }

  /**
   * Save backtest results to database
   */
  private async saveBacktestResults(
    runId: string,
    config: BacktestConfig,
    trades: BacktestTrade[],
    metrics: PerformanceMetrics
  ): Promise<void> {
    try {
      // Save backtest run
      await this.prisma.backtestRuns.create({
        data: {
          id: runId,
          baseAsset: config.baseAsset,
          quoteAsset: config.quoteAsset,
          zScoreThreshold: config.zScoreThreshold,
          movingAverages: config.movingAverages,
          profitPercent: config.profitPercent,
          stopLossPercent: config.stopLossPercent,
          startTime: config.startTime,
          endTime: config.endTime,
          windowSize: config.windowSize
        }
      });

      // Save trades
      if (trades.length > 0) {
        await this.prisma.backtestOrders.createMany({
          data: trades.map(trade => ({
            runId,
            symbol: `${config.baseAsset}${config.quoteAsset}`,
            side: trade.side,
            quantity: trade.quantity,
            price: trade.entryPrice, // Entry price
            timestamp: trade.entryTime,
            reason: trade.reason,
            profitLoss: trade.profitLoss,
            profitLossPercent: trade.profitLossPercent
          }))
        });
      }

      // Save optimization result
      await this.prisma.optimizationResults.create({
        data: {
          runId,
          baseAsset: config.baseAsset,
          quoteAsset: config.quoteAsset,
          zScoreThreshold: config.zScoreThreshold,
          movingAverages: config.movingAverages,
          profitPercent: config.profitPercent,
          stopLossPercent: config.stopLossPercent,
          startTime: config.startTime,
          endTime: config.endTime,
          totalReturn: metrics.totalReturn,
          annualizedReturn: metrics.annualizedReturn,
          sharpeRatio: metrics.sharpeRatio,
          sortinoRatio: metrics.sortinoRatio,
          alpha: metrics.alpha,
          maxDrawdown: metrics.maxDrawdown,
          winRatio: metrics.winRatio,
          totalTrades: metrics.totalTrades,
          profitFactor: isFinite(metrics.profitFactor) ? metrics.profitFactor : 999999,
          avgTradeDuration: metrics.avgTradeDuration
        }
      });

      console.log(`   ✅ Saved backtest results to database (${trades.length} trades)`);

    } catch (error) {
      console.error('❌ Error saving backtest results:', error);
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

/**
 * Parse command line arguments
 */
function parseArguments(): BacktestConfig & { generateHtml: boolean } {
  const args = process.argv.slice(2);

  // Check for --no-html flag
  const noHtmlIndex = args.indexOf('--no-html');
  const generateHtml = noHtmlIndex === -1;
  
  // Remove the flag from args for processing
  if (noHtmlIndex !== -1) {
    args.splice(noHtmlIndex, 1);
  }

  if (args.length !== 8) {
    console.error('❌ Invalid arguments. Usage:');
    console.error('npm run runWindowedBacktest-adaptive "2022-01-01" 12 ETH USDT 3.0 200 5.0 2.5 [--no-html]');
    console.error('');
    console.error('Arguments:');
    console.error('  startTime: Start date (YYYY-MM-DD)');
    console.error('  windowSize: Window size in months');
    console.error('  baseAsset: Base asset (e.g., ETH)');  
    console.error('  quoteAsset: Quote asset (e.g., USDT)');
    console.error('  zScoreThreshold: Z-score threshold (e.g., 3.0)');
    console.error('  movingAverages: Moving average period (e.g., 200)');
    console.error('  profitPercent: Profit target % (e.g., 5.0)');
    console.error('  stopLossPercent: Stop loss % (e.g., 2.5)');
    console.error('  --no-html: Optional flag to skip HTML report generation');
    process.exit(1);
  }

  const [startTimeStr, windowSizeStr, baseAsset, quoteAsset, zScoreThresholdStr, movingAveragesStr, profitPercentStr, stopLossPercentStr] = args;

  const startTime = new Date(startTimeStr);
  const windowSize = parseInt(windowSizeStr);

  if (isNaN(startTime.getTime())) {
    console.error('❌ Invalid start date format. Use YYYY-MM-DD format');
    process.exit(1);
  }

  // Calculate end time based on window size
  const endTime = new Date(startTime);
  endTime.setMonth(endTime.getMonth() + windowSize);

  return {
    startTime,
    endTime,
    windowSize,
    baseAsset: baseAsset.toUpperCase(),
    quoteAsset: quoteAsset.toUpperCase(),
    zScoreThreshold: parseFloat(zScoreThresholdStr),
    movingAverages: parseInt(movingAveragesStr),
    profitPercent: parseFloat(profitPercentStr),
    stopLossPercent: parseFloat(stopLossPercentStr),
    generateHtml
  };
}

/**
 * Main execution function
 */
async function main() {
  const backtester = new AdaptiveWindowedBacktester();

  try {
    console.log('🎯 Starting Adaptive Windowed Backtest...');
    console.log('=' .repeat(70));

    await backtester.initialize();

    const config = parseArguments();
    const result = await backtester.runBacktest(config);

    console.log('\n🎉 Adaptive windowed backtest completed successfully!');
    console.log(`📊 Performance Summary:`);
    console.log(`  - Total Return: ${result.metrics.totalReturn.toFixed(2)}%`);
    console.log(`  - Annualized Return: ${result.metrics.annualizedReturn.toFixed(2)}%`);
    console.log(`  - Benchmark Return: ${result.metrics.benchmarkReturn.toFixed(2)}%`);
    console.log(`  - Alpha (Excess Return): ${result.metrics.alpha.toFixed(2)}%`);
    console.log(`  - Sharpe Ratio: ${result.metrics.sharpeRatio.toFixed(2)}`);
    console.log(`  - Max Drawdown: ${result.metrics.maxDrawdown.toFixed(2)}%`);
    console.log(`  - Win Ratio: ${result.metrics.winRatio.toFixed(1)}%`);
    console.log(`  - Total Trades: ${result.metrics.totalTrades}`);

  } catch (error) {
    console.error('\n❌ Adaptive windowed backtest failed:', error);
    process.exit(1);
  } finally {
    await backtester.cleanup();
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { AdaptiveWindowedBacktester, BacktestConfig, BacktestResult };