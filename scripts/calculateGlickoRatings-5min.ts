#!/usr/bin/env ts-node

/**
 * Calculate Glicko-2 Ratings Script - 5-MINUTE INTERVALS
 * 
 * CORRECTED VERSION: Generates ratings every 5 minutes based on klines data
 * This ensures proper temporal consistency and maximum data granularity.
 * 
 * Arguments: coins, startTime, endTime
 * As specified in SPEC.md Stage 3.5
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

interface KlineData {
  symbol: string;
  openTime: Date;
  closeTime: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteAssetVolume: number;
  numberOfTrades: number;
  takerBuyBaseAssetVolume: number;
  takerBuyQuoteAssetVolume: number;
  ignore: number;
}

interface HybridScore {
  score: number;
  scenario: 'HIGH_CONFIDENCE_WIN' | 'LOW_CONFIDENCE_WIN' | 'DRAW' | 'LOW_CONFIDENCE_LOSS' | 'HIGH_CONFIDENCE_LOSS';
  priceChange: number;
  volumeRatio: number;
}

interface GlickoRating {
  rating: number;      // μ (mu)
  ratingDeviation: number;  // φ (phi) - converted from internal scale
  volatility: number;   // σ (sigma)
}

interface GlickoGame {
  timestamp: Date;
  score: number;
  opponentRating: number;
  opponentRD: number;
}

interface CoinRatingState {
  currentRating: GlickoRating;
  previousRating: GlickoRating;
  gamesBuffer: GlickoGame[];
  relevantPairs: string[];
  lastProcessedTime: Date;
}

class GlickoCalculator5Min {
  private prisma: PrismaClient;
  
  // Glicko-2 system constants - OPTIMIZED FOR 5-MINUTE INTERVALS
  private readonly TAU = 0.1;          // Lower volatility constraint for frequent updates
  private readonly EPSILON = 0.000001; // Convergence tolerance
  private readonly GLICKO_SCALE = 173.7178; // Conversion factor (ln(10)/400)
  
  // Initial values
  private readonly INITIAL_RATING = 1500;
  private readonly INITIAL_RD = 100;    // Lower initial uncertainty for frequent updates
  private readonly INITIAL_VOLATILITY = 0.02; // Lower initial volatility
  
  // Opponent (benchmark) - represents stable market performance
  private readonly OPPONENT_RATING = 1500;
  private readonly OPPONENT_RD = 80;   // Benchmark uncertainty
  
  // 5-minute interval processing
  private readonly INTERVAL_MINUTES = 5;
  private readonly MIN_GAMES_PER_UPDATE = 1; // Update with any game data available
  private readonly MAX_RD_INCREASE_PER_PERIOD = 2; // Limit RD growth between periods

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
   * Calculate hybrid performance score according to GLICKO_SPEC.html
   */
  private calculateHybridScore(kline: KlineData): HybridScore {
    const { open, close, takerBuyBaseAssetVolume, volume } = kline;
    
    // Calculate price change component
    const priceChange = (close - open) / open;
    const priceChangeAbs = Math.abs(priceChange);
    
    // Calculate volume ratio component (taker buy volume ratio)
    const volumeRatio = volume > 0 ? takerBuyBaseAssetVolume / volume : 0.5;
    
    // Determine confidence level based on volume and price movement
    const confidenceThreshold = 0.02; // 2% price movement for high confidence
    const isHighConfidence = priceChangeAbs > confidenceThreshold;
    
    // Calculate raw score based on price direction and volume bias
    let rawScore: number;
    let scenario: HybridScore['scenario'];
    
    if (priceChange > 0) {
      // Price increased - bullish signal
      rawScore = 0.5 + (priceChange * 10) + (volumeRatio - 0.5) * 0.2;
      scenario = isHighConfidence ? 'HIGH_CONFIDENCE_WIN' : 'LOW_CONFIDENCE_WIN';
    } else if (priceChange < 0) {
      // Price decreased - bearish signal  
      rawScore = 0.5 + (priceChange * 10) + (volumeRatio - 0.5) * 0.2;
      scenario = isHighConfidence ? 'HIGH_CONFIDENCE_LOSS' : 'LOW_CONFIDENCE_LOSS';
    } else {
      // No price change - neutral
      rawScore = 0.5 + (volumeRatio - 0.5) * 0.1;
      scenario = 'DRAW';
    }
    
    // Normalize score to 0-1 range
    const normalizedScore = Math.max(0, Math.min(1, rawScore));
    
    return {
      score: normalizedScore,
      scenario,
      priceChange,
      volumeRatio
    };
  }

  /**
   * Convert rating from Glicko-2 scale to standard scale
   */
  private convertRatingFromGlicko2(mu: number): number {
    return mu * this.GLICKO_SCALE + this.INITIAL_RATING;
  }

  /**
   * Convert rating from standard scale to Glicko-2 scale
   */
  private convertRatingToGlicko2(rating: number): number {
    return (rating - this.INITIAL_RATING) / this.GLICKO_SCALE;
  }

  /**
   * Convert RD from standard scale to Glicko-2 scale
   */
  private convertRDToGlicko2(rd: number): number {
    return rd / this.GLICKO_SCALE;
  }

  /**
   * Convert RD from Glicko-2 scale to standard scale
   */
  private convertRDFromGlicko2(phi: number): number {
    return phi * this.GLICKO_SCALE;
  }

  /**
   * Glicko-2 g function
   */
  private g(phi: number): number {
    return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
  }

  /**
   * Glicko-2 E function (expected outcome)
   */
  private E(mu: number, muJ: number, phiJ: number): number {
    return 1 / (1 + Math.exp(-this.g(phiJ) * (mu - muJ)));
  }

  /**
   * Update Glicko-2 rating based on game results
   */
  private updateGlickoRating(currentRating: GlickoRating, games: GlickoGame[]): GlickoRating {
    if (games.length === 0) {
      // No games - increase RD due to inactivity (limited for 5-minute intervals)
      const newRD = Math.min(
        currentRating.ratingDeviation + this.MAX_RD_INCREASE_PER_PERIOD,
        this.INITIAL_RD * 2
      );
      return {
        ...currentRating,
        ratingDeviation: newRD
      };
    }

    // Convert to Glicko-2 scale
    const mu = this.convertRatingToGlicko2(currentRating.rating);
    const phi = this.convertRDToGlicko2(currentRating.ratingDeviation);
    const sigma = currentRating.volatility;

    // Calculate variance and delta
    let variance = 0;
    let delta = 0;

    for (const game of games) {
      const muJ = this.convertRatingToGlicko2(game.opponentRating);
      const phiJ = this.convertRDToGlicko2(game.opponentRD);
      
      const gPhiJ = this.g(phiJ);
      const E_outcome = this.E(mu, muJ, phiJ);
      
      variance += (gPhiJ * gPhiJ * E_outcome * (1 - E_outcome));
      delta += gPhiJ * (game.score - E_outcome);
    }

    if (variance === 0) {
      return currentRating; // No change if variance is zero
    }

    variance = 1 / variance;
    delta *= variance;

    // Calculate new volatility using iterative algorithm
    const a = Math.log(sigma * sigma);
    const deltaSquared = delta * delta;
    const phiSquared = phi * phi;
    const tauSquared = this.TAU * this.TAU;

    // Iterative calculation for new volatility
    let A = a;
    let B: number;

    if (deltaSquared > phiSquared + variance) {
      B = Math.log(deltaSquared - phiSquared - variance);
    } else {
      let k = 1;
      while (this.f(a - k * this.TAU, delta, phi, variance, a) < 0) {
        k++;
      }
      B = a - k * this.TAU;
    }

    let fA = this.f(A, delta, phi, variance, a);
    let fB = this.f(B, delta, phi, variance, a);

    // Illinois algorithm
    while (Math.abs(B - A) > this.EPSILON) {
      const C = A + (A - B) * fA / (fB - fA);
      const fC = this.f(C, delta, phi, variance, a);

      if (fC * fB < 0) {
        A = B;
        fA = fB;
      } else {
        fA /= 2;
      }

      B = C;
      fB = fC;
    }

    const newSigma = Math.exp(A / 2);

    // Calculate new rating and RD
    const phiStar = Math.sqrt(phiSquared + newSigma * newSigma);
    const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / variance);
    const newMu = mu + newPhi * newPhi * delta;

    return {
      rating: this.convertRatingFromGlicko2(newMu),
      ratingDeviation: this.convertRDFromGlicko2(newPhi),
      volatility: newSigma
    };
  }

  /**
   * Helper function for volatility calculation
   */
  private f(x: number, delta: number, phi: number, v: number, a: number): number {
    const eX = Math.exp(x);
    const phiSquared = phi * phi;
    const deltaSquared = delta * delta;
    
    const numerator1 = eX * (deltaSquared - phiSquared - v - eX);
    const denominator1 = 2 * Math.pow(phiSquared + v + eX, 2);
    
    const numerator2 = x - a;
    const denominator2 = this.TAU * this.TAU;
    
    return numerator1 / denominator1 - numerator2 / denominator2;
  }

  /**
   * Find relevant trading pairs for each coin
   */
  private async findRelevantPairs(coins: string[]): Promise<Map<string, string[]>> {
    console.log('🔍 Finding relevant trading pairs...');
    
    const coinPairs = new Map<string, string[]>();
    
    // Get all unique trading pairs from the database
    const existingPairs = await this.prisma.klines.findMany({
      select: { symbol: true },
      distinct: ['symbol']
    });
    const existingSymbols = new Set(existingPairs.map(p => p.symbol));
    
    for (const coin of coins) {
      const relevantPairs: string[] = [];
      
      // Find pairs where this coin is involved
      for (const otherCoin of coins) {
        if (otherCoin !== coin) {
          const pair1 = `${coin}${otherCoin}`;
          const pair2 = `${otherCoin}${coin}`;
          
          if (existingSymbols.has(pair1)) relevantPairs.push(pair1);
          if (existingSymbols.has(pair2)) relevantPairs.push(pair2);
        }
      }
      
      coinPairs.set(coin, relevantPairs);
      console.log(`  ${coin}: ${relevantPairs.length} pairs (${relevantPairs.join(', ')})`);
    }
    
    return coinPairs;
  }

  /**
   * Process coin performance for a specific 5-minute interval
   */
  private processCoinPerformance(coin: string, klines: KlineData[], timestamp: string): GlickoGame[] {
    const games: GlickoGame[] = [];
    
    for (const kline of klines) {
      const hybridScore = this.calculateHybridScore(kline);
      
      // Create a game against the market benchmark
      games.push({
        timestamp: new Date(timestamp),
        score: hybridScore.score,
        opponentRating: this.OPPONENT_RATING,
        opponentRD: this.OPPONENT_RD
      });
    }
    
    return games;
  }

  /**
   * Generate all 5-minute timestamps between start and end dates
   */
  private generateTimeIntervals(startTime: Date, endTime: Date): Date[] {
    const intervals: Date[] = [];
    const intervalMs = this.INTERVAL_MINUTES * 60 * 1000;
    
    // Start from the first 5-minute boundary after startTime
    let currentTime = new Date(startTime);
    currentTime.setSeconds(0, 0);
    const minutes = currentTime.getMinutes();
    const roundedMinutes = Math.ceil(minutes / this.INTERVAL_MINUTES) * this.INTERVAL_MINUTES;
    currentTime.setMinutes(roundedMinutes);
    
    while (currentTime <= endTime) {
      intervals.push(new Date(currentTime));
      currentTime = new Date(currentTime.getTime() + intervalMs);
    }
    
    return intervals;
  }

  /**
   * Process ratings for a single 5-minute interval
   */
  private async processInterval(
    intervalTime: Date, 
    coinStates: Map<string, CoinRatingState>,
    coins: string[]
  ): Promise<Array<{ coin: string; rating: GlickoRating; performanceScore: number; timestamp: Date }>> {
    
    const intervalStart = new Date(intervalTime.getTime());
    const intervalEnd = new Date(intervalTime.getTime() + this.INTERVAL_MINUTES * 60 * 1000);
    
    // Get klines data for this specific 5-minute interval
    const intervalKlines = await this.prisma.klines.findMany({
      where: {
        openTime: {
          gte: intervalStart,
          lt: intervalEnd
        }
      },
      select: {
        symbol: true,
        openTime: true,
        closeTime: true,
        open: true,
        close: true,
        volume: true,
        takerBuyBaseAssetVolume: true,
        high: true,
        low: true,
        quoteAssetVolume: true,
        numberOfTrades: true,
        takerBuyQuoteAssetVolume: true,
        ignore: true
      },
      orderBy: { openTime: 'asc' }
    });
    
    if (intervalKlines.length === 0) {
      return []; // No data for this interval
    }
    
    // Convert to KlineData format
    const klines: KlineData[] = intervalKlines.map(kline => ({
      symbol: kline.symbol,
      openTime: kline.openTime,
      closeTime: kline.closeTime,
      open: Number(kline.open),
      high: Number(kline.high || 0),
      low: Number(kline.low || 0),
      close: Number(kline.close),
      volume: Number(kline.volume),
      quoteAssetVolume: Number(kline.quoteAssetVolume || 0),
      numberOfTrades: kline.numberOfTrades || 0,
      takerBuyBaseAssetVolume: Number(kline.takerBuyBaseAssetVolume),
      takerBuyQuoteAssetVolume: Number(kline.takerBuyQuoteAssetVolume || 0),
      ignore: Number(kline.ignore || 0)
    }));
    
    const results: Array<{ coin: string; rating: GlickoRating; performanceScore: number; timestamp: Date }> = [];
    
    // Process each coin for this interval
    for (const coin of coins) {
      const coinState = coinStates.get(coin)!;
      
      // Find klines relevant to this coin
      const relevantKlines = klines.filter(kline => 
        coinState.relevantPairs.includes(kline.symbol)
      );
      
      if (relevantKlines.length > 0) {
        // Process coin performance for this interval
        const games = this.processCoinPerformance(coin, relevantKlines, intervalTime.toISOString());
        
        // Update rating immediately with available games
        if (games.length >= this.MIN_GAMES_PER_UPDATE) {
          const newRating = this.updateGlickoRating(coinState.currentRating, games);
          
          // Calculate average performance score
          const avgScore = games.reduce((sum, game) => sum + game.score, 0) / games.length;
          
          // Update state
          coinState.previousRating = { ...coinState.currentRating };
          coinState.currentRating = newRating;
          coinState.lastProcessedTime = intervalTime;
          
          // Add to results
          results.push({
            coin,
            rating: { ...newRating },
            performanceScore: avgScore * 9.99, // Scale to 0-9.99 range
            timestamp: intervalTime
          });
        }
      }
    }
    
    return results;
  }

  /**
   * Save ratings to database in batches
   */
  private async saveRatingsToDatabase(ratings: Array<{ coin: string; rating: GlickoRating; performanceScore: number; timestamp: Date }>): Promise<void> {
    if (ratings.length === 0) return;
    
    const dbRecords = ratings.map(r => ({
      symbol: r.coin,
      timestamp: r.timestamp,
      rating: r.rating.rating,
      ratingDeviation: r.rating.ratingDeviation,
      volatility: r.rating.volatility,
      performanceScore: r.performanceScore
    }));
    
    try {
      await this.prisma.glickoRatings.createMany({
        data: dbRecords,
        skipDuplicates: true
      });
    } catch (error) {
      console.error('❌ Error saving ratings batch:', error);
      throw error;
    }
  }

  /**
   * Main calculation function - processes every 5 minutes
   */
  async calculateAllRatings(
    coins: string[],
    startTime: Date,
    endTime: Date
  ): Promise<void> {
    console.log('🚀 Starting 5-minute Glicko-2 rating calculations...');
    console.log('✅ Processing EVERY 5 MINUTES (real-time intervals)');
    console.log(`📊 Coins: ${coins.join(', ')}`);
    console.log(`📅 Date range: ${startTime.toISOString()} to ${endTime.toISOString()}`);
    
    // Find relevant pairs for each coin
    const coinPairs = await this.findRelevantPairs(coins);
    
    // Initialize rating states for all coins
    const coinStates = new Map<string, CoinRatingState>();
    for (const coin of coins) {
      coinStates.set(coin, {
        currentRating: {
          rating: this.INITIAL_RATING,
          ratingDeviation: this.INITIAL_RD,
          volatility: this.INITIAL_VOLATILITY
        },
        previousRating: {
          rating: this.INITIAL_RATING,
          ratingDeviation: this.INITIAL_RD,
          volatility: this.INITIAL_VOLATILITY
        },
        gamesBuffer: [],
        relevantPairs: coinPairs.get(coin) || [],
        lastProcessedTime: startTime
      });
    }
    
    // Generate all 5-minute intervals
    const timeIntervals = this.generateTimeIntervals(startTime, endTime);
    console.log(`⏰ Processing ${timeIntervals.length.toLocaleString()} five-minute intervals`);
    
    // Process intervals in batches to manage memory
    const BATCH_SIZE = 288; // One day worth of 5-minute intervals
    let processedIntervals = 0;
    let totalRatings = 0;
    
    for (let i = 0; i < timeIntervals.length; i += BATCH_SIZE) {
      const batchEnd = Math.min(i + BATCH_SIZE, timeIntervals.length);
      const batchIntervals = timeIntervals.slice(i, batchEnd);
      
      console.log(`\n📊 Processing interval batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(timeIntervals.length/BATCH_SIZE)}`);
      console.log(`   Time range: ${batchIntervals[0].toISOString()} to ${batchIntervals[batchIntervals.length-1].toISOString()}`);
      
      const batchRatings: Array<{ coin: string; rating: GlickoRating; performanceScore: number; timestamp: Date }> = [];
      
      // Process each interval in the batch
      for (const intervalTime of batchIntervals) {
        const intervalRatings = await this.processInterval(intervalTime, coinStates, coins);
        batchRatings.push(...intervalRatings);
        processedIntervals++;
        
        // Progress reporting
        if (processedIntervals % 1000 === 0) {
          const progress = (processedIntervals / timeIntervals.length * 100).toFixed(2);
          console.log(`   ⏳ Progress: ${progress}% (${processedIntervals.toLocaleString()}/${timeIntervals.length.toLocaleString()} intervals)`);
        }
      }
      
      // Save batch to database
      if (batchRatings.length > 0) {
        console.log(`   💾 Saving ${batchRatings.length} ratings to database...`);
        await this.saveRatingsToDatabase(batchRatings);
        totalRatings += batchRatings.length;
        console.log(`   ✅ Saved batch. Total ratings saved: ${totalRatings.toLocaleString()}`);
      }
    }
    
    console.log(`\n🎉 5-minute Glicko-2 calculation completed!`);
    console.log(`   📊 Total intervals processed: ${processedIntervals.toLocaleString()}`);
    console.log(`   💾 Total ratings generated: ${totalRatings.toLocaleString()}`);
    console.log(`   ⚡ Average ratings per interval: ${(totalRatings / processedIntervals).toFixed(2)}`);
    
    // Final rating summary
    console.log(`\n🎯 Final Ratings Summary:`);
    for (const coin of coins) {
      const state = coinStates.get(coin)!;
      const rating = state.currentRating;
      console.log(`  ${coin}: Rating=${rating.rating.toFixed(0)}, RD=${rating.ratingDeviation.toFixed(0)}, Vol=${rating.volatility.toFixed(4)}`);
    }
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
    console.log('🧹 Database connection closed');
  }
}

