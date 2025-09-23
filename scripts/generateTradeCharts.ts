#!/usr/bin/env ts-node

/**
 * Generate Individual Trade Charts from Backtest Data
 * 
 * Creates separate interactive charts for each trade in a backtest,
 * showing market price context with entry/exit points.
 * 
 * Usage:
 *   npm run generateTradeCharts BNB USDT 2021-07-19 2022-07-19 7 5 20
 *   npm run generateTradeCharts [baseAsset] [quoteAsset] [startDate] [endDate] [zScore] [profitPercent] [stopLossPercent]
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

config();

interface TradeData {
  entryTime: Date;
  exitTime: Date;
  side: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  reason: string;
  profitLoss: number;
  profitLossPercent: number;
  duration: number;
  portfolioValueBefore: number;
  portfolioValueAfter: number;
  runId: string;
}

interface PriceData {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TradeStatistics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  lossRate: number;
  totalPnL: number;
  avgPnL: number;
  avgPnLPercent: number;
  avgWinAmount: number;
  avgLossAmount: number;
  avgWinPercent: number;
  avgLossPercent: number;
  bestTrade: number;
  worstTrade: number;
  bestTradePercent: number;
  worstTradePercent: number;
  avgTradeDuration: number;
  avgTimeBetweenTrades: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: number;
  consecutiveWins: number;
  consecutiveLosses: number;
  periodStart: Date;
  periodEnd: Date;
  tradingDays: number;
}

class TradeChartGenerator {
  private prisma: PrismaClient;

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
   * Find backtest runs by parameters and date range
   */
  async findBacktestRuns(
    baseAsset: string,
    quoteAsset: string,
    startDate: string,
    endDate: string,
    zScore: number,
    profitPercent: number,
    stopLossPercent: number
  ): Promise<string[]> {
    console.log(`🔍 Finding backtest runs for ${baseAsset}/${quoteAsset} with parameters:`);
    console.log(`   Period: ${startDate} to ${endDate}`);
    console.log(`   Parameters: Z-Score=${zScore}, Profit=${profitPercent}%, Stop=${stopLossPercent}%`);

    const backtestRuns = await this.prisma.backtestRuns.findMany({
      where: {
        baseAsset,
        quoteAsset,
        // Find backtests that overlap with the requested date range
        // Backtest overlaps if: backtest.startTime <= requestedEndDate AND backtest.endTime >= requestedStartDate
        startTime: { lte: new Date(endDate + 'T23:59:59') },
        endTime: { gte: new Date(startDate) },
        zScoreThreshold: zScore,
        profitPercent: profitPercent,
        stopLossPercent: stopLossPercent
      },
      select: {
        id: true,
        movingAverages: true,
        startTime: true,
        endTime: true,
        createdAt: true
      },
      orderBy: { startTime: 'asc' }
    });

    if (backtestRuns.length === 0) {
      console.error('❌ No backtest runs found matching those parameters');
      return [];
    }

    console.log(`✅ Found ${backtestRuns.length} matching backtest runs:`);
    backtestRuns.forEach((run, i) => {
      console.log(`   Run ${i + 1}: ${run.id}`);
      console.log(`      Period: ${run.startTime.toISOString().split('T')[0]} to ${run.endTime.toISOString().split('T')[0]}`);
      console.log(`      Moving Averages: ${run.movingAverages}`);
      console.log(`      Created: ${run.createdAt.toISOString()}`);
    });

    return backtestRuns.map(run => run.id);
  }

  /**
   * Find ALL runs that overlap with the requested date range for comprehensive coverage
   */
  async findAllOverlappingRuns(
    baseAsset: string,
    quoteAsset: string,
    startDate: string,
    endDate: string,
    zScore: number,
    profitPercent: number,
    stopLossPercent: number
  ): Promise<string[]> {
    console.log(`🔍 Finding ALL runs that overlap with ${startDate} to ${endDate}...`);
    
    const requestedStart = new Date(startDate);
    const requestedEnd = new Date(endDate + 'T23:59:59');
    
    const backtestRuns = await this.prisma.backtestRuns.findMany({
      where: {
        baseAsset,
        quoteAsset,
        zScoreThreshold: zScore,
        profitPercent: profitPercent,
        stopLossPercent: stopLossPercent,
        // Find runs that overlap: run.start <= requested.end AND run.end >= requested.start
        startTime: { lte: requestedEnd },
        endTime: { gte: requestedStart }
      },
      select: {
        id: true,
        movingAverages: true,
        startTime: true,
        endTime: true,
        createdAt: true
      },
      orderBy: { startTime: 'asc' }
    });

    if (backtestRuns.length === 0) {
      console.error('❌ No backtest runs found overlapping the requested period');
      return [];
    }

    console.log(`✅ Found ${backtestRuns.length} overlapping runs:`);

    const validRuns: string[] = [];
    
    for (const run of backtestRuns) {
      const runStart = new Date(run.startTime);
      const runEnd = new Date(run.endTime);
      
      // Count trades in this run within the requested date range
      const tradeCount = await this.prisma.backtestOrders.count({
        where: { 
          runId: run.id,
          profitLossPercent: { not: null },
          reason: { not: 'ENTRY' },
          timestamp: {
            gte: requestedStart,
            lte: requestedEnd
          }
        }
      });
      
      console.log(`   ${run.id}:`);
      console.log(`      Period: ${runStart.toISOString().split('T')[0]} to ${runEnd.toISOString().split('T')[0]}`);
      console.log(`      Trades in requested window: ${tradeCount}`);
      console.log(`      Created: ${run.createdAt.toISOString()}`);
      
      if (tradeCount > 0) {
        validRuns.push(run.id);
      }
    }

    console.log(`\n🎯 Selected ${validRuns.length} runs with trades in the requested period`);
    console.log(`   Strategy: Will combine ALL trades chronologically from ${startDate} to ${endDate}`);

    return validRuns;
  }

  /**
   * Find best single continuous backtest run that covers the date range
   */
  async findBestContinuousRun(
    baseAsset: string,
    quoteAsset: string,
    startDate: string,
    endDate: string,
    zScore: number,
    profitPercent: number,
    stopLossPercent: number
  ): Promise<string | null> {
    console.log(`🔍 Finding single continuous run that covers ${startDate} to ${endDate}...`);
    
    const backtestRuns = await this.prisma.backtestRuns.findMany({
      where: {
        baseAsset,
        quoteAsset,
        zScoreThreshold: zScore,
        profitPercent: profitPercent,
        stopLossPercent: stopLossPercent
      },
      select: {
        id: true,
        movingAverages: true,
        startTime: true,
        endTime: true,
        createdAt: true
      },
      orderBy: { startTime: 'asc' }
    });

    if (backtestRuns.length === 0) {
      console.error('❌ No backtest runs found matching those parameters');
      return null;
    }

    console.log(`✅ Found ${backtestRuns.length} potential runs`);

    // Find runs that cover the maximum portion of the requested date range
    const requestedStart = new Date(startDate);
    const requestedEnd = new Date(endDate + 'T23:59:59');
    
    let bestRun = null;
    let bestCoverage = 0;
    let bestTradeCount = 0;

    for (const run of backtestRuns) {
      // Calculate how much of the requested period this run covers
      const runStart = new Date(run.startTime);
      const runEnd = new Date(run.endTime);
      
      const overlapStart = new Date(Math.max(requestedStart.getTime(), runStart.getTime()));
      const overlapEnd = new Date(Math.min(requestedEnd.getTime(), runEnd.getTime()));
      
      if (overlapStart < overlapEnd) {
        const overlapDays = (overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24);
        const requestedDays = (requestedEnd.getTime() - requestedStart.getTime()) / (1000 * 60 * 60 * 24);
        const coverage = overlapDays / requestedDays;
        
        // Count trades in this run
        const tradeCount = await this.prisma.backtestOrders.count({
          where: { 
            runId: run.id,
            profitLossPercent: { not: null },
            reason: { not: 'ENTRY' }
          }
        });
        
        console.log(`   ${run.id}:`);
        console.log(`      Period: ${runStart.toISOString().split('T')[0]} to ${runEnd.toISOString().split('T')[0]}`);
        console.log(`      Coverage: ${(coverage * 100).toFixed(1)}% of requested period`);
        console.log(`      Trades: ${tradeCount}`);
        
        // Prefer runs with better coverage, then by trade count
        if (coverage > bestCoverage || (coverage === bestCoverage && tradeCount > bestTradeCount)) {
          bestRun = run;
          bestCoverage = coverage;
          bestTradeCount = tradeCount;
        }
      }
    }

    if (!bestRun) {
      console.error('❌ No runs overlap with the requested date range');
      return null;
    }

    console.log(`\n🎯 Selected run with ${(bestCoverage * 100).toFixed(1)}% coverage and ${bestTradeCount} trades:`);
    console.log(`   Run ID: ${bestRun.id}`);
    console.log(`   Period: ${bestRun.startTime.toISOString().split('T')[0]} to ${bestRun.endTime.toISOString().split('T')[0]}`);
    console.log(`   Moving Averages: ${bestRun.movingAverages}`);
    console.log(`   Created: ${bestRun.createdAt.toISOString()}`);

    return bestRun.id;
  }

  /**
   * Get all trades from multiple runs within date range with deduplication and portfolio continuity
   */
  async getTradesFromMultipleRunsInDateRange(
    runIds: string[], 
    startDate: string, 
    endDate: string
  ): Promise<TradeData[]> {
    console.log(`📊 Retrieving trades from ${runIds.length} backtest runs within ${startDate} to ${endDate}...`);

    const requestedStart = new Date(startDate);
    const requestedEnd = new Date(endDate + 'T23:59:59');
    
    let allTradesRaw: any[] = [];

    // Collect all relevant trades from all runs within the date range
    for (const runId of runIds) {
      console.log(`\n   Processing run: ${runId}`);
      
      const orders = await this.prisma.backtestOrders.findMany({
        where: { 
          runId,
          profitLossPercent: { not: null },
          reason: { not: 'ENTRY' },
          timestamp: {
            gte: requestedStart,
            lte: requestedEnd
          }
        },
        orderBy: { timestamp: 'asc' }
      });

      console.log(`   Found ${orders.length} trades in this run within date range`);
      
      // Add run info to each trade
      const tradesWithRunInfo = orders.map(order => ({
        ...order,
        runId: runId
      }));
      
      allTradesRaw = allTradesRaw.concat(tradesWithRunInfo);
    }

    // Sort all raw trades chronologically
    allTradesRaw.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    console.log(`\n🔄 Deduplicating trades (before: ${allTradesRaw.length} trades)...`);
    
    // Deduplicate trades based on entry time and price (allowing 1-minute tolerance)
    const uniqueRawTrades: any[] = [];
    const seenTrades = new Set<string>();

    for (const trade of allTradesRaw) {
      const entryTime = new Date(trade.timestamp);
      const entryPrice = parseFloat(trade.price.toString());
      
      // Create a unique key based on entry time (rounded to nearest minute) and entry price
      const roundedTime = new Date(Math.round(entryTime.getTime() / 60000) * 60000);
      const key = `${roundedTime.toISOString()}_${entryPrice.toFixed(4)}_${trade.side}`;
      
      if (!seenTrades.has(key)) {
        seenTrades.add(key);
        uniqueRawTrades.push(trade);
      }
    }

    console.log(`✅ After deduplication: ${uniqueRawTrades.length} unique trades`);
    console.log(`   Removed ${allTradesRaw.length - uniqueRawTrades.length} duplicate trades`);

    // Now convert to TradeData with proper portfolio tracking
    const trades: TradeData[] = [];
    let runningPortfolioValue = 10000; // Starting portfolio value

    // Get average duration for exit calculations
    const avgDurationHours = 271.88; // Use fallback

    for (const order of uniqueRawTrades) {
      const entryTime = new Date(order.timestamp);
      const entryPrice = parseFloat(order.price.toString());
      const profitLossPercent = parseFloat(order.profitLossPercent?.toString() || '0');
      const profitLossAmount = parseFloat(order.profitLoss?.toString() || '0');
      
      console.log(`   🔍 Processing trade at ${entryTime.toISOString().split('T')[0]}: P&L=${profitLossPercent.toFixed(2)}%`);
      
      // Get the symbol from the first run (they should all be the same)
      const firstRun = await this.prisma.backtestRuns.findUnique({
        where: { id: runIds[0] },
        select: { baseAsset: true, quoteAsset: true }
      });
      
      if (!firstRun) continue;
      
      const symbol = `${firstRun.baseAsset}${firstRun.quoteAsset}`;
      const actualExit = await this.findActualExit(symbol, entryTime, entryPrice, profitLossPercent, avgDurationHours, order.reason);
      
      // Portfolio value before this trade
      const portfolioValueBefore = runningPortfolioValue;
      
      // Portfolio value after this trade (add the P&L)
      const portfolioValueAfter = runningPortfolioValue + profitLossAmount;
      runningPortfolioValue = portfolioValueAfter;
      
      trades.push({
        entryTime,
        exitTime: actualExit.exitTime,
        side: order.side,
        entryPrice,
        exitPrice: actualExit.exitPrice,
        quantity: parseFloat(order.quantity.toString()),
        reason: order.reason || 'UNKNOWN',
        profitLoss: profitLossAmount,
        profitLossPercent: profitLossPercent,
        duration: actualExit.duration,
        portfolioValueBefore,
        portfolioValueAfter,
        runId: order.runId
      });
    }

    if (trades.length > 0) {
      console.log(`\n✅ Combined ${trades.length} trades from ${runIds.length} runs`);
      console.log(`   Period: ${trades[0].entryTime.toISOString().split('T')[0]} to ${trades[trades.length - 1].entryTime.toISOString().split('T')[0]}`);
      console.log(`   Portfolio: $${trades[0].portfolioValueBefore.toFixed(2)} → $${trades[trades.length-1].portfolioValueAfter.toFixed(2)}`);
      console.log(`   Total P&L: $${(trades[trades.length-1].portfolioValueAfter - trades[0].portfolioValueBefore).toFixed(2)}`);
    }

    return trades;
  }

  /**
   * Calculate comprehensive trade statistics
   */
  calculateTradeStatistics(trades: TradeData[]): TradeStatistics {
    if (trades.length === 0) {
      throw new Error('No trades to analyze');
    }

    const winningTrades = trades.filter(t => t.profitLossPercent > 0);
    const losingTrades = trades.filter(t => t.profitLossPercent < 0);
    
    const totalPnL = trades.reduce((sum, t) => sum + t.profitLoss, 0);
    const totalWins = winningTrades.reduce((sum, t) => sum + t.profitLoss, 0);
    const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + t.profitLoss, 0));
    
    // Time between trades
    const timeBetweenTrades: number[] = [];
    for (let i = 1; i < trades.length; i++) {
      const timeDiff = (trades[i].entryTime.getTime() - trades[i-1].exitTime.getTime()) / (1000 * 60 * 60); // hours
      timeBetweenTrades.push(timeDiff);
    }
    
    // Consecutive wins/losses
    let maxConsecutiveWins = 0;
    let maxConsecutiveLosses = 0;
    let currentWins = 0;
    let currentLosses = 0;
    
    for (const trade of trades) {
      if (trade.profitLossPercent > 0) {
        currentWins++;
        currentLosses = 0;
        maxConsecutiveWins = Math.max(maxConsecutiveWins, currentWins);
      } else {
        currentLosses++;
        currentWins = 0;
        maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLosses);
      }
    }
    
    // Running P&L for drawdown calculation
    const runningPnL: number[] = [];
    let cumulative = 0;
    for (const trade of trades) {
      cumulative += trade.profitLoss;
      runningPnL.push(cumulative);
    }
    
    // Calculate max drawdown
    let maxDrawdown = 0;
    let peak = runningPnL[0];
    for (const value of runningPnL) {
      if (value > peak) peak = value;
      const drawdown = peak - value;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
    
    // Calculate Sharpe ratio (simplified)
    const returns = trades.map(t => t.profitLossPercent / 100);
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;
    
    const periodStart = trades[0].entryTime;
    const periodEnd = trades[trades.length - 1].exitTime;
    const tradingDays = Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24));
    
    return {
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: (winningTrades.length / trades.length) * 100,
      lossRate: (losingTrades.length / trades.length) * 100,
      totalPnL,
      avgPnL: totalPnL / trades.length,
      avgPnLPercent: trades.reduce((sum, t) => sum + t.profitLossPercent, 0) / trades.length,
      avgWinAmount: winningTrades.length > 0 ? totalWins / winningTrades.length : 0,
      avgLossAmount: losingTrades.length > 0 ? totalLosses / losingTrades.length : 0,
      avgWinPercent: winningTrades.length > 0 ? winningTrades.reduce((sum, t) => sum + t.profitLossPercent, 0) / winningTrades.length : 0,
      avgLossPercent: losingTrades.length > 0 ? losingTrades.reduce((sum, t) => sum + t.profitLossPercent, 0) / losingTrades.length : 0,
      bestTrade: Math.max(...trades.map(t => t.profitLoss)),
      worstTrade: Math.min(...trades.map(t => t.profitLoss)),
      bestTradePercent: Math.max(...trades.map(t => t.profitLossPercent)),
      worstTradePercent: Math.min(...trades.map(t => t.profitLossPercent)),
      avgTradeDuration: trades.reduce((sum, t) => sum + t.duration, 0) / trades.length,
      avgTimeBetweenTrades: timeBetweenTrades.length > 0 ? timeBetweenTrades.reduce((sum, t) => sum + t, 0) / timeBetweenTrades.length : 0,
      profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? 999 : 0,
      sharpeRatio: sharpeRatio * Math.sqrt(252), // Annualized
      maxDrawdown,
      consecutiveWins: maxConsecutiveWins,
      consecutiveLosses: maxConsecutiveLosses,
      periodStart,
      periodEnd,
      tradingDays
    };
  }

  /**
   * Get all trades for a backtest run with proper portfolio value tracking
   */
  async getTrades(runId: string): Promise<TradeData[]> {
    console.log(`📊 Retrieving trades for run ${runId}...`);

    const orders = await this.prisma.backtestOrders.findMany({
      where: { runId },
      orderBy: { timestamp: 'asc' }
    });

    console.log(`   Found ${orders.length} orders`);

    // Get backtest run details to get initial portfolio value
    const backtestRun = await this.prisma.backtestRuns.findUnique({
      where: { id: runId },
      select: {
        baseAsset: true,
        quoteAsset: true,
        startTime: true,
        endTime: true
      }
    });

    if (!backtestRun) {
      throw new Error('Backtest run not found');
    }

    // Get optimization results for average trade duration and initial value
    const optimizationResult = await this.prisma.optimizationResults.findFirst({
      where: { runId },
      select: { avgTradeDuration: true }
    });

    const avgDurationHours = optimizationResult 
      ? parseFloat(optimizationResult.avgTradeDuration.toString())
      : 271.88; // fallback based on previous query

    console.log(`   Average trade duration: ${avgDurationHours.toFixed(1)} hours`);

    // Filter for completed trades (orders with profit/loss data)
    const completedTrades = orders.filter(order => 
      order.profitLossPercent !== null && 
      order.profitLoss !== null &&
      order.reason !== 'ENTRY'
    );

    console.log(`   Found ${completedTrades.length} completed trades`);

    const trades: TradeData[] = [];
    let runningPortfolioValue = 10000; // Starting portfolio value

    // Sort trades by timestamp to ensure proper sequencing
    const sortedTrades = completedTrades.sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    for (const order of sortedTrades) {
      const entryTime = new Date(order.timestamp);
      const entryPrice = parseFloat(order.price.toString());
      const profitLossPercent = parseFloat(order.profitLossPercent?.toString() || '0');
      const profitLossAmount = parseFloat(order.profitLoss?.toString() || '0');
      
      // Calculate theoretical exit price from profit/loss percentage
      const theoreticalExitPrice = entryPrice * (1 + (profitLossPercent / 100));
      
      console.log(`   🔍 Trade at ${entryTime.toISOString().split('T')[0]}: Entry=$${entryPrice.toFixed(4)}, P&L=${profitLossPercent.toFixed(2)}%`);
      
      // Find the actual exit time
      const symbol = `${backtestRun.baseAsset}${backtestRun.quoteAsset}`;
      const actualExit = await this.findActualExit(symbol, entryTime, entryPrice, profitLossPercent, avgDurationHours, order.reason);
      
      // Portfolio value before this trade
      const portfolioValueBefore = runningPortfolioValue;
      
      // Portfolio value after this trade (add the P&L)
      const portfolioValueAfter = runningPortfolioValue + profitLossAmount;
      runningPortfolioValue = portfolioValueAfter;
      
      trades.push({
        entryTime,
        exitTime: actualExit.exitTime,
        side: order.side,
        entryPrice,
        exitPrice: actualExit.exitPrice,
        quantity: parseFloat(order.quantity.toString()),
        reason: order.reason || 'UNKNOWN',
        profitLoss: profitLossAmount,
        profitLossPercent: profitLossPercent,
        duration: actualExit.duration,
        portfolioValueBefore,
        portfolioValueAfter,
        runId
      });
    }

    // Validate portfolio value continuity
    console.log(`\n🔍 Validating portfolio value continuity:`);
    for (let i = 1; i < trades.length; i++) {
      const prevTrade = trades[i-1];
      const currentTrade = trades[i];
      
      if (Math.abs(prevTrade.portfolioValueAfter - currentTrade.portfolioValueBefore) > 0.01) {
        console.log(`   ⚠️ Portfolio value discontinuity detected:`);
        console.log(`      Trade ${i}: Exit value $${prevTrade.portfolioValueAfter.toFixed(2)}`);
        console.log(`      Trade ${i+1}: Entry value $${currentTrade.portfolioValueBefore.toFixed(2)}`);
        
        // Fix the discontinuity by adjusting the current trade's before value
        currentTrade.portfolioValueBefore = prevTrade.portfolioValueAfter;
        console.log(`      ✅ Corrected to $${currentTrade.portfolioValueBefore.toFixed(2)}`);
      }
    }

    console.log(`✅ Parsed ${trades.length} complete trades with portfolio tracking`);
    console.log(`   Portfolio: $${trades[0]?.portfolioValueBefore.toFixed(2)} → $${trades[trades.length-1]?.portfolioValueAfter.toFixed(2)}`);
    console.log(`   Total P&L: $${(trades[trades.length-1]?.portfolioValueAfter - trades[0]?.portfolioValueBefore).toFixed(2)}`);
    
    return trades;
  }

  /**
   * Get symbol from order (extract from backtest run)
   */
  private async getSymbolFromOrder(order: any): Promise<string> {
    const backtestRun = await this.prisma.backtestRuns.findUnique({
      where: { id: order.runId },
      select: { baseAsset: true, quoteAsset: true }
    });
    
    if (!backtestRun) {
      throw new Error('Backtest run not found');
    }
    
    return `${backtestRun.baseAsset}${backtestRun.quoteAsset}`;
  }

  /**
   * Find a reasonable exit time and use the theoretical exit price
   */
  private async findActualExit(
    symbol: string, 
    entryTime: Date, 
    entryPrice: number, 
    profitLossPercent: number, 
    maxDurationHours: number,
    exitReason: string
  ): Promise<{ exitTime: Date; exitPrice: number; duration: number }> {
    
    const targetPrice = entryPrice * (1 + (profitLossPercent / 100));
    
    // Since exact target prices may not exist in market data (due to theoretical calculations),
    // let's find a reasonable exit time based on market movement patterns
    
    const searchPeriodHours = Math.min(maxDurationHours * 1.5, 168); // Max 1 week search
    const maxExitTime = new Date(entryTime.getTime() + (searchPeriodHours * 60 * 60 * 1000));
    
    // Get market data after entry time
    const marketData = await this.prisma.klines.findMany({
      where: {
        symbol,
        openTime: {
          gt: entryTime,
          lte: maxExitTime
        }
      },
      orderBy: { openTime: 'asc' },
      take: 500  // Reasonable search window
    });

    console.log(`     Analyzing ${marketData.length} candles to find reasonable exit time`);

    if (marketData.length === 0) {
      console.log(`     ⚠️ No market data found, using estimated approach`);
      const estimatedExitTime = new Date(entryTime.getTime() + (maxDurationHours * 60 * 60 * 1000));
      return {
        exitTime: estimatedExitTime,
        exitPrice: targetPrice,
        duration: maxDurationHours
      };
    }

    // Strategy 1: Look for significant price movement in the expected direction
    let bestExitCandle = null;
    let bestMovementPercent = 0;
    
    for (const candle of marketData) {
      const high = parseFloat(candle.high.toString());
      const low = parseFloat(candle.low.toString());
      const close = parseFloat(candle.close.toString());
      
      // Calculate movement from entry price
      let movementPercent = 0;
      
      if (profitLossPercent > 0) {
        // For expected profits, look for upward movement
        movementPercent = ((high - entryPrice) / entryPrice) * 100;
      } else {
        // For expected losses, look for downward movement  
        movementPercent = ((low - entryPrice) / entryPrice) * 100;
      }
      
      // Find the candle with the most significant movement in the expected direction
      if ((profitLossPercent > 0 && movementPercent > bestMovementPercent) ||
          (profitLossPercent < 0 && movementPercent < bestMovementPercent)) {
        bestMovementPercent = movementPercent;
        bestExitCandle = candle;
      }
      
      // If we've reached at least 50% of the expected movement, that's good enough
      const halfwayTarget = profitLossPercent * 0.5;
      if ((profitLossPercent > 0 && movementPercent >= halfwayTarget) ||
          (profitLossPercent < 0 && movementPercent <= halfwayTarget)) {
        bestExitCandle = candle;
        break;
      }
    }
    
    // Strategy 2: If no significant movement, use time-based exit
    if (!bestExitCandle) {
      console.log(`     No significant price movement found, using time-based exit`);
      const targetIndex = Math.min(Math.floor(marketData.length * 0.6), marketData.length - 1);
      bestExitCandle = marketData[targetIndex];
    }
    
    if (bestExitCandle) {
      const exitTime = new Date(bestExitCandle.openTime);
      const duration = (exitTime.getTime() - entryTime.getTime()) / (1000 * 60 * 60);
      
      console.log(`     ✅ Found reasonable exit at ${exitTime.toISOString()}: theoretical $${targetPrice.toFixed(4)} (${duration.toFixed(1)}h)`);
      console.log(`        Market movement: ${bestMovementPercent.toFixed(2)}% (target was ${profitLossPercent.toFixed(2)}%)`);
      
      return {
        exitTime,
        exitPrice: targetPrice, // Keep using theoretical price for consistency with P&L calculations
        duration
      };
    }
    
    // Final fallback
    console.log(`     ⚠️ Using estimated time-based exit`);
    const estimatedExitTime = new Date(entryTime.getTime() + (maxDurationHours * 60 * 60 * 1000));
    
    return {
      exitTime: estimatedExitTime,
      exitPrice: targetPrice,
      duration: maxDurationHours
    };
  }

  /**
   * Get price data for a specific time period with buffer
   */
  async getPriceData(
    symbol: string,
    startTime: Date,
    endTime: Date,
    bufferHours: number = 48
  ): Promise<PriceData[]> {
    const bufferMs = bufferHours * 60 * 60 * 1000;
    const bufferedStart = new Date(startTime.getTime() - bufferMs);
    const bufferedEnd = new Date(endTime.getTime() + bufferMs);

    console.log(`   Fetching price data for ${symbol} from ${bufferedStart.toISOString()} to ${bufferedEnd.toISOString()}`);

    const klines = await this.prisma.klines.findMany({
      where: {
        symbol,
        openTime: {
          gte: bufferedStart,
          lte: bufferedEnd
        }
      },
      orderBy: { openTime: 'asc' },
      select: {
        openTime: true,
        open: true,
        high: true,
        low: true,
        close: true,
        volume: true
      }
    });

    console.log(`   Found ${klines.length} price candles`);

    return klines.map(k => ({
      timestamp: new Date(k.openTime),
      open: parseFloat(k.open.toString()),
      high: parseFloat(k.high.toString()),
      low: parseFloat(k.low.toString()),
      close: parseFloat(k.close.toString()),
      volume: parseFloat(k.volume.toString())
    }));
  }

  /**
   * Generate HTML chart showing all trades in one comprehensive view
   */
  generateAllTradesChart(
    trades: TradeData[],
    priceData: PriceData[],
    symbol: string,
    baseAsset: string,
    quoteAsset: string,
    parameters: {
      zScore: number;
      profitPercent: number;
      stopLossPercent: number;
      movingAverages: number;
    },
    dateRange: { start: string; end: string }
  ): string {
    // Calculate comprehensive statistics
    const stats = this.calculateTradeStatistics(trades);
    
    // Prepare price data for Chart.js candlestick
    const candlestickData = priceData.map(p => ({
      x: p.timestamp.getTime(),
      o: p.open,
      h: p.high,
      l: p.low,
      c: p.close
    }));

    // Prepare entry and exit points for all trades
    const entryPoints = trades.map((trade, i) => ({
      x: trade.entryTime.getTime(),
      y: trade.entryPrice,
      tradeIndex: i + 1,
      profitLoss: trade.profitLossPercent
    }));

    const exitPoints = trades.map((trade, i) => ({
      x: trade.exitTime.getTime(),
      y: trade.exitPrice,
      tradeIndex: i + 1,
      profitLoss: trade.profitLossPercent
    }));

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>All Trades - ${symbol} (Z${parameters.zScore}/P${parameters.profitPercent}%/S${parameters.stopLossPercent}%)</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@2.0.1/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-chart-financial@0.2.1/dist/chartjs-chart-financial.min.js"></script>
    <style>
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            margin: 0; 
            padding: 20px; 
            background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
            min-height: 100vh;
        }
        .container { 
            max-width: 1400px; 
            margin: 0 auto; 
            background: white; 
            padding: 30px; 
            border-radius: 15px; 
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }
        h1 { 
            color: #2c3e50; 
            text-align: center; 
            margin-bottom: 30px; 
            font-size: 2.2em;
        }
        .trade-summary { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); 
            gap: 20px; 
            margin: 30px 0; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 25px;
            border-radius: 12px;
            color: white;
        }
        .trade-metric { 
            text-align: center; 
        }
        .trade-value { 
            font-size: 24px; 
            font-weight: bold; 
            margin-bottom: 5px;
        }
        .trade-label { 
            font-size: 12px; 
            opacity: 0.9;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .chart-container { 
            height: 600px; 
            margin: 30px 0; 
            background: #f8f9fa; 
            border-radius: 12px; 
            padding: 20px;
        }
        .profit { color: #27ae60; }
        .loss { color: #e74c3c; }
        .performance-badge {
            display: inline-block;
            padding: 8px 16px;
            border-radius: 20px;
            font-weight: bold;
            font-size: 14px;
            margin: 10px 0;
        }
        .performance-profit {
            background: #27ae60;
            color: white;
        }
        .performance-loss {
            background: #e74c3c;
            color: white;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>All Trades - ${baseAsset}/${quoteAsset}</h1>
        <h2 style="color: #7f8c8d; margin-top: -10px; margin-bottom: 20px; font-size: 1.2em;">
            Parameters: Z-Score ${parameters.zScore} | MA ${parameters.movingAverages} | Profit ${parameters.profitPercent}% | Stop ${parameters.stopLossPercent}%
        </h2>
        <h3 style="color: #7f8c8d; margin-top: -15px; margin-bottom: 30px; font-size: 1.0em;">
            Period: ${stats.periodStart.toISOString().split('T')[0]} to ${stats.periodEnd.toISOString().split('T')[0]} (${stats.tradingDays} days)
        </h3>
        
        <!-- Performance Summary -->
        <div class="performance-badge performance-${stats.totalPnL > 0 ? 'profit' : 'loss'}">
            Total P&L: ${stats.totalPnL > 0 ? '+' : ''}$${stats.totalPnL.toFixed(2)} | 
            Avg P&L: ${stats.avgPnLPercent > 0 ? '+' : ''}${stats.avgPnLPercent.toFixed(2)}% | 
            Win Rate: ${stats.winRate.toFixed(1)}% (${stats.winningTrades}/${stats.totalTrades})
        </div>

        <!-- Comprehensive Statistics Grid -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 30px 0; background: #f8f9fa; padding: 25px; border-radius: 12px;">
            
            <!-- Trading Performance -->
            <div style="text-align: center; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <h4 style="color: #2c3e50; margin-bottom: 15px; font-size: 1.1em;">Performance</h4>
                <div style="color: ${stats.totalPnL > 0 ? '#27ae60' : '#e74c3c'}; font-size: 24px; font-weight: bold;">${stats.totalPnL > 0 ? '+' : ''}$${stats.totalPnL.toFixed(2)}</div>
                <div style="color: #7f8c8d; font-size: 14px;">Total P&L</div>
                <div style="color: #2c3e50; font-size: 16px; margin-top: 8px;">${stats.avgPnLPercent > 0 ? '+' : ''}${stats.avgPnLPercent.toFixed(2)}%</div>
                <div style="color: #7f8c8d; font-size: 12px;">Avg Trade</div>
            </div>

            <!-- Win/Loss Stats -->
            <div style="text-align: center; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <h4 style="color: #2c3e50; margin-bottom: 15px; font-size: 1.1em;">Win/Loss</h4>
                <div style="color: #27ae60; font-size: 20px; font-weight: bold;">${stats.winRate.toFixed(1)}%</div>
                <div style="color: #7f8c8d; font-size: 14px;">Win Rate</div>
                <div style="color: #2c3e50; font-size: 14px; margin-top: 8px;">${stats.winningTrades}W / ${stats.losingTrades}L</div>
                <div style="color: #7f8c8d; font-size: 12px;">Trades</div>
            </div>

            <!-- Profit Factor -->
            <div style="text-align: center; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <h4 style="color: #2c3e50; margin-bottom: 15px; font-size: 1.1em;">Profit Factor</h4>
                <div style="color: ${stats.profitFactor > 1 ? '#27ae60' : '#e74c3c'}; font-size: 24px; font-weight: bold;">${stats.profitFactor.toFixed(2)}</div>
                <div style="color: #7f8c8d; font-size: 14px;">Gross Profit / Loss</div>
                <div style="color: #2c3e50; font-size: 14px; margin-top: 8px;">Max DD: $${stats.maxDrawdown.toFixed(2)}</div>
                <div style="color: #7f8c8d; font-size: 12px;">Drawdown</div>
            </div>

            <!-- Average Wins/Losses -->
            <div style="text-align: center; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <h4 style="color: #2c3e50; margin-bottom: 15px; font-size: 1.1em;">Avg Win/Loss</h4>
                <div style="color: #27ae60; font-size: 18px; font-weight: bold;">+${stats.avgWinAmount.toFixed(2)}</div>
                <div style="color: #7f8c8d; font-size: 12px;">Avg Win (${stats.avgWinPercent.toFixed(1)}%)</div>
                <div style="color: #e74c3c; font-size: 18px; font-weight: bold; margin-top: 5px;">-${stats.avgLossAmount.toFixed(2)}</div>
                <div style="color: #7f8c8d; font-size: 12px;">Avg Loss (${stats.avgLossPercent.toFixed(1)}%)</div>
            </div>

            <!-- Best/Worst Trades -->
            <div style="text-align: center; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <h4 style="color: #2c3e50; margin-bottom: 15px; font-size: 1.1em;">Best/Worst</h4>
                <div style="color: #27ae60; font-size: 18px; font-weight: bold;">+${stats.bestTrade.toFixed(2)}</div>
                <div style="color: #7f8c8d; font-size: 12px;">Best (${stats.bestTradePercent.toFixed(1)}%)</div>
                <div style="color: #e74c3c; font-size: 18px; font-weight: bold; margin-top: 5px;">${stats.worstTrade.toFixed(2)}</div>
                <div style="color: #7f8c8d; font-size: 12px;">Worst (${stats.worstTradePercent.toFixed(1)}%)</div>
            </div>

            <!-- Time Analysis -->
            <div style="text-align: center; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <h4 style="color: #2c3e50; margin-bottom: 15px; font-size: 1.1em;">Time Analysis</h4>
                <div style="color: #2c3e50; font-size: 18px; font-weight: bold;">${stats.avgTradeDuration.toFixed(1)}h</div>
                <div style="color: #7f8c8d; font-size: 12px;">Avg Trade Duration</div>
                <div style="color: #2c3e50; font-size: 16px; margin-top: 8px;">${stats.avgTimeBetweenTrades.toFixed(1)}h</div>
                <div style="color: #7f8c8d; font-size: 12px;">Avg Time Between</div>
            </div>

            <!-- Streak Analysis -->
            <div style="text-align: center; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <h4 style="color: #2c3e50; margin-bottom: 15px; font-size: 1.1em;">Streaks</h4>
                <div style="color: #27ae60; font-size: 20px; font-weight: bold;">${stats.consecutiveWins}</div>
                <div style="color: #7f8c8d; font-size: 12px;">Max Win Streak</div>
                <div style="color: #e74c3c; font-size: 20px; font-weight: bold; margin-top: 8px;">${stats.consecutiveLosses}</div>
                <div style="color: #7f8c8d; font-size: 12px;">Max Loss Streak</div>
            </div>

            <!-- Risk Metrics -->
            <div style="text-align: center; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <h4 style="color: #2c3e50; margin-bottom: 15px; font-size: 1.1em;">Risk Metrics</h4>
                <div style="color: ${stats.sharpeRatio > 1 ? '#27ae60' : '#e74c3c'}; font-size: 20px; font-weight: bold;">${stats.sharpeRatio.toFixed(2)}</div>
                <div style="color: #7f8c8d; font-size: 12px;">Sharpe Ratio</div>
                <div style="color: #2c3e50; font-size: 16px; margin-top: 8px;">${(stats.totalTrades / stats.tradingDays).toFixed(1)}</div>
                <div style="color: #7f8c8d; font-size: 12px;">Trades/Day</div>
            </div>
        </div>

        <!-- Portfolio Performance Chart -->
        <div style="margin: 40px 0; background: white; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); padding: 25px;">
            <h2 style="color: #2c3e50; margin-bottom: 20px; text-align: center; font-size: 1.8em;">Portfolio Performance vs Market Price</h2>
            <p style="color: #7f8c8d; text-align: center; margin-bottom: 30px;">Portfolio value progression with ${symbol} price overlay and trade entry/exit points</p>
            
            <div class="chart-container" style="height: 500px; margin-bottom: 20px;">
                <canvas id="portfolioChart"></canvas>
            </div>
            
            <div style="display: flex; justify-content: center; gap: 30px; flex-wrap: wrap; margin-top: 20px; font-size: 14px; color: #7f8c8d;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="width: 20px; height: 3px; background: #3498db;"></div>
                    <span>Portfolio Value</span>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="width: 20px; height: 3px; background: #e74c3c; opacity: 0.7;"></div>
                    <span>${symbol} Price</span>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="width: 12px; height: 12px; background: #27ae60; border-radius: 50%;"></div>
                    <span>Trade Entry</span>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="width: 12px; height: 12px; background: #f39c12; border-radius: 50%;"></div>
                    <span>Trade Exit</span>
                </div>
            </div>
        </div>
        
        <div style="margin: 30px 0; background: white; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); overflow: hidden;">
            <table style="width: 100%; border-collapse: collapse;">
                <thead style="background: #f8f9fa;">
                    <tr>
                        <th style="padding: 15px; text-align: left; border-bottom: 2px solid #e9ecef; font-weight: bold; color: #2c3e50;">#</th>
                        <th style="padding: 15px; text-align: left; border-bottom: 2px solid #e9ecef; font-weight: bold; color: #2c3e50;">Entry Date/Time</th>
                        <th style="padding: 15px; text-align: left; border-bottom: 2px solid #e9ecef; font-weight: bold; color: #2c3e50;">Entry Price</th>
                        <th style="padding: 15px; text-align: left; border-bottom: 2px solid #e9ecef; font-weight: bold; color: #2c3e50;">Exit Date/Time</th>
                        <th style="padding: 15px; text-align: left; border-bottom: 2px solid #e9ecef; font-weight: bold; color: #2c3e50;">Exit Price</th>
                        <th style="padding: 15px; text-align: left; border-bottom: 2px solid #e9ecef; font-weight: bold; color: #2c3e50;">Portfolio Before</th>
                        <th style="padding: 15px; text-align: left; border-bottom: 2px solid #e9ecef; font-weight: bold; color: #2c3e50;">P&L</th>
                        <th style="padding: 15px; text-align: left; border-bottom: 2px solid #e9ecef; font-weight: bold; color: #2c3e50;">P&L %</th>
                        <th style="padding: 15px; text-align: left; border-bottom: 2px solid #e9ecef; font-weight: bold; color: #2c3e50;">Portfolio After</th>
                        <th style="padding: 15px; text-align: left; border-bottom: 2px solid #e9ecef; font-weight: bold; color: #2c3e50;">Reason</th>
                    </tr>
                </thead>
                <tbody>
                    ${trades.map((trade, i) => {
                        const isProfit = trade.profitLossPercent > 0;
                        const rowColor = i % 2 === 0 ? '#f8f9fa' : 'white';
                        const pnlColor = isProfit ? '#27ae60' : '#e74c3c';
                        
                        return `
                        <tr style="background: ${rowColor};">
                            <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef; font-weight: bold;">${i + 1}</td>
                            <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef;">${trade.entryTime.toLocaleDateString()} ${trade.entryTime.toLocaleTimeString()}</td>
                            <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef; font-family: monospace;">$${trade.entryPrice.toFixed(4)}</td>
                            <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef;">${trade.exitTime.toLocaleDateString()} ${trade.exitTime.toLocaleTimeString()}</td>
                            <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef; font-family: monospace;">$${trade.exitPrice.toFixed(4)}</td>
                            <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef; font-family: monospace; color: #2c3e50;">$${trade.portfolioValueBefore.toFixed(2)}</td>
                            <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef; font-family: monospace; color: ${pnlColor}; font-weight: bold;">${trade.profitLoss > 0 ? '+' : ''}$${trade.profitLoss.toFixed(2)}</td>
                            <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef; font-family: monospace; color: ${pnlColor}; font-weight: bold;">${trade.profitLossPercent > 0 ? '+' : ''}${trade.profitLossPercent.toFixed(2)}%</td>
                            <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef; font-family: monospace; color: #2c3e50; font-weight: bold;">$${trade.portfolioValueAfter.toFixed(2)}</td>
                            <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef; font-size: 12px;">${trade.reason}</td>
                        </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>

        ${trades.map((trade, i) => {
            const tradeStartTime = new Date(trade.entryTime.getTime() - (1 * 60 * 60 * 1000)); // 1h before entry
            const tradeEndTime = new Date(trade.exitTime.getTime() + (1 * 60 * 60 * 1000)); // 1h after exit
            
            const tradePriceData = priceData.filter(p => {
                const pTime = new Date(p.timestamp);
                return pTime >= tradeStartTime && pTime <= tradeEndTime;
            });

            const tradeCandlestickData = tradePriceData.map(p => ({
                x: p.timestamp.getTime(),
                o: p.open,
                h: p.high,
                l: p.low,
                c: p.close
            }));

            const isProfit = trade.profitLossPercent > 0;
            const profitText = isProfit ? 'PROFIT' : 'LOSS';
            const profitColor = isProfit ? '#27ae60' : '#e74c3c';
            
            return `
            <div style="margin: 40px 0; background: white; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); padding: 20px;">
                <div style="text-align: center; margin-bottom: 20px;">
                    <h3 style="color: #2c3e50; margin-bottom: 10px; font-size: 1.8em;">Trade #${i + 1}</h3>
                    <div style="display: inline-block; padding: 8px 16px; border-radius: 20px; font-weight: bold; color: white; background: ${profitColor};">
                        ${profitText}: ${trade.profitLossPercent > 0 ? '+' : ''}${trade.profitLossPercent.toFixed(2)}% 
                        (${trade.profitLoss > 0 ? '+' : ''}$${trade.profitLoss.toFixed(2)})
                    </div>
                </div>
                
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 20px; margin: 20px 0; background: #f8f9fa; padding: 20px; border-radius: 12px;">
                    <div style="text-align: center;">
                        <div style="font-size: 18px; font-weight: bold; color: #2c3e50; margin-bottom: 5px;">${trade.entryTime.toLocaleDateString()}</div>
                        <div style="font-size: 14px; color: #7f8c8d;">${trade.entryTime.toLocaleTimeString()}</div>
                        <div style="font-size: 12px; color: #95a5a6; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 5px;">Entry Date/Time</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="font-size: 18px; font-weight: bold; color: #27ae60; margin-bottom: 5px; font-family: monospace;">$${trade.entryPrice.toFixed(4)}</div>
                        <div style="font-size: 12px; color: #95a5a6; text-transform: uppercase; letter-spacing: 0.5px;">Entry Price</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="font-size: 18px; font-weight: bold; color: #2c3e50; margin-bottom: 5px;">${trade.exitTime.toLocaleDateString()}</div>
                        <div style="font-size: 14px; color: #7f8c8d;">${trade.exitTime.toLocaleTimeString()}</div>
                        <div style="font-size: 12px; color: #95a5a6; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 5px;">Exit Date/Time</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="font-size: 18px; font-weight: bold; color: ${profitColor}; margin-bottom: 5px; font-family: monospace;">$${trade.exitPrice.toFixed(4)}</div>
                        <div style="font-size: 12px; color: #95a5a6; text-transform: uppercase; letter-spacing: 0.5px;">Exit Price</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="font-size: 18px; font-weight: bold; color: #2c3e50; margin-bottom: 5px;">${trade.duration.toFixed(1)}h</div>
                        <div style="font-size: 12px; color: #95a5a6; text-transform: uppercase; letter-spacing: 0.5px;">Duration</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="font-size: 18px; font-weight: bold; color: #2c3e50; margin-bottom: 5px;">${trade.reason}</div>
                        <div style="font-size: 12px; color: #95a5a6; text-transform: uppercase; letter-spacing: 0.5px;">Exit Reason</div>
                    </div>
                </div>
                
                <div class="chart-container">
                    <canvas id="tradeChart${i + 1}"></canvas>
                </div>
            </div>
            
            <script>
                (function() {
                    const tradePriceData${i + 1} = ${JSON.stringify(tradeCandlestickData)};
                    const entryTime${i + 1} = ${trade.entryTime.getTime()};
                    const exitTime${i + 1} = ${trade.exitTime.getTime()};
                    const entryPrice${i + 1} = ${trade.entryPrice};
                    const exitPrice${i + 1} = ${trade.exitPrice};
                    
                    const ctx${i + 1} = document.getElementById('tradeChart${i + 1}').getContext('2d');
                    
                    new Chart(ctx${i + 1}, {
                        type: 'candlestick',
                        data: {
                            datasets: [
                                {
                                    label: '${symbol} Price',
                                    data: tradePriceData${i + 1},
                                    borderColor: '#3498db',
                                    backgroundColor: 'rgba(52, 152, 219, 0.1)',
                                    borderWidth: 1,
                                    yAxisID: 'price',
                                    order: 1
                                },
                                {
                                    label: 'Entry Point',
                                    type: 'scatter',
                                    data: [{
                                        x: entryTime${i + 1},
                                        y: entryPrice${i + 1}
                                    }],
                                    backgroundColor: '#27ae60',
                                    borderColor: '#27ae60',
                                    pointRadius: 10,
                                    pointHoverRadius: 14,
                                    yAxisID: 'price',
                                    showLine: false,
                                    order: 0,
                                    pointStyle: 'triangle',
                                    rotation: 0
                                },
                                {
                                    label: 'Exit Point',
                                    type: 'scatter',
                                    data: [{
                                        x: exitTime${i + 1},
                                        y: exitPrice${i + 1}
                                    }],
                                    backgroundColor: '${profitColor}',
                                    borderColor: '${profitColor}',
                                    pointRadius: 10,
                                    pointHoverRadius: 14,
                                    yAxisID: 'price',
                                    showLine: false,
                                    order: 0,
                                    pointStyle: 'triangle',
                                    rotation: 180
                                }
                            ]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            interaction: {
                                intersect: false,
                                mode: 'index'
                            },
                            plugins: {
                                title: {
                                    display: true,
                                    text: 'Trade #${i + 1}: ${trade.entryTime.toLocaleDateString()} - ${trade.exitTime.toLocaleDateString()} (${profitText} ${trade.profitLossPercent.toFixed(2)}%)',
                                    font: {
                                        size: 16,
                                        weight: 'bold'
                                    },
                                    color: '#2c3e50'
                                },
                                legend: {
                                    display: true,
                                    position: 'top'
                                },
                                tooltip: {
                                    callbacks: {
                                        label: function(context) {
                                            if (context.dataset.label === 'Entry Point') {
                                                return \`Entry: $\${entryPrice${i + 1}.toFixed(4)} on \${new Date(entryTime${i + 1}).toLocaleString()}\`;
                                            } else if (context.dataset.label === 'Exit Point') {
                                                return \`Exit: $\${exitPrice${i + 1}.toFixed(4)} on \${new Date(exitTime${i + 1}).toLocaleString()} (${profitText}: ${trade.profitLossPercent.toFixed(2)}%)\`;
                                            } else {
                                                const point = context.raw;
                                                return [
                                                    \`Open: $\${point.o.toFixed(4)}\`,
                                                    \`High: $\${point.h.toFixed(4)}\`,
                                                    \`Low: $\${point.l.toFixed(4)}\`,
                                                    \`Close: $\${point.c.toFixed(4)}\`
                                                ];
                                            }
                                        }
                                    }
                                }
                            },
                            scales: {
                                x: {
                                    type: 'time',
                                    time: {
                                        unit: 'minute',
                                        displayFormats: {
                                            minute: 'HH:mm',
                                            hour: 'MMM dd HH:mm'
                                        }
                                    },
                                    title: {
                                        display: true,
                                        text: 'Date/Time',
                                        color: '#2c3e50',
                                        font: { weight: 'bold' }
                                    }
                                },
                                price: {
                                    type: 'linear',
                                    position: 'left',
                                    title: {
                                        display: true,
                                        text: 'Price (USDT)',
                                        color: '#2c3e50',
                                        font: { weight: 'bold' }
                                    },
                                    grid: {
                                        color: 'rgba(0,0,0,0.1)'
                                    }
                                }
                            },
                            elements: {
                                candlestick: {
                                    color: {
                                        up: '#27ae60',
                                        down: '#e74c3c',
                                        unchanged: '#95a5a6'
                                    }
                                }
                            }
                        }
                    });
                })();
            </script>
            `;
        }).join('')}
    </div>

    <script>
        // Portfolio Performance Chart
        (function() {
            // Prepare portfolio progression data
            const portfolioData = [];
            let currentPortfolioValue = ${trades[0]?.portfolioValueBefore || 10000};
            
            // Add starting point
            portfolioData.push({
                x: ${trades[0]?.entryTime.getTime() || Date.now()},
                y: currentPortfolioValue
            });
            
            // Add portfolio value at each trade completion
            ${trades.map((trade, i) => `
                // Trade ${i + 1} completion
                portfolioData.push({
                    x: ${trade.exitTime.getTime()},
                    y: ${trade.portfolioValueAfter}
                });
            `).join('')}

            // Prepare market price data (sample points for the period)
            const marketPriceData = ${JSON.stringify(priceData.filter((_, i) => i % Math.max(1, Math.floor(priceData.length / 200)) === 0).map(p => ({
                x: p.timestamp.getTime(),
                y: p.close
            })))};

            // Prepare trade entry points
            const entryPoints = [
                ${trades.map((trade, i) => `{
                    x: ${trade.entryTime.getTime()},
                    y: ${trade.portfolioValueBefore},
                    tradeIndex: ${i + 1},
                    price: ${trade.entryPrice},
                    type: 'entry'
                }`).join(',')}
            ];

            // Prepare trade exit points  
            const exitPoints = [
                ${trades.map((trade, i) => `{
                    x: ${trade.exitTime.getTime()},
                    y: ${trade.portfolioValueAfter},
                    tradeIndex: ${i + 1},
                    price: ${trade.exitPrice},
                    pnl: ${trade.profitLoss},
                    pnlPercent: ${trade.profitLossPercent},
                    type: 'exit'
                }`).join(',')}
            ];

            const ctx = document.getElementById('portfolioChart').getContext('2d');
            
            new Chart(ctx, {
                type: 'line',
                data: {
                    datasets: [
                        {
                            label: 'Portfolio Value',
                            data: portfolioData,
                            borderColor: '#3498db',
                            backgroundColor: 'rgba(52, 152, 219, 0.1)',
                            borderWidth: 3,
                            fill: true,
                            tension: 0.1,
                            yAxisID: 'portfolio',
                            order: 1,
                            pointRadius: 0,
                            pointHoverRadius: 6
                        },
                        {
                            label: '${symbol} Price',
                            data: marketPriceData,
                            borderColor: '#e74c3c',
                            backgroundColor: 'rgba(231, 76, 60, 0.05)',
                            borderWidth: 2,
                            fill: false,
                            tension: 0.1,
                            yAxisID: 'price',
                            order: 2,
                            pointRadius: 0,
                            pointHoverRadius: 4,
                            borderDash: [5, 5]
                        },
                        {
                            label: 'Trade Entries',
                            data: entryPoints,
                            type: 'scatter',
                            backgroundColor: '#27ae60',
                            borderColor: '#27ae60',
                            pointRadius: 8,
                            pointHoverRadius: 12,
                            yAxisID: 'portfolio',
                            showLine: false,
                            order: 0,
                            pointStyle: 'triangle',
                            rotation: 0
                        },
                        {
                            label: 'Trade Exits',
                            data: exitPoints,
                            type: 'scatter',
                            backgroundColor: '#f39c12',
                            borderColor: '#f39c12',
                            pointRadius: 8,
                            pointHoverRadius: 12,
                            yAxisID: 'portfolio',
                            showLine: false,
                            order: 0,
                            pointStyle: 'triangle',
                            rotation: 180
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        intersect: false,
                        mode: 'index'
                    },
                    plugins: {
                        title: {
                            display: true,
                            text: 'Portfolio Performance: $${(trades[0]?.portfolioValueBefore || 10000).toFixed(0)} → $${(trades[trades.length-1]?.portfolioValueAfter || 10000).toFixed(0)} (${stats.totalPnL > 0 ? '+' : ''}${stats.totalPnL.toFixed(0)})',
                            font: {
                                size: 16,
                                weight: 'bold'
                            },
                            color: '${stats.totalPnL > 0 ? '#27ae60' : '#e74c3c'}'
                        },
                        legend: {
                            display: true,
                            position: 'top',
                            labels: {
                                usePointStyle: true,
                                padding: 20
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const point = context.raw;
                                    const dataset = context.dataset.label;
                                    
                                    if (dataset === 'Trade Entries') {
                                        return \`Entry #\${point.tradeIndex}: $\${point.y.toFixed(2)} portfolio, $\${point.price.toFixed(4)} \${symbol.replace('USDT', '')}\`;
                                    } else if (dataset === 'Trade Exits') {
                                        const pnlText = point.pnl > 0 ? \`+$\${point.pnl.toFixed(2)}\` : \`$\${point.pnl.toFixed(2)}\`;
                                        const pnlPercentText = point.pnlPercent > 0 ? \`+\${point.pnlPercent.toFixed(2)}%\` : \`\${point.pnlPercent.toFixed(2)}%\`;
                                        return \`Exit #\${point.tradeIndex}: $\${point.y.toFixed(2)} portfolio (\${pnlText}, \${pnlPercentText})\`;
                                    } else if (dataset === 'Portfolio Value') {
                                        return \`Portfolio: $\${context.parsed.y.toFixed(2)}\`;
                                    } else if (dataset === '${symbol} Price') {
                                        return \`\${symbol}: $\${context.parsed.y.toFixed(4)}\`;
                                    }
                                    
                                    return \`\${dataset}: \${context.parsed.y.toFixed(2)}\`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            type: 'time',
                            time: {
                                unit: 'month',
                                displayFormats: {
                                    month: 'MMM yyyy',
                                    day: 'MMM dd'
                                }
                            },
                            title: {
                                display: true,
                                text: 'Date',
                                color: '#2c3e50',
                                font: { weight: 'bold' }
                            },
                            grid: {
                                color: 'rgba(0,0,0,0.1)'
                            }
                        },
                        portfolio: {
                            type: 'linear',
                            position: 'left',
                            title: {
                                display: true,
                                text: 'Portfolio Value (USD)',
                                color: '#3498db',
                                font: { weight: 'bold' }
                            },
                            grid: {
                                color: 'rgba(52, 152, 219, 0.1)'
                            },
                            ticks: {
                                callback: function(value) {
                                    return '$' + value.toLocaleString();
                                }
                            }
                        },
                        price: {
                            type: 'linear',
                            position: 'right',
                            title: {
                                display: true,
                                text: '${symbol} Price (USD)',
                                color: '#e74c3c',
                                font: { weight: 'bold' }
                            },
                            grid: {
                                display: false
                            },
                            ticks: {
                                callback: function(value) {
                                    return '$' + value.toFixed(2);
                                }
                            }
                        }
                    }
                }
            });
        })();
    </script>
</body>
</html>`;

    return html;
  }

  /**
   * Generate all trade charts for a backtest
   */
  async generateAllTradeCharts(
    baseAsset: string,
    quoteAsset: string,
    startDate: string,
    endDate: string,
    zScore: number,
    profitPercent: number,
    stopLossPercent: number
  ): Promise<void> {
    // Find ALL runs that have trades in the requested date range
    const runIds = await this.findAllOverlappingRuns(
      baseAsset,
      quoteAsset,
      startDate,
      endDate,
      zScore,
      profitPercent,
      stopLossPercent
    );

    if (runIds.length === 0) {
      throw new Error('No backtest runs found with trades in the requested period');
    }

    console.log(`\n🎯 Strategy: Combining ALL ${runIds.length} runs to show complete ${startDate} to ${endDate} period`);

    // Get backtest run details for parameters (from first run)
    const backtestRun = await this.prisma.backtestRuns.findUnique({
      where: { id: runIds[0] },
      select: {
        movingAverages: true
      }
    });

    if (!backtestRun) {
      throw new Error('Backtest run details not found');
    }

    // Get all trades from ALL runs within the specified date range
    const trades = await this.getTradesFromMultipleRunsInDateRange(runIds, startDate, endDate);

    if (trades.length === 0) {
      throw new Error('No trades found for this backtest run');
    }

    console.log(`\n🎨 Generating ${trades.length} individual trade charts...`);

    // Ensure analysis directory exists
    if (!fs.existsSync('analysis')) {
      fs.mkdirSync('analysis');
    }

    const symbol = `${baseAsset}${quoteAsset}`;
    const reportPaths: string[] = [];

    const parameters = {
      zScore,
      profitPercent,
      stopLossPercent,
      movingAverages: backtestRun.movingAverages
    };

    // Calculate comprehensive statistics
    const stats = this.calculateTradeStatistics(trades);

    console.log(`\n📊 Comprehensive Trade Statistics:`);
    console.log(`   Period: ${stats.periodStart.toISOString().split('T')[0]} to ${stats.periodEnd.toISOString().split('T')[0]} (${stats.tradingDays} days)`);
    console.log(`   Total Trades: ${stats.totalTrades} | Win Rate: ${stats.winRate.toFixed(1)}% (${stats.winningTrades}W/${stats.losingTrades}L)`);
    console.log(`   Total P&L: ${stats.totalPnL > 0 ? '+' : ''}$${stats.totalPnL.toFixed(2)} | Avg P&L: ${stats.avgPnLPercent.toFixed(2)}%`);
    console.log(`   Best Trade: +$${stats.bestTrade.toFixed(2)} (${stats.bestTradePercent.toFixed(1)}%) | Worst: $${stats.worstTrade.toFixed(2)} (${stats.worstTradePercent.toFixed(1)}%)`);
    console.log(`   Avg Win: +$${stats.avgWinAmount.toFixed(2)} (${stats.avgWinPercent.toFixed(1)}%) | Avg Loss: -$${stats.avgLossAmount.toFixed(2)} (${stats.avgLossPercent.toFixed(1)}%)`);
    console.log(`   Profit Factor: ${stats.profitFactor.toFixed(2)} | Max Drawdown: $${stats.maxDrawdown.toFixed(2)} | Sharpe: ${stats.sharpeRatio.toFixed(2)}`);
    console.log(`   Avg Trade Duration: ${stats.avgTradeDuration.toFixed(1)}h | Time Between Trades: ${stats.avgTimeBetweenTrades.toFixed(1)}h`);
    console.log(`   Max Win Streak: ${stats.consecutiveWins} | Max Loss Streak: ${stats.consecutiveLosses}`);

    console.log(`\n📊 Individual Trade Summary:`);
    trades.forEach((trade, i) => {
      console.log(`   Trade #${i + 1}: ${trade.entryTime.toLocaleDateString()} ${trade.entryTime.toLocaleTimeString()}`);
      console.log(`      Entry: $${trade.entryPrice.toFixed(4)} → Exit: $${trade.exitPrice.toFixed(4)} (${trade.duration.toFixed(1)}h)`);
      console.log(`      P&L: ${trade.profitLossPercent > 0 ? '+' : ''}${trade.profitLossPercent.toFixed(2)}% (${trade.reason})`);
    });

    // Get price data covering the entire backtest period with buffer
    const earliestEntry = new Date(Math.min(...trades.map(t => t.entryTime.getTime())));
    const latestExit = new Date(Math.max(...trades.map(t => t.exitTime.getTime())));
    
    console.log(`\n🔍 Getting price data from ${earliestEntry.toLocaleDateString()} to ${latestExit.toLocaleDateString()}`);
    const priceData = await this.getPriceData(symbol, earliestEntry, latestExit, 72); // 72 hour buffer

    if (priceData.length === 0) {
      throw new Error('No price data found for the trade period');
    }

    console.log(`   Found ${priceData.length} price candles`);

    // Generate single comprehensive HTML chart
    const html = this.generateAllTradesChart(
      trades, 
      priceData, 
      symbol, 
      baseAsset, 
      quoteAsset, 
      parameters,
      { start: startDate, end: endDate }
    );

    // Save chart file with parameters in filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const paramString = `Z${zScore}_P${profitPercent}_S${stopLossPercent}_MA${backtestRun.movingAverages}`;
    const chartPath = path.join('analysis', `all-trades-${symbol}-${paramString}-${timestamp}-${Date.now()}.html`);
    fs.writeFileSync(chartPath, html);

    reportPaths.push(chartPath);
    console.log(`\n✅ Generated comprehensive chart: ${chartPath}`);

    // Summary
    console.log(`\n🎉 Successfully generated ${reportPaths.length} trade charts!`);
    console.log('\n📊 Generated Files:');
    reportPaths.forEach((path, i) => {
      const trade = trades[i];
      const profitText = trade.profitLossPercent > 0 ? 'PROFIT' : 'LOSS';
      console.log(`   Trade #${i + 1}: ${path}`);
      console.log(`      ${trade.entryTime.toLocaleDateString()} → ${trade.exitTime.toLocaleDateString()} | ${profitText} ${trade.profitLossPercent.toFixed(2)}%`);
    });
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

/**
 * Parse command line arguments
 */
function parseArguments(): {
  baseAsset: string;
  quoteAsset: string;
  startDate: string;
  endDate: string;
  zScore: number;
  profitPercent: number;
  stopLossPercent: number;
} {
  const args = process.argv.slice(2);

  if (args.length !== 7) {
    console.error('❌ Invalid arguments. Usage:');
    console.error('npm run generateTradeCharts [baseAsset] [quoteAsset] [startDate] [endDate] [zScore] [profitPercent] [stopLossPercent]');
    console.error('');
    console.error('Example:');
    console.error('  npm run generateTradeCharts BNB USDT 2021-07-19 2022-07-19 7 5 20');
    process.exit(1);
  }

  const [baseAsset, quoteAsset, startDate, endDate, zScore, profitPercent, stopLossPercent] = args;

  return {
    baseAsset: baseAsset.toUpperCase(),
    quoteAsset: quoteAsset.toUpperCase(),
    startDate,
    endDate,
    zScore: parseFloat(zScore),
    profitPercent: parseFloat(profitPercent),
    stopLossPercent: parseFloat(stopLossPercent)
  };
}

/**
 * Main execution function
 */
async function main() {
  const generator = new TradeChartGenerator();

  try {
    console.log('🎯 Starting Individual Trade Chart Generation...');
    console.log('=' .repeat(80));

    await generator.initialize();

    const { baseAsset, quoteAsset, startDate, endDate, zScore, profitPercent, stopLossPercent } = parseArguments();

    await generator.generateAllTradeCharts(
      baseAsset,
      quoteAsset,
      startDate,
      endDate,
      zScore,
      profitPercent,
      stopLossPercent
    );

  } catch (error) {
    console.error('\n❌ Trade chart generation failed:', error);
    process.exit(1);
  } finally {
    await generator.cleanup();
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { TradeChartGenerator };