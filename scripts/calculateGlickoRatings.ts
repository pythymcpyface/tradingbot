#!/usr/bin/env ts-node

/**
 * Calculate Glicko-2 Ratings Script (ALIGNED WITH LIVE TRADING ENGINE)
 * 
 * This script calculates Glicko ratings using the EXACT same logic as the Live Trading Engine.
 * It processes 5-minute klines sequentially and updates the rating after every candle.
 * 
 * Key Differences from Spec (but matching Live Engine):
 * - Uses 5-minute intervals (not 1-hour).
 * - Uses Dynamic Opponent based on Volatility and Volume.
 * - Uses Simplified Glicko Update logic (no Illinois algorithm).
 * - Uses simplified Game Result scaling based on Price Change.
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

interface GlickoRating {
  rating: number;      // μ (mu)
  ratingDeviation: number;  // φ (phi)
  volatility: number;   // σ (sigma)
}

class GlickoCalculator {
  private prisma: PrismaClient;
  
  // Constants matching TradingEngine.ts
  private readonly INITIAL_RATING = 1500;
  private readonly INITIAL_RD = 350;
  private readonly INITIAL_VOLATILITY = 0.06;
  private readonly TAU = 0.5; 
  private readonly GLICKO_SCALE = 173.7178;

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
   * Calculate price volatility from kline data
   * Matches TradingEngine.ts implementation
   */
  private calculateVolatility(klines: any[]): number {
    if (klines.length < 2) return 0.1; // Default volatility
    
    const returns = [];
    for (let i = 1; i < klines.length; i++) {
      const prevPrice = Number(klines[i - 1].close);
      const currPrice = Number(klines[i].close);
      const logReturn = Math.log(currPrice / prevPrice);
      returns.push(logReturn);
    }
    
    // Calculate standard deviation of returns
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    return Math.sqrt(variance);
  }

  /**
   * Simplified Glicko-2 rating update
   * Matches TradingEngine.ts implementation exactly
   */
  private updateGlickoRating(
    rating: number,
    ratingDeviation: number,
    volatility: number,
    opponentRating: number,
    opponentRatingDeviation: number,
    gameResult: number,
    tau: number
  ): { rating: number; ratingDeviation: number; volatility: number } {
    // Convert to Glicko-2 scale
    const mu = (rating - 1500) / this.GLICKO_SCALE;
    const phi = ratingDeviation / this.GLICKO_SCALE;
    const sigma = volatility;
    const muOpponent = (opponentRating - 1500) / this.GLICKO_SCALE;
    const phiOpponent = opponentRatingDeviation / this.GLICKO_SCALE;
    
    // Calculate g(phi) function
    const g = (phi: number) => 1 / Math.sqrt(1 + 3 * phi * phi / (Math.PI * Math.PI));
    
    // Calculate E function (expected score)
    const E = (mu: number, muOpponent: number, phiOpponent: number) => 
      1 / (1 + Math.exp(-g(phiOpponent) * (mu - muOpponent)));
    
    const gPhi = g(phiOpponent);
    const expectedScore = E(mu, muOpponent, phiOpponent);
    const variance = 1 / (gPhi * gPhi * expectedScore * (1 - expectedScore));
    
    // Simplified volatility update (skip iterative calculation for performance)
    const delta = variance * gPhi * (gameResult - expectedScore);
    const newSigma = Math.sqrt(sigma * sigma + delta * delta / variance);
    
    // Update rating deviation
    const newPhiSquared = 1 / (1 / (phi * phi + newSigma * newSigma) + 1 / variance);
    const newPhi = Math.sqrt(newPhiSquared);
    
    // Update rating
    const newMu = mu + newPhiSquared * gPhi * (gameResult - expectedScore);
    
    // Convert back to Glicko scale
    return {
      rating: newMu * this.GLICKO_SCALE + 1500,
      ratingDeviation: newPhi * this.GLICKO_SCALE,
      volatility: Math.min(0.2, Math.max(0.01, newSigma)) // Bound volatility matches TradingEngine
    };
  }

  /**
   * Calculate Glicko-2 ratings for a specific coin
   */
  async calculateRatingsForCoin(
    coin: string,
    startTime: Date,
    endTime: Date
  ): Promise<Array<{ timestamp: Date; rating: GlickoRating; performanceScore: number }>> {
    const symbol = `${coin}USDT`; // Assume USDT pairs for now, matching Live Trading
    console.log(`📊 Calculating Glicko-2 ratings for ${symbol} (5m intervals)...`);

    // Fetch 5-minute klines
    // Note: We fetch from 'klines' table. We assume the data there IS 5-minute data 
    // because getKlines.ts downloads into this table. 
    // If the table contains mixed intervals, this script will process them sequentially 
    // as if they were a continuous stream, which matches TradingEngine behavior 
    // (which just takes the latest stream of candles).
    // Ideally, we should filter by interval if the schema supported it, but it doesn't seem to.
    
    const klines = await this.prisma.klines.findMany({
      where: {
        symbol: symbol,
        openTime: {
          gte: startTime,
          lte: endTime
        }
      },
      orderBy: { openTime: 'asc' }
    });

    if (klines.length === 0) {
      console.warn(`⚠️ No klines found for ${symbol}`);
      return [];
    }

    console.log(`  Found ${klines.length} klines for ${symbol}`);

    // Initialize rating
    let currentRating = this.INITIAL_RATING;
    let currentRatingDeviation = this.INITIAL_RD;
    let currentVolatility = this.INITIAL_VOLATILITY;

    const results: Array<{ timestamp: Date; rating: GlickoRating; performanceScore: number }> = [];

    // Process sequentially
    for (let i = 1; i < klines.length; i++) {
      const prevKline = klines[i - 1];
      const currKline = klines[i];
      
      // Calculate price performance
      const prevClose = Number(prevKline.close);
      const currClose = Number(currKline.close);
      const prevVolume = Number(prevKline.volume);
      const currVolume = Number(currKline.volume);

      const priceChange = (currClose - prevClose) / prevClose;
      const volumeRatio = currVolume / (prevVolume || 1);
      
      // Convert price performance to game result (Simplified Logic)
      let gameResult: number;
      if (Math.abs(priceChange) < 0.001) { 
        gameResult = 0.5;
      } else if (priceChange > 0) { 
        gameResult = Math.min(1.0, 0.5 + priceChange * 50); 
      } else { 
        gameResult = Math.max(0.0, 0.5 + priceChange * 50); 
      }
      
      // Calculate Dynamic Opponent Rating
      const volatilityWindow = klines.slice(Math.max(0, i - 10), i + 1);
      const marketVolatility = this.calculateVolatility(volatilityWindow);
      
      const opponentRating = this.INITIAL_RATING + (marketVolatility * 1000) + (Math.log(volumeRatio) * 100);
      const opponentRatingDeviation = this.INITIAL_RD;
      
      // Update Glicko Rating
      const updated = this.updateGlickoRating(
        currentRating,
        currentRatingDeviation,
        currentVolatility,
        opponentRating,
        opponentRatingDeviation,
        gameResult,
        this.TAU
      );
      
      currentRating = updated.rating;
      currentRatingDeviation = updated.ratingDeviation;
      currentVolatility = updated.volatility;
      
      results.push({
        timestamp: currKline.openTime, // Use openTime or closeTime? TradingEngine uses openTime (line 1007)
        rating: {
          rating: currentRating,
          ratingDeviation: currentRatingDeviation,
          volatility: currentVolatility
        },
        performanceScore: gameResult // Save game result as performance score
      });
    }

    console.log(`  ✅ Calculated ${results.length} ratings for ${symbol}`);
    console.log(`  Final Rating: ${currentRating.toFixed(0)}`);
    
    return results;
  }

  /**
   * Save Glicko-2 ratings to database
   */
  async saveRatings(
    coin: string,
    ratings: Array<{ timestamp: Date; rating: GlickoRating; performanceScore: number }>
  ): Promise<void> {
    console.log(`💾 Saving ${ratings.length} ratings for ${coin}...`);
    const BATCH_SIZE = 5000;

    try {
      // Delete existing ratings for this coin in this time range
      await this.prisma.glickoRatings.deleteMany({
        where: {
          symbol: coin, // Store as base asset (e.g., BTC) to match schema expectations or symbol? 
                        // Live engine uses 'BTC' in GlickoRatings table usually, let's check.
                        // TradingEngine.ts Line 864: ratings.push({ symbol: baseAsset ... })
                        // So we should save as 'BTC', not 'BTCUSDT'.
          timestamp: {
            gte: ratings[0].timestamp,
            lte: ratings[ratings.length - 1].timestamp
          }
        }
      });

      // Insert in batches
      for (let i = 0; i < ratings.length; i += BATCH_SIZE) {
        const batch = ratings.slice(i, i + BATCH_SIZE);
        const data = batch.map(r => ({
          symbol: coin,
          timestamp: r.timestamp,
          rating: r.rating.rating,
          ratingDeviation: r.rating.ratingDeviation,
          volatility: r.rating.volatility,
          performanceScore: r.performanceScore
        }));

        await this.prisma.glickoRatings.createMany({
          data: data,
          skipDuplicates: true
        });
      }

      console.log(`  ✅ Saved ratings for ${coin}`);

    } catch (error) {
      console.error(`❌ Error saving ratings for ${coin}:`, error);
      throw error;
    }
  }

  /**
   * Process all coins
   */
  async calculateAllRatings(
    coins: string[],
    startTime: Date,
    endTime: Date
  ): Promise<void> {
    console.log('🚀 Starting Glicko-2 rating calculations...');
    console.log(`📊 Coins: ${coins.join(', ')}`);

    for (const coin of coins) {
      try {
        const ratings = await this.calculateRatingsForCoin(coin, startTime, endTime);
        if (ratings.length > 0) {
          await this.saveRatings(coin, ratings);
        }
      } catch (error) {
        console.error(`❌ Failed to process ${coin}:`, error);
      }
    }
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
    console.log('\n🧹 Database connection closed');
  }
}