/**
 * Main execution function
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length !== 3) {
    console.error('Usage: npx ts-node calculateGlickoRatings-5min.ts "COIN1,COIN2,..." "YYYY-MM-DD" "YYYY-MM-DD"');
    process.exit(1);
  }

  const [coinsArg, startTimeArg, endTimeArg] = args;
  
  try {
    // Parse arguments
    const coins = coinsArg.split(',').map(coin => coin.trim());
    const startTime = new Date(`${startTimeArg}T00:00:00.000Z`);
    const endTime = new Date(`${endTimeArg}T00:00:00.000Z`);
    
    console.log('🎯 Starting 5-MINUTE Glicko-2 rating calculation script...');
    console.log('🔧 REAL-TIME: Processing every 5 minutes with immediate updates');
    console.log('=' .repeat(70));
    
    const calculator = new GlickoCalculator5Min();
    await calculator.initialize();
    
    console.log(`📋 Configuration:`);
    console.log(`  - Coins: ${coins.join(', ')}`);
    console.log(`  - Start time: ${startTime.toISOString()}`);
    console.log(`  - End time: ${endTime.toISOString()}`);
    console.log(`  - Interval: 5 minutes`);
    console.log(`  - Real-time processing: ✅ ENABLED`);
    
    await calculator.calculateAllRatings(coins, startTime, endTime);
    await calculator.cleanup();
    
  } catch (error) {
    console.error('💥 Script failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { GlickoCalculator5Min };