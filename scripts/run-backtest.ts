#!/usr/bin/env ts-node

/**
 * Comprehensive Backtesting Engine
 * 
 * This script validates the performance of Glicko-2 enhanced z-score signals
 * by simulating historical trading based on generated signals.
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { ZScoreSignalGenerator, type TradingSignal } from './generate-zscore-signals';

config();

interface BacktestConfig {
  initialCapital: number;
  maxPositions: number;
  profitTargetPercent: number;
  stopLossPercent: number;
  transactionFeePercent: number;
  minConfidence: number;
}

interface Position {
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  entryTime: Date;
  quantity: number;
  capitalUsed: number;
  signal: TradingSignal;
}

interface Trade {
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  entryTime: Date;
  exitTime: Date;
  quantity: number;
  profitLoss: number;
  profitLossPercent: number;
  reason: 'PROFIT_TARGET' | 'STOP_LOSS' | 'SIGNAL_EXIT' | 'END_OF_PERIOD';
  capitalUsed: number;
  fees: number;
}

interface BacktestResults {
  runId: string;
  config: BacktestConfig;
  startTime: Date;
  endTime: Date;
  initialCapital: number;
  finalCapital: number;
  totalReturn: number;
  totalReturnPercent: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  avgTradeReturn: number;
  avgTradeDuration: number; // in hours
  trades: Trade[];
  dailyReturns: number[];
}

class GlickoBacktestEngine {
  private prisma: PrismaClient;
  private signalGenerator: ZScoreSignalGenerator;

  constructor() {
    this.prisma = new PrismaClient();
    this.signalGenerator = new ZScoreSignalGenerator();
  }

  async initialize(): Promise<void> {
    try {
      await this.prisma.$connect();
      await this.signalGenerator.initialize();
      console.log('✅ Backtest engine initialized');
    } catch (error) {
      console.error('❌ Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Get price data for exit conditions
   */
  private async getPriceData(
    symbol: string,
    startTime: Date,
    endTime: Date
  ): Promise<Array<{ timestamp: Date; price: number; volume: number }>> {
    const klines = await this.prisma.klines.findMany({
      where: {
        symbol,
        openTime: {
          gte: startTime,
          lte: endTime
        }
      },
      orderBy: { openTime: 'asc' },
      select: {
        openTime: true,
        close: true,
        volume: true
      }
    });

    return klines.map(k => ({
      timestamp: k.openTime,
      price: Number(k.close),
      volume: Number(k.volume)
    }));
  }

  /**
   * Calculate exit price based on position and market conditions
   */
  private calculateExitConditions(
    position: Position,
    currentPrice: number,
    currentTime: Date,
    config: BacktestConfig
  ): { shouldExit: boolean; reason: Trade['reason']; exitPrice: number } | null {
    const priceChange = (currentPrice - position.entryPrice) / position.entryPrice;
    const timeHeld = (currentTime.getTime() - position.entryTime.getTime()) / (1000 * 60 * 60); // hours

    // For BUY positions
    if (position.side === 'BUY') {
      // Profit target
      if (priceChange >= config.profitTargetPercent / 100) {
        return {
          shouldExit: true,
          reason: 'PROFIT_TARGET',
          exitPrice: currentPrice
        };
      }
      // Stop loss
      if (priceChange <= -config.stopLossPercent / 100) {
        return {
          shouldExit: true,
          reason: 'STOP_LOSS',
          exitPrice: currentPrice
        };
      }
    }

    // For SELL positions (short)
    if (position.side === 'SELL') {
      // Profit target (price went down)
      if (priceChange <= -config.profitTargetPercent / 100) {
        return {
          shouldExit: true,
          reason: 'PROFIT_TARGET',
          exitPrice: currentPrice
        };
      }
      // Stop loss (price went up)
      if (priceChange >= config.stopLossPercent / 100) {
        return {
          shouldExit: true,
          reason: 'STOP_LOSS',
          exitPrice: currentPrice
        };
      }
    }

    return null;
  }

  /**
   * Execute a single backtest run
   */
  async runBacktest(
    startDate: Date,
    endDate: Date,
    config: BacktestConfig,
    symbols?: string[]
  ): Promise<BacktestResults> {
    console.log(`🚀 Running backtest from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);

    // Generate signals for the period
    const { signals } = await this.signalGenerator.generateAllSignals(startDate, endDate, symbols);
    
    // Filter signals by minimum confidence
    const qualifiedSignals = signals.filter(s => s.confidence >= config.minConfidence);
    console.log(`📊 Using ${qualifiedSignals.length} qualified signals (min confidence: ${config.minConfidence})`);

    // Sort signals by timestamp
    const sortedSignals = qualifiedSignals.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // Initialize backtest state
    let capital = config.initialCapital;
    let maxCapital = config.initialCapital;
    let maxDrawdown = 0;
    const activePositions = new Map<string, Position>();
    const completedTrades: Trade[] = [];
    const dailyReturns: number[] = [];

    // Track daily capital for returns calculation
    const dailyCapitalMap = new Map<string, number>();
    dailyCapitalMap.set(startDate.toISOString().split('T')[0], capital);

    console.log(`💰 Initial capital: $${config.initialCapital.toLocaleString()}`);

    // Process each signal
    for (let i = 0; i < sortedSignals.length; i++) {
      const signal = sortedSignals[i];
      const { symbol, timestamp, signal: side, confidence, priceAtSignal } = signal;

      // Check for exit conditions on existing positions first
      for (const [posSymbol, position] of activePositions.entries()) {
        const priceData = await this.getPriceData(posSymbol, position.entryTime, timestamp);
        
        for (const pricePoint of priceData) {
          if (pricePoint.timestamp <= timestamp) {
            const exitCondition = this.calculateExitConditions(
              position,
              pricePoint.price,
              pricePoint.timestamp,
              config
            );

            if (exitCondition?.shouldExit) {
              // Close position
              const trade = this.closePosition(
                position,
                pricePoint.price,
                pricePoint.timestamp,
                exitCondition.reason,
                config
              );
              
              completedTrades.push(trade);
              capital += trade.profitLoss - trade.fees;
              activePositions.delete(posSymbol);

              // Update max capital and drawdown
              if (capital > maxCapital) {
                maxCapital = capital;
              }
              const drawdown = (maxCapital - capital) / maxCapital;
              if (drawdown > maxDrawdown) {
                maxDrawdown = drawdown;
              }
              break;
            }
          }
        }
      }

      // Consider opening new position if we have available capital and positions
      if (activePositions.size < config.maxPositions && !activePositions.has(symbol) && (side === 'BUY' || side === 'SELL')) {
        const availableCapital = capital * 0.9; // Keep 10% cash buffer
        const positionSize = availableCapital / Math.max(config.maxPositions, 1);
        
        if (positionSize >= 100) { // Minimum position size
          const quantity = positionSize / priceAtSignal;
          const fees = positionSize * (config.transactionFeePercent / 100);
          
          const position: Position = {
            symbol,
            side: side as 'BUY' | 'SELL',
            entryPrice: priceAtSignal,
            entryTime: timestamp,
            quantity,
            capitalUsed: positionSize,
            signal
          };

          activePositions.set(symbol, position);
          capital -= fees; // Deduct entry fees
          
          console.log(`📈 ${side} ${symbol} at $${priceAtSignal.toFixed(6)} (confidence: ${(confidence * 100).toFixed(1)}%)`);
        }
      }

      // Update daily capital tracking
      const dateKey = timestamp.toISOString().split('T')[0];
      dailyCapitalMap.set(dateKey, capital);
    }

    // Close all remaining positions at the end of the period
    for (const [symbol, position] of activePositions.entries()) {
      const priceData = await this.getPriceData(symbol, position.entryTime, endDate);
      const finalPrice = priceData[priceData.length - 1]?.price || position.entryPrice;
      
      const trade = this.closePosition(
        position,
        finalPrice,
        endDate,
        'END_OF_PERIOD',
        config
      );
      
      completedTrades.push(trade);
      capital += trade.profitLoss - trade.fees;
    }

    // Calculate daily returns
    const dailyCapitalValues = Array.from(dailyCapitalMap.values());
    for (let i = 1; i < dailyCapitalValues.length; i++) {
      const dailyReturn = (dailyCapitalValues[i] - dailyCapitalValues[i - 1]) / dailyCapitalValues[i - 1];
      dailyReturns.push(dailyReturn);
    }

    // Calculate performance metrics
    const totalReturn = capital - config.initialCapital;
    const totalReturnPercent = (totalReturn / config.initialCapital) * 100;
    const winningTrades = completedTrades.filter(t => t.profitLoss > 0).length;
    const losingTrades = completedTrades.filter(t => t.profitLoss <= 0).length;
    const winRate = completedTrades.length > 0 ? winningTrades / completedTrades.length : 0;
    
    // Calculate Sharpe ratio (assuming risk-free rate of 0)
    const avgDailyReturn = dailyReturns.length > 0 
      ? dailyReturns.reduce((sum, ret) => sum + ret, 0) / dailyReturns.length 
      : 0;
    const dailyReturnStd = dailyReturns.length > 0
      ? Math.sqrt(dailyReturns.reduce((sum, ret) => sum + Math.pow(ret - avgDailyReturn, 2), 0) / dailyReturns.length)
      : 0;
    const sharpeRatio = dailyReturnStd > 0 ? (avgDailyReturn / dailyReturnStd) * Math.sqrt(252) : 0; // Annualized

    // Calculate profit factor
    const grossProfit = completedTrades.filter(t => t.profitLoss > 0).reduce((sum, t) => sum + t.profitLoss, 0);
    const grossLoss = Math.abs(completedTrades.filter(t => t.profitLoss <= 0).reduce((sum, t) => sum + t.profitLoss, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;

    // Calculate average trade duration
    const avgTradeDuration = completedTrades.length > 0
      ? completedTrades.reduce((sum, t) => {
          return sum + (t.exitTime.getTime() - t.entryTime.getTime()) / (1000 * 60 * 60);
        }, 0) / completedTrades.length
      : 0;

    const results: BacktestResults = {
      runId: `backtest_${Date.now()}`,
      config,
      startTime: startDate,
      endTime: endDate,
      initialCapital: config.initialCapital,
      finalCapital: capital,
      totalReturn,
      totalReturnPercent,
      maxDrawdown,
      maxDrawdownPercent: maxDrawdown * 100,
      sharpeRatio,
      totalTrades: completedTrades.length,
      winningTrades,
      losingTrades,
      winRate,
      profitFactor,
      avgTradeReturn: completedTrades.length > 0 
        ? completedTrades.reduce((sum, t) => sum + t.profitLoss, 0) / completedTrades.length 
        : 0,
      avgTradeDuration,
      trades: completedTrades,
      dailyReturns
    };

    return results;
  }

  /**
   * Close a position and calculate trade results
   */
  private closePosition(
    position: Position,
    exitPrice: number,
    exitTime: Date,
    reason: Trade['reason'],
    config: BacktestConfig
  ): Trade {
    let profitLoss: number;
    
    if (position.side === 'BUY') {
      profitLoss = (exitPrice - position.entryPrice) * position.quantity;
    } else { // SELL (short)
      profitLoss = (position.entryPrice - exitPrice) * position.quantity;
    }

    const profitLossPercent = (profitLoss / position.capitalUsed) * 100;
    const fees = position.capitalUsed * (config.transactionFeePercent / 100) * 2; // Entry + exit fees

    return {
      symbol: position.symbol,
      side: position.side,
      entryPrice: position.entryPrice,
      exitPrice,
      entryTime: position.entryTime,
      exitTime,
      quantity: position.quantity,
      profitLoss: profitLoss - fees, // Net after fees
      profitLossPercent,
      reason,
      capitalUsed: position.capitalUsed,
      fees
    };
  }

  /**
   * Save backtest results to database
   */
  async saveBacktestResults(results: BacktestResults): Promise<void> {
    console.log('💾 Saving backtest results to database...');

    try {
      // Create backtest run record
      const backtestRun = await this.prisma.backtestRuns.create({
        data: {
          id: results.runId,
          baseAsset: 'MULTI', // Multiple assets
          quoteAsset: 'USDT',
          zScoreThreshold: 2.0, // From signal generation
          movingAverages: 20,
          profitPercent: results.config.profitTargetPercent,
          stopLossPercent: results.config.stopLossPercent,
          startTime: results.startTime,
          endTime: results.endTime,
          windowSize: 20
        }
      });

      // Save individual trades - map exit reasons to valid enum values
      const tradeData = results.trades.map(trade => {
        let reason: 'ENTRY' | 'EXIT_ZSCORE' | 'EXIT_PROFIT' | 'EXIT_STOP';
        switch (trade.reason) {
          case 'PROFIT_TARGET':
            reason = 'EXIT_PROFIT';
            break;
          case 'STOP_LOSS':
            reason = 'EXIT_STOP';
            break;
          case 'SIGNAL_EXIT':
            reason = 'EXIT_ZSCORE';
            break;
          case 'END_OF_PERIOD':
          default:
            reason = 'EXIT_ZSCORE'; // Default mapping
            break;
        }
        
        return {
          runId: results.runId,
          symbol: trade.symbol,
          side: trade.side as 'BUY' | 'SELL',
          quantity: trade.quantity,
          price: trade.entryPrice,
          timestamp: trade.entryTime,
          reason: reason,
          profitLoss: trade.profitLoss,
          profitLossPercent: trade.profitLossPercent
        };
      });

      if (tradeData.length > 0) {
        await this.prisma.backtestOrders.createMany({
          data: tradeData
        });
      }

      // Save optimization results
      await this.prisma.optimizationResults.create({
        data: {
          runId: results.runId,
          baseAsset: 'MULTI',
          quoteAsset: 'USDT',
          zScoreThreshold: 2.0,
          movingAverages: 20,
          profitPercent: results.config.profitTargetPercent,
          stopLossPercent: results.config.stopLossPercent,
          startTime: results.startTime,
          endTime: results.endTime,
          totalReturn: results.totalReturnPercent,
          annualizedReturn: results.totalReturnPercent * (365 / ((results.endTime.getTime() - results.startTime.getTime()) / (1000 * 60 * 60 * 24))),
          sharpeRatio: results.sharpeRatio,
          sortinoRatio: results.sharpeRatio, // Simplified for now
          alpha: results.totalReturnPercent - 5, // Assuming 5% benchmark
          maxDrawdown: results.maxDrawdownPercent,
          winRatio: results.winRate * 100,
          totalTrades: results.totalTrades,
          profitFactor: results.profitFactor,
          avgTradeDuration: results.avgTradeDuration
        }
      });

      console.log(`✅ Backtest results saved with ID: ${results.runId}`);

    } catch (error) {
      console.error('❌ Error saving backtest results:', error);
    }
  }

  /**
   * Display backtest results
   */
  displayResults(results: BacktestResults): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 BACKTEST RESULTS');
    console.log('='.repeat(60));
    
    console.log(`💰 Financial Performance:`);
    console.log(`  Initial Capital: $${results.initialCapital.toLocaleString()}`);
    console.log(`  Final Capital: $${results.finalCapital.toLocaleString()}`);
    console.log(`  Total Return: $${results.totalReturn.toLocaleString()} (${results.totalReturnPercent.toFixed(2)}%)`);
    console.log(`  Max Drawdown: ${results.maxDrawdownPercent.toFixed(2)}%`);
    console.log(`  Sharpe Ratio: ${results.sharpeRatio.toFixed(3)}`);
    
    console.log(`\n📈 Trading Statistics:`);
    console.log(`  Total Trades: ${results.totalTrades}`);
    console.log(`  Winning Trades: ${results.winningTrades} (${(results.winRate * 100).toFixed(1)}%)`);
    console.log(`  Losing Trades: ${results.losingTrades} (${((1 - results.winRate) * 100).toFixed(1)}%)`);
    console.log(`  Profit Factor: ${results.profitFactor.toFixed(2)}`);
    console.log(`  Avg Trade Return: $${results.avgTradeReturn.toFixed(2)}`);
    console.log(`  Avg Trade Duration: ${results.avgTradeDuration.toFixed(1)} hours`);

    // Show top performing trades
    const topTrades = results.trades
      .sort((a, b) => b.profitLoss - a.profitLoss)
      .slice(0, 5);
    
    console.log(`\n🏆 Top 5 Trades:`);
    topTrades.forEach((trade, i) => {
      console.log(`  ${i + 1}. ${trade.symbol} ${trade.side}: $${trade.profitLoss.toFixed(2)} (${trade.profitLossPercent.toFixed(1)}%) - ${trade.reason}`);
    });
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
    await this.signalGenerator.cleanup();
    console.log('🧹 Cleanup completed');
  }
}

// Main execution function
async function main() {
  const backtester = new GlickoBacktestEngine();

  try {
    console.log('🎯 Starting comprehensive backtest...');
    console.log('=' .repeat(60));

    await backtester.initialize();

    // Define backtest configuration
    const config: BacktestConfig = {
      initialCapital: 10000, // $10,000 starting capital
      maxPositions: 5, // Maximum simultaneous positions
      profitTargetPercent: 5, // 5% profit target
      stopLossPercent: 2.5, // 2.5% stop loss
      transactionFeePercent: 0.1, // 0.1% transaction fees
      minConfidence: 0.7 // Minimum 70% confidence for signals
    };

    // Run backtest for the last 30 days
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - (30 * 24 * 60 * 60 * 1000));

    console.log(`📅 Backtesting period: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
    console.log(`⚙️ Configuration:`);
    console.log(`  - Initial Capital: $${config.initialCapital.toLocaleString()}`);
    console.log(`  - Max Positions: ${config.maxPositions}`);
    console.log(`  - Profit Target: ${config.profitTargetPercent}%`);
    console.log(`  - Stop Loss: ${config.stopLossPercent}%`);
    console.log(`  - Min Confidence: ${config.minConfidence * 100}%`);

    const results = await backtester.runBacktest(startDate, endDate, config);

    // Display and save results
    backtester.displayResults(results);
    await backtester.saveBacktestResults(results);

    console.log('\n🎉 Backtest completed successfully!');
    console.log('Results have been saved to the database for analysis.');

  } catch (error) {
    console.error('\n💥 Backtest failed:', error);
    process.exit(1);
  } finally {
    await backtester.cleanup();
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { GlickoBacktestEngine, type BacktestResults };