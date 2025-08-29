#!/usr/bin/env ts-node

/**
 * Z-Score Momentum Signal Generator
 * 
 * This script analyzes historical data to generate trading signals based on
 * z-score momentum combined with Glicko-2 ratings for enhanced decision making.
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
  volumeScore: number;
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
  private readonly WINDOW_SIZE = 20; // Moving window for z-score calculation
  private readonly MIN_VOLUME_RATIO = 0.1; // Minimum volume for signal validity
  private readonly CONFIDENCE_MULTIPLIER = 0.1;
  
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
   * Calculate z-score for a time series
   */
  private calculateZScores(prices: number[], windowSize: number = this.WINDOW_SIZE): number[] {
    const zScores: number[] = [];
    
    for (let i = windowSize; i < prices.length; i++) {
      const window = prices.slice(i - windowSize, i);
      const mean = window.reduce((sum, price) => sum + price, 0) / window.length;
      const variance = window.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / window.length;
      const stdDev = Math.sqrt(variance);
      
      if (stdDev > 0) {
        const zScore = (prices[i] - mean) / stdDev;
        zScores.push(zScore);
      } else {
        zScores.push(0);
      }
    }
    
    return zScores;
  }

  /**
   * Calculate volume-based buying pressure score
   */
  private calculateVolumeScore(
    volume: number,
    takerBuyVolume: number,
    avgVolume: number
  ): number {
    if (volume === 0 || avgVolume === 0) return 0;
    
    const volumeRatio = volume / avgVolume; // Volume relative to average
    const buyPressure = takerBuyVolume / volume; // Percentage of buying pressure
    
    // Score ranges from -2 to +2
    // Positive for strong buying with high volume, negative for selling
    return (buyPressure - 0.5) * 2 * Math.min(volumeRatio, 2);
  }

  /**
   * Get current Glicko rating for a symbol
   */
  private async getGlickoRating(symbol: string): Promise<{ rating: number; confidence: number } | null> {
    const rating = await this.prisma.glickoRatings.findFirst({
      where: { symbol },
      orderBy: { timestamp: 'desc' },
      select: {
        rating: true,
        ratingDeviation: true,
        volatility: true
      }
    });

    if (!rating) return null;

    // Convert rating deviation to confidence (lower RD = higher confidence)
    const confidence = Math.max(0, Math.min(100, 100 - Number(rating.ratingDeviation) / 5));
    
    return {
      rating: Number(rating.rating),
      confidence: confidence / 100 // Normalize to 0-1
    };
  }

  /**
   * Generate trading signal based on z-score and Glicko rating
   */
  private generateSignal(
    zScore: number,
    volumeScore: number,
    glickoRating: number,
    glickoConfidence: number,
    price: number,
    symbol: string,
    timestamp: Date
  ): TradingSignal | null {
    // Base signal strength from z-score
    const zScoreStrength = Math.abs(zScore);
    
    // Adjust threshold based on Glicko rating (higher rated pairs need lower threshold)
    const ratingMultiplier = Math.max(0.8, Math.min(1.2, glickoRating / 1500));
    const adjustedThreshold = this.Z_SCORE_THRESHOLD / ratingMultiplier;
    
    // Volume confirmation
    const hasVolumeConfirmation = Math.abs(volumeScore) > this.MIN_VOLUME_RATIO;
    
    // Calculate overall confidence
    const baseConfidence = Math.min(zScoreStrength / 3, 1); // Cap at z-score of 3
    const ratingBonus = (glickoRating - 1500) / 1000; // Bonus for higher rated pairs
    const volumeBonus = Math.min(Math.abs(volumeScore), 1) * 0.2; // Volume confirmation bonus
    
    const confidence = Math.max(0, Math.min(1, 
      baseConfidence + (ratingBonus * glickoConfidence) + volumeBonus
    ));

    let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let reason = 'No significant signal';

    // Determine signal direction
    if (zScoreStrength >= adjustedThreshold && hasVolumeConfirmation) {
      if (zScore > 0 && volumeScore > 0) {
        signal = 'BUY';
        reason = `Strong upward momentum (z=${zScore.toFixed(2)}, vol=${volumeScore.toFixed(2)})`;
      } else if (zScore < 0 && volumeScore < 0) {
        signal = 'SELL';
        reason = `Strong downward momentum (z=${zScore.toFixed(2)}, vol=${volumeScore.toFixed(2)})`;
      } else {
        // Mixed signals - consider Glicko rating for tiebreaker
        if (glickoRating > 1500 && zScore > 0) {
          signal = 'BUY';
          reason = `High-rated pair with upward z-score (rating=${glickoRating})`;
        } else if (glickoRating < 1500 && zScore < 0) {
          signal = 'SELL';
          reason = `Low-rated pair with downward z-score (rating=${glickoRating})`;
        }
      }
    }

    // Only return signals with sufficient confidence
    if (signal === 'HOLD' || confidence < 0.3) {
      return null;
    }

    return {
      symbol,
      timestamp,
      signal,
      zScore,
      glickoRating,
      confidence,
      priceAtSignal: price,
      volumeScore,
      reason
    };
  }

  /**
   * Process historical data for a symbol to generate signals
   */
  async generateSignalsForSymbol(
    symbol: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<TradingSignal[]> {
    console.log(`📊 Generating signals for ${symbol}...`);

    // Get Glicko rating
    const glickoData = await this.getGlickoRating(symbol);
    if (!glickoData) {
      console.warn(`⚠️ No Glicko rating found for ${symbol}`);
      return [];
    }

    // Get historical klines data
    const whereClause: any = { symbol };
    if (startDate) whereClause.openTime = { gte: startDate };
    if (endDate) whereClause.openTime = { ...whereClause.openTime, lte: endDate };

    const klines = await this.prisma.klines.findMany({
      where: whereClause,
      orderBy: { openTime: 'asc' },
      select: {
        openTime: true,
        close: true,
        volume: true,
        quoteAssetVolume: true,
        takerBuyBaseAssetVolume: true
      }
    });

    if (klines.length < this.WINDOW_SIZE + 10) {
      console.warn(`⚠️ Insufficient data for ${symbol}: ${klines.length} records`);
      return [];
    }

    // Extract price and volume data
    const prices = klines.map(k => Number(k.close));
    const volumes = klines.map(k => Number(k.volume));
    const takerBuyVolumes = klines.map(k => Number(k.takerBuyBaseAssetVolume));

    // Calculate z-scores
    const zScores = this.calculateZScores(prices);
    
    // Calculate average volume for volume scoring
    const avgVolume = volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;

    // Generate signals
    const signals: TradingSignal[] = [];
    const startIndex = this.WINDOW_SIZE;

    for (let i = 0; i < zScores.length; i++) {
      const klineIndex = startIndex + i;
      const kline = klines[klineIndex];
      
      if (!kline) continue;

      const volumeScore = this.calculateVolumeScore(
        volumes[klineIndex],
        takerBuyVolumes[klineIndex],
        avgVolume
      );

      const signal = this.generateSignal(
        zScores[i],
        volumeScore,
        glickoData.rating,
        glickoData.confidence,
        prices[klineIndex],
        symbol,
        kline.openTime
      );

      if (signal) {
        signals.push(signal);
      }
    }

    console.log(`✅ Generated ${signals.length} signals for ${symbol}`);
    return signals;
  }

  /**
   * Generate signals for all symbols
   */
  async generateAllSignals(
    startDate?: Date,
    endDate?: Date,
    symbols?: string[]
  ): Promise<{ signals: TradingSignal[]; metrics: SignalMetrics[] }> {
    console.log('🚀 Generating z-score momentum signals...');

    // Get symbols to process
    let symbolsToProcess: string[];
    if (symbols && symbols.length > 0) {
      symbolsToProcess = symbols;
    } else {
      const uniqueSymbols = await this.prisma.klines.findMany({
        select: { symbol: true },
        distinct: ['symbol']
      });
      symbolsToProcess = uniqueSymbols.map(s => s.symbol);
    }

    console.log(`📈 Processing ${symbolsToProcess.length} symbols...`);

    const allSignals: TradingSignal[] = [];
    const metrics: SignalMetrics[] = [];

    // Process each symbol
    for (const symbol of symbolsToProcess) {
      try {
        const signals = await this.generateSignalsForSymbol(symbol, startDate, endDate);
        allSignals.push(...signals);

        // Calculate metrics for this symbol
        const buySignals = signals.filter(s => s.signal === 'BUY').length;
        const sellSignals = signals.filter(s => s.signal === 'SELL').length;
        const avgZScore = signals.length > 0 
          ? signals.reduce((sum, s) => sum + Math.abs(s.zScore), 0) / signals.length 
          : 0;
        const avgConfidence = signals.length > 0
          ? signals.reduce((sum, s) => sum + s.confidence, 0) / signals.length
          : 0;

        metrics.push({
          symbol,
          signalsGenerated: signals.length,
          buySignals,
          sellSignals,
          avgZScore,
          avgConfidence
        });

      } catch (error) {
        console.error(`❌ Error processing ${symbol}:`, error);
      }
    }

    return { signals: allSignals, metrics };
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
      console.log(`  ${i + 1}. ${metric.symbol}: ${metric.signalsGenerated} signals (${metric.buySignals}B/${metric.sellSignals}S) - Avg Confidence: ${(metric.avgConfidence * 100).toFixed(1)}%`);
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