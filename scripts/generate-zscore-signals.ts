#!/usr/bin/env ts-node

/**
 * Z-Score Momentum Signal Generator (UNIFIED WITH LIVE TRADING)
 *
 * This script generates trading signals using the EXACT same services as live trading:
 * - SignalGeneratorService for signal generation
 * - GlickoEngine for pairwise rating calculations
 * - Ensures 100% consistency between backtest and live trading
 *
 * Logic:
 * 1. Calculate pairwise Glicko ratings using GlickoEngine (same as TradingEngine)
 * 2. Generate signals using SignalGeneratorService (same as TradingEngine)
 * 3. Guaranteed identical behavior to live trading
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { SignalGeneratorService, RatingInput } from '../src/services/SignalGeneratorService';
import { GlickoEngine } from '../src/services/GlickoEngine';
import { TradingParameterSet } from '../src/types';

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
  private signalGenerator: SignalGeneratorService;
  private glickoEngine: GlickoEngine;

  // Default signal generation parameters (can be overridden)
  private readonly DEFAULT_Z_SCORE_THRESHOLD = 2.0;
  private readonly DEFAULT_MOVING_AVERAGES = 20;

  constructor() {
    this.prisma = new PrismaClient();
    this.signalGenerator = new SignalGeneratorService();
    this.glickoEngine = new GlickoEngine();
  }

  async initialize(): Promise<void> {
    try {
      await this.prisma.$connect();
      console.log('✅ Connected to database');
      console.log('✅ SignalGeneratorService initialized');
      console.log('✅ GlickoEngine initialized');
    } catch (error) {
      console.error('❌ Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Generate signals using pairwise Glicko ratings (UNIFIED WITH LIVE TRADING)
   *
   * This method mirrors TradingEngine.calculatePairwiseRatings() but processes
   * historical data instead of real-time data.
   */
  async generateAllSignals(
    startDate?: Date,
    endDate?: Date,
    symbols?: string[],
    parameterSets?: Map<string, TradingParameterSet>
  ): Promise<{ signals: TradingSignal[]; metrics: SignalMetrics[] }> {
    console.log('🚀 Generating pairwise Glicko-based signals (UNIFIED WITH LIVE TRADING)...');
    console.log(`📅 Period: ${startDate?.toISOString()} to ${endTime?.toISOString()}`);

    // 1. Get BASE_COINS from environment (match TradingEngine behavior)
    const baseCoins = (process.env.BASE_COINS?.split(',').map(coin => coin.trim()) || [])
      .filter(coin => coin !== 'USDT');

    if (baseCoins.length === 0) {
      throw new Error('BASE_COINS environment variable must be set');
    }

    console.log(`📊 Processing ${baseCoins.length} coins: ${baseCoins.join(', ')}`);

    // 2. Generate trading pairs between coins
    const tradingPairs: Array<{ pair: string; base: string; quote: string }> = [];
    for (const base of baseCoins) {
      for (const quote of baseCoins) {
        if (base !== quote) {
          tradingPairs.push({ pair: `${base}${quote}`, base, quote });
        }
      }
    }

    console.log(`🔗 Generated ${tradingPairs.length} potential trading pairs`);

    // 3. Fetch klines for all pairs in chunks (performance optimization)
    const chunkSize = 30 * 24 * 60 * 60 * 1000; // 30 days
    const startTime = startDate || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // Default 90 days
    const endTime = endDate || new Date();

    const allSignals: TradingSignal[] = [];
    const signalCounts = new Map<string, { buy: number; sell: number; total: number; zScoreSum: number }>();

    // Process in chunks to avoid memory issues
    for (let currentTime = startTime.getTime(); currentTime < endTime.getTime(); currentTime += chunkSize) {
      const chunkStart = new Date(currentTime);
      const chunkEnd = new Date(Math.min(currentTime + chunkSize, endTime.getTime()));

      console.log(`\n📈 Processing chunk: ${chunkStart.toISOString().split('T')[0]} to ${chunkEnd.toISOString().split('T')[0]}`);

      // Reset engine for this chunk
      const engine = new GlickoEngine();
      for (const coin of baseCoins) {
        engine.ensureCoinExists(coin, chunkStart);
      }

      // Fetch klines for all pairs in this chunk
      const klinesByTimestamp = new Map<string, Array<{ pair: string; kline: any; base: string; quote: string }>>();
      let activePairs = 0;

      for (const { pair, base, quote } of tradingPairs) {
        try {
          const klines = await this.prisma.klines.findMany({
            where: {
              symbol: pair,
              openTime: { gte: chunkStart, lt: chunkEnd }
            },
            orderBy: { openTime: 'asc' },
            select: {
              openTime: true,
              close: true,
              open: true,
              volume: true,
              takerBuyBaseAssetVolume: true
            }
          });

          if (klines.length > 0) {
            activePairs++;
            for (const kline of klines) {
              const timestamp = kline.openTime.toISOString();
              if (!klinesByTimestamp.has(timestamp)) {
                klinesByTimestamp.set(timestamp, []);
              }
              klinesByTimestamp.get(timestamp)!.push({ pair, kline, base, quote });
            }
          }
        } catch (error) {
          // Pair doesn't exist in database, skip
        }
      }

      console.log(`  ✓ Found ${activePairs} active trading pairs with data`);

      // Process klines chronologically
      const timestamps = Array.from(klinesByTimestamp.keys()).sort();
      console.log(`  ⏱️  Processing ${timestamps.length} timestamps`);

      // Track ratings by timestamp for signal generation
      const ratingsByTimestamp = new Map<string, Map<string, { rating: number; ratingDeviation: number; volatility: number }>>();

      for (const timestamp of timestamps) {
        const timestampData = klinesByTimestamp.get(timestamp)!;

        // Process each pair kline using GlickoEngine
        for (const { kline, base, quote } of timestampData) {
          const priceChange = (Number(kline.close) - Number(kline.open)) / Number(kline.open);
          const tsDate = new Date(timestamp);

          const volumeMetrics = kline.takerBuyBaseAssetVolume ? {
            volume: Number(kline.volume),
            takerBuyVolume: Number(kline.takerBuyBaseAssetVolume)
          } : undefined;

          engine.processGame(base, quote, priceChange, tsDate, volumeMetrics);
        }

        // Normalize ratings to prevent drift (same as TradingEngine)
        engine.normalizeRatings();

        // Store ratings for this timestamp
        const ratingsMap = new Map<string, { rating: number; ratingDeviation: number; volatility: number }>();
        for (const coin of baseCoins) {
          const state = engine.getCoinState(coin);
          if (state) {
            ratingsMap.set(coin, {
              rating: state.rating.rating,
              ratingDeviation: state.rating.ratingDeviation,
              volatility: state.rating.volatility
            });
          }
        }
        ratingsByTimestamp.set(timestamp, ratingsMap);
      }

      // Generate signals using SignalGeneratorService (same as TradingEngine)
      console.log(`  🎯 Generating signals from ${ratingsByTimestamp.size} rating snapshots`);

      // Use default parameter sets if not provided
      const defaultParamSets = parameterSets || this.createDefaultParameterSets(baseCoins);

      for (const [timestamp, ratingsMap] of ratingsByTimestamp) {
        // Convert to RatingInput format
        const ratingInputs: RatingInput[] = [];
        for (const [coin, ratingData] of ratingsMap) {
          ratingInputs.push({
            symbol: coin,
            rating: ratingData.rating,
            timestamp: new Date(timestamp)
          });
        }

        if (ratingInputs.length < 2) continue;

        // Use SignalGeneratorService to generate signals (100% consistent with live trading)
        const result = this.signalGenerator.generateSignals(ratingInputs, defaultParamSets);

        // Convert to TradingSignal format
        for (const signal of result.signals) {
          // Fetch price at signal time
          const kline = await this.prisma.klines.findFirst({
            where: {
              symbol: signal.symbol,
              openTime: { lte: signal.timestamp }
            },
            orderBy: { openTime: 'desc' },
            select: { close: true }
          });

          const price = kline ? Number(kline.close) : 0;

          allSignals.push({
            symbol: signal.symbol,
            timestamp: signal.timestamp,
            signal: signal.signal,
            zScore: signal.zScore,
            glickoRating: signal.currentRating,
            confidence: Math.min(Math.abs(signal.zScore) / 3, 1),
            priceAtSignal: price,
            volumeScore: 0,
            reason: `Pairwise Glicko MA Z-Score: ${signal.zScore.toFixed(2)}`
          });

          // Update metrics
          if (!signalCounts.has(signal.symbol)) {
            signalCounts.set(signal.symbol, { buy: 0, sell: 0, total: 0, zScoreSum: 0 });
          }
          const count = signalCounts.get(signal.symbol)!;
          count.total++;
          if (signal.signal === 'BUY') count.buy++;
          if (signal.signal === 'SELL') count.sell++;
          count.zScoreSum += Math.abs(signal.zScore);
        }
      }

      console.log(`  ✅ Generated ${allSignals.length} total signals in this chunk`);
    }

    // Compile metrics
    const metrics: SignalMetrics[] = [];
    for (const [symbol, counts] of signalCounts) {
      metrics.push({
        symbol,
        signalsGenerated: counts.total,
        buySignals: counts.buy,
        sellSignals: counts.sell,
        avgZScore: counts.total > 0 ? counts.zScoreSum / counts.total : 0,
        avgConfidence: 0
      });
    }

    console.log(`\n🎉 Signal generation complete: ${allSignals.length} signals across ${metrics.length} symbols`);
    return { signals: allSignals, metrics };
  }

  /**
   * Create default parameter sets for signal generation
   */
  private createDefaultParameterSets(baseCoins: string[]): Map<string, TradingParameterSet> {
    const paramSets = new Map<string, TradingParameterSet>();

    for (const coin of baseCoins) {
      const symbol = `${coin}USDT`;
      paramSets.set(symbol, {
        symbol,
        zScoreThreshold: this.DEFAULT_Z_SCORE_THRESHOLD,
        movingAverages: this.DEFAULT_MOVING_AVERAGES,
        profitPercent: 5,
        stopLossPercent: 3,
        allocationPercent: 10,
        enabled: true
      });
    }

    return paramSets;
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