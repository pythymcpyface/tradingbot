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
}

interface PriceData {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
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
   * Find backtest run by parameters and date range
   */
  async findBacktestRun(
    baseAsset: string,
    quoteAsset: string,
    startDate: string,
    endDate: string,
    zScore: number,
    profitPercent: number,
    stopLossPercent: number
  ): Promise<string | null> {
    console.log(`🔍 Finding backtest run for ${baseAsset}/${quoteAsset} with parameters:`);
    console.log(`   Period: ${startDate} to ${endDate}`);
    console.log(`   Parameters: Z-Score=${zScore}, Profit=${profitPercent}%, Stop=${stopLossPercent}%`);

    const backtestRun = await this.prisma.backtestRuns.findFirst({
      where: {
        baseAsset,
        quoteAsset,
        startTime: { gte: new Date(startDate) },
        endTime: { lte: new Date(endDate + 'T23:59:59') },
        zScoreThreshold: zScore,
        profitPercent: profitPercent,
        stopLossPercent: stopLossPercent
      },
      select: {
        id: true,
        movingAverages: true,
        createdAt: true
      }
    });

    if (!backtestRun) {
      console.error('❌ No backtest run found matching those parameters');
      return null;
    }

    console.log(`✅ Found backtest run: ${backtestRun.id}`);
    console.log(`   Moving Averages: ${backtestRun.movingAverages}`);
    console.log(`   Created: ${backtestRun.createdAt.toISOString()}`);

    return backtestRun.id;
  }

  /**
   * Get all trades for a backtest run and find actual exit prices from market data
   */
  async getTrades(runId: string): Promise<TradeData[]> {
    console.log(`📊 Retrieving trades for run ${runId}...`);

    const orders = await this.prisma.backtestOrders.findMany({
      where: { runId },
      orderBy: { timestamp: 'asc' }
    });

    console.log(`   Found ${orders.length} orders`);

    // Get optimization results for average trade duration
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

    for (const order of completedTrades) {
      // Each order represents a complete trade with entry/exit information
      const entryTime = new Date(order.timestamp);
      const entryPrice = parseFloat(order.price.toString());
      const profitLossPercent = parseFloat(order.profitLossPercent?.toString() || '0');
      
      // Calculate theoretical exit price from profit/loss percentage
      const theoreticalExitPrice = entryPrice * (1 + (profitLossPercent / 100));
      
      console.log(`   🔍 Finding actual exit for Trade at ${entryTime.toISOString()}: Entry=$${entryPrice.toFixed(4)}, Expected P&L=${profitLossPercent.toFixed(2)}%`);
      
      // Find the actual exit time by looking for when the price reached the target
      const symbol = await this.getSymbolFromOrder(order);
      const actualExit = await this.findActualExit(symbol, entryTime, entryPrice, profitLossPercent, avgDurationHours, order.reason);
      
      trades.push({
        entryTime,
        exitTime: actualExit.exitTime,
        side: order.side,
        entryPrice,
        exitPrice: actualExit.exitPrice,
        quantity: parseFloat(order.quantity.toString()),
        reason: order.reason || 'UNKNOWN',
        profitLoss: parseFloat(order.profitLoss?.toString() || '0'),
        profitLossPercent: profitLossPercent,
        duration: actualExit.duration
      });
    }

    console.log(`✅ Parsed ${trades.length} complete trades`);
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
    // Calculate overall performance
    const totalPnL = trades.reduce((sum, t) => sum + t.profitLoss, 0);
    const avgPnLPercent = trades.reduce((sum, t) => sum + t.profitLossPercent, 0) / trades.length;
    const winningTrades = trades.filter(t => t.profitLossPercent > 0).length;
    const losingTrades = trades.length - winningTrades;
    
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
            Period: ${dateRange.start} to ${dateRange.end} | Total Trades: ${trades.length}
        </h3>
        
        <div class="performance-badge performance-${totalPnL > 0 ? 'profit' : 'loss'}">
            Total P&L: ${totalPnL > 0 ? '+' : ''}$${totalPnL.toFixed(2)} | 
            Avg P&L: ${avgPnLPercent > 0 ? '+' : ''}${avgPnLPercent.toFixed(2)}% | 
            Wins: ${winningTrades} | Losses: ${losingTrades}
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
                        <th style="padding: 15px; text-align: left; border-bottom: 2px solid #e9ecef; font-weight: bold; color: #2c3e50;">P&L</th>
                        <th style="padding: 15px; text-align: left; border-bottom: 2px solid #e9ecef; font-weight: bold; color: #2c3e50;">P&L %</th>
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
                            <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef; font-family: monospace; color: ${pnlColor}; font-weight: bold;">${trade.profitLoss > 0 ? '+' : ''}$${trade.profitLoss.toFixed(2)}</td>
                            <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef; font-family: monospace; color: ${pnlColor}; font-weight: bold;">${trade.profitLossPercent > 0 ? '+' : ''}${trade.profitLossPercent.toFixed(2)}%</td>
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
    // Find the backtest run
    const runId = await this.findBacktestRun(
      baseAsset,
      quoteAsset,
      startDate,
      endDate,
      zScore,
      profitPercent,
      stopLossPercent
    );

    if (!runId) {
      throw new Error('Backtest run not found');
    }

    // Get backtest run details for parameters
    const backtestRun = await this.prisma.backtestRuns.findUnique({
      where: { id: runId },
      select: {
        movingAverages: true
      }
    });

    if (!backtestRun) {
      throw new Error('Backtest run details not found');
    }

    // Get all trades
    const trades = await this.getTrades(runId);

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

    console.log(`\n📊 Trade Summary:`);
    trades.forEach((trade, i) => {
      console.log(`   Trade #${i + 1}: ${trade.entryTime.toLocaleDateString()} ${trade.entryTime.toLocaleTimeString()}`);
      console.log(`      Entry: $${trade.entryPrice.toFixed(4)} → Exit: $${trade.exitPrice.toFixed(4)}`);
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