/**
 * Parse command line arguments
 */
function parseArguments(): {
  coins: string[];
  startTime: Date;
  endTime: Date;
} {
  // Simplified argument parsing for brevity/robustness
  // Assumes defaults or ENV if args missing
  
  const baseCoinsEnv = process.env.BASE_COINS || 'BTC,ETH,ADA,AVAX,BNB,DOGE,LINK,POL,SOL,TRX,XLM,XRP';
  const coins = baseCoinsEnv.split(',').map(c => c.trim().replace('USDT', '')); // Strip USDT if present

  // Default to last 30 days if not specified
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);

  return { coins, startTime: start, endTime: end };
}

// Main execution
async function main() {
  const calculator = new GlickoCalculator();
  try {
    await calculator.initialize();
    const { coins, startTime, endTime } = parseArguments();
    
    // Allow override via CLI args if provided
    // Usage: ts-node calculateGlickoRatings.ts [days]
    const args = process.argv.slice(2);
    if (args[0]) {
        const days = parseInt(args[0]);
        if (!isNaN(days)) {
            startTime.setTime(endTime.getTime() - (days * 24 * 60 * 60 * 1000));
        }
    }

    await calculator.calculateAllRatings(coins, startTime, endTime);
  } catch (error) {
    console.error(error);
    process.exit(1);
  } finally {
    await calculator.cleanup();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { GlickoCalculator };