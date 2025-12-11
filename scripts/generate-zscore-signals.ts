#!/usr/bin/env ts-node

/**
 * Z-Score Momentum Signal Generator (ALIGNED WITH LIVE TRADING)
 * 
 * This script generates trading signals using the "Cross-Sectional Z-Score" logic
 * found in the Live Trading Engine (TradingEngine.ts).
 * 
 * Logic:
 * 1. For each timestamp, calculate the Market Mean and StdDev of Glicko ratings across ALL coins.
 * 2. Calculate the Z-Score for each coin relative to the market: (Rating - MarketMean) / MarketStdDev.
 * 3. Maintain a moving average of this Z-Score for each coin.
 * 4. Trigger signals if the Moving Average Z-Score exceeds the threshold.
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

interface TradingSignal {
  symbol: string;
  timestamp: Date;
  signal: 'BUY' | 'SELL' | 'HOLD';
  zScore: number;
  glickoRating: number;
  confidence: number;
  priceAtSignal: number;
  volumeScore: number; // Kept for interface compatibility, set to 0 or calculated if possible
  reason: string;
}

interface SignalMetrics {
  symbol: string;
  signalsGenerated: number;
  buySignals: number;
  sellSignals: number;
  avgZScore: number;
  avgConfidence: number;
}

class ZScoreSignalGenerator {
  private prisma: PrismaClient;
  
  // Signal generation parameters
  private readonly Z_SCORE_THRESHOLD = 2.0;
  private readonly WINDOW_SIZE = 20; // Moving window for z-score moving average calculation
  
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
   * Generate signals for all symbols using Cross-Sectional Logic
   */
  async generateAllSignals(
    startDate?: Date,
    endDate?: Date,
    symbols?: string[]
  ): Promise<{ signals: TradingSignal[]; metrics: SignalMetrics[] }> {
    console.log('🚀 Generating Cross-Sectional Z-Score signals (Matching Live Engine)...');

    const whereClause: any = {};
    if (startDate) whereClause.timestamp = { gte: startDate };
    if (endDate) whereClause.timestamp = { ...whereClause.timestamp, lte: endDate };

    console.log('DATA', 'Fetching ALL Glicko ratings for the period...');
    
    // 1. Fetch ALL ratings for the period
    const allRatings = await this.prisma.glickoRatings.findMany({
      where: whereClause,
      orderBy: { timestamp: 'asc' },
      select: {
        symbol: true,
        timestamp: true,
        rating: true,
        // We need price data for the signal object, but fetching it here via join might be slow
        // We'll try to fetch it efficiently or lookup later
      }
    });

    console.log(`DATA`, `Fetched ${allRatings.length} ratings. Grouping by timestamp...`);

    // 2. Group by timestamp (bucketed to nearest minute to handle slight alignment issues)
    const ratingsByTime = new Map<number, Array<{ symbol: string; rating: number; timestamp: Date }>>();
    
    // Filter by BASE_COINS if defined (to match Live Trading which monitors specific list)
    const baseCoinsEnv = process.env.BASE_COINS?.split(',').map(s => s.trim());
    // Handle both "BTC" and "BTCUSDT" formats in env var, ensure we match database symbol format (usually "BTCUSDT")
    const allowedSymbols = baseCoinsEnv ? new Set(baseCoinsEnv.map(c => c.endsWith('USDT') ? c : `${c}USDT`)) : null;
    
    if (allowedSymbols) {
      console.log(`CONFIG`, `Filtering ratings for ${allowedSymbols.size} symbols defined in BASE_COINS`);
    }

    for (const r of allRatings) {
      if (symbols && symbols.length > 0 && !symbols.includes(r.symbol)) continue;
      if (allowedSymbols && !allowedSymbols.has(r.symbol)) continue;
      
      // Round to nearest minute to align disparate timestamps
      const timeKey = Math.round(r.timestamp.getTime() / 60000) * 60000;
      
      if (!ratingsByTime.has(timeKey)) {
        ratingsByTime.set(timeKey, []);
      }
      ratingsByTime.get(timeKey)!.push({
        symbol: r.symbol,
        rating: Number(r.rating),
        timestamp: r.timestamp
      });
    }

    const sortedTimeKeys = Array.from(ratingsByTime.keys()).sort((a, b) => a - b);
    console.log(`DATA`, `Processed ${sortedTimeKeys.length} time intervals.`);

    // 3. Process Time Steps
    const signals: TradingSignal[] = [];
    const zScoreHistory = new Map<string, number[]>(); // History of Z-Scores for MA calculation
    const signalCounts = new Map<string, { buy: number; sell: number; total: number; zScoreSum: number }>();

    for (const timeKey of sortedTimeKeys) {
      const intervalRatings = ratingsByTime.get(timeKey)!;
      
      if (intervalRatings.length < 2) continue; // Need at least 2 to calculate stdDev

      // Calculate Market Stats (Cross-Sectional)
      const ratingValues = intervalRatings.map(r => r.rating);
      const meanRating = ratingValues.reduce((sum, r) => sum + r, 0) / ratingValues.length;
      const variance = ratingValues.reduce((sum, r) => sum + Math.pow(r - meanRating, 2), 0) / ratingValues.length;
      const stdDevRating = Math.sqrt(variance);

      if (stdDevRating === 0) continue;

      // Calculate Z-Scores for each symbol
      for (const { symbol, rating, timestamp } of intervalRatings) {
        // Cross-Sectional Z-Score
        const currentZScore = (rating - meanRating) / stdDevRating;

        // Maintain History for Moving Average
        if (!zScoreHistory.has(symbol)) {
          zScoreHistory.set(symbol, []);
        }
        const history = zScoreHistory.get(symbol)!;
        history.push(currentZScore);
        
        // Keep history size limited to WINDOW_SIZE
        if (history.length > this.WINDOW_SIZE) {
          history.shift();
        }

        // Need enough history for MA
        if (history.length < this.WINDOW_SIZE) continue;

        // Calculate Moving Average Z-Score (Smoothed Z-Score)
        const maZScore = history.reduce((sum, z) => sum + z, 0) / history.length;

        // Check Threshold
        let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
        if (maZScore >= this.Z_SCORE_THRESHOLD) {
          signal = 'BUY';
        } else if (maZScore <= -this.Z_SCORE_THRESHOLD) {
          signal = 'SELL';
        }

        if (signal !== 'HOLD') {
          // Lookup price for this symbol/time (Optimization: fetch only when signal generated)
          // For now, we might use 0 or try to find it. 
          // Using 0 is dangerous for backtest if it relies on `priceAtSignal`.
          // Let's fetch the kline for this specific signal.
          const kline = await this.prisma.klines.findFirst({
            where: {
              symbol: symbol,
              openTime: { lte: timestamp } // Closest previous candle
            },
            orderBy: { openTime: 'desc' },
            select: { close: true }
          });
          
          const price = kline ? Number(kline.close) : 0;

          signals.push({
            symbol,
            timestamp,
            signal,
            zScore: maZScore, // Use MA Z-Score as the signal strength indicator
            glickoRating: rating,
            confidence: Math.min(Math.abs(maZScore) / 3, 1), // Simple confidence derived from Z strength
            priceAtSignal: price,
            volumeScore: 0, // Not used in core logic anymore
            reason: `Cross-Sectional MA Z-Score: ${maZScore.toFixed(2)}`
          });

          // Update Metrics
          if (!signalCounts.has(symbol)) {
            signalCounts.set(symbol, { buy: 0, sell: 0, total: 0, zScoreSum: 0 });
          }
          const count = signalCounts.get(symbol)!;
          count.total++;
          if (signal === 'BUY') count.buy++;
          if (signal === 'SELL') count.sell++;
          count.zScoreSum += Math.abs(maZScore);
        }
      }
    }

    // Compile Metrics
    const metrics: SignalMetrics[] = [];
    for (const [symbol, counts] of signalCounts) {
      metrics.push({
        symbol,
        signalsGenerated: counts.total,
        buySignals: counts.buy,
        sellSignals: counts.sell,
        avgZScore: counts.total > 0 ? counts.zScoreSum / counts.total : 0,
        avgConfidence: 0 // Simplified
      });
    }

    return { signals, metrics };
  }

  /**
   * Save signals to a log file for analysis
   */
  async saveSignalsToFile(signals: TradingSignal[], filename: string): Promise<void> {
    const fs = require('fs');
    const path = require('path');
    
    // Ensure analysis directory exists
    const analysisDir = path.join(process.cwd(), 'analysis');
    if (!fs.existsSync(analysisDir)) {
      fs.mkdirSync(analysisDir, { recursive: true });
    }

    const filePath = path.join(analysisDir, filename);
    
    // Convert signals to CSV format
    const csvHeader = 'Symbol,Timestamp,Signal,ZScore,GlickoRating,Confidence,Price,VolumeScore,Reason\n';
    const csvData = signals.map(signal => 
      `${signal.symbol},${signal.timestamp.toISOString()},${signal.signal},${signal.zScore.toFixed(4)},${signal.glickoRating.toFixed(2)},${signal.confidence.toFixed(3)},${signal.priceAtSignal.toFixed(8)},${signal.volumeScore.toFixed(3)},"${signal.reason}"`
    ).join('\n');

    fs.writeFileSync(filePath, csvHeader + csvData);
    console.log(`📁 Signals saved to ${filePath}`);
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
    console.log('🧹 Cleanup completed');
  }

  // DEPRECATED: Kept for interface compatibility but warns
  async generateSignalsForSymbol(symbol: string): Promise<TradingSignal[]> {
    console.warn('⚠️ generateSignalsForSymbol is deprecated and does not use Cross-Sectional logic. Use generateAllSignals instead.');
    return [];
  }
}

// Main execution function
async function main() {
  const generator = new ZScoreSignalGenerator();
  
  try {
    console.log('🎯 Starting z-score momentum signal generation...');
    console.log('=' .repeat(60));
    
    await generator.initialize();

    // Generate signals for the last 30 days of data
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - (30 * 24 * 60 * 60 * 1000));

    console.log(`📅 Analyzing data from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);

    const { signals, metrics } = await generator.generateAllSignals(startDate, endDate);

    // Display results
    console.log('\n📊 Signal Generation Summary:');
    console.log(`  - Total signals generated: ${signals.length}`);
    console.log(`  - Buy signals: ${signals.filter(s => s.signal === 'BUY').length}`);
    console.log(`  - Sell signals: ${signals.filter(s => s.signal === 'SELL').length}`);

    // Show top signal metrics
    const topMetrics = metrics
      .filter(m => m.signalsGenerated > 0)
      .sort((a, b) => b.signalsGenerated - a.signalsGenerated)
      .slice(0, 10);

    console.log('\n🏆 Top 10 Signal-Generating Pairs:');
    topMetrics.forEach((metric, i) => {
      console.log(`  ${i + 1}. ${metric.symbol}: ${metric.signalsGenerated} signals (${metric.buySignals}B/${metric.sellSignals}S)`);
    });

    // Save signals to file
    const timestamp = new Date().toISOString().split('T')[0];
    await generator.saveSignalsToFile(signals, `zscore-signals-${timestamp}.csv`);

    console.log('\n🎉 Signal generation completed successfully!');
    console.log('Signals are ready for backtesting analysis.');
    
  } catch (error) {
    console.error('\n💥 Signal generation failed:', error);
    process.exit(1);
  } finally {
    await generator.cleanup();
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { ZScoreSignalGenerator, type TradingSignal };