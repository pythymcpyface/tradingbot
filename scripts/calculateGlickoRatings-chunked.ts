#!/usr/bin/env ts-node

/**
 * Calculate Glicko-2 Ratings Script - CHUNKED VERSION
 * 
 * This version processes large datasets by chunking time periods to avoid memory issues.
 * Maintains the corrected chronological processing order.
 * 
 * Arguments: coins, startTime, endTime
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
  gamesBatch: GlickoGame[];
  relevantPairs: string[];
}

class GlickoCalculatorChunked {
  private prisma: PrismaClient;
  
  // Glicko-2 system constants - ADJUSTED FOR CRYPTO STABILITY
  private readonly TAU = 0.2;          // Reduced volatility constraint for stability  
  private readonly EPSILON = 0.000001; // Convergence tolerance
  private readonly GLICKO_SCALE = 173.7178; // Conversion factor (ln(10)/400)
  
  // Initial values
  private readonly INITIAL_RATING = 1500;
  private readonly INITIAL_RD = 200;    // Reduced initial uncertainty
  private readonly INITIAL_VOLATILITY = 0.03; // Much lower initial volatility
  
  // Opponent (benchmark) - represents stable market performance
  private readonly OPPONENT_RATING = 1500;
  private readonly OPPONENT_RD = 100;   // Increased benchmark uncertainty

  // Rating update frequency (process every N time intervals for stability)
  private readonly BATCH_SIZE = 168; // Process ratings every 7 days (168 hours)
  
  // Chunking parameters for large datasets
  private readonly CHUNK_DAYS = 30; // Process 30 days at a time
  private readonly MAX_PAIRS_PER_CHUNK = 10; // Max pairs to process simultaneously

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
    
    // Validate input data
    if (!open || !close || open <= 0 || close <= 0) {
      return {
        score: 0.5,
        scenario: 'DRAW',
        priceChange: 0,
        volumeRatio: 0.5
      };
    }
    
    if (volume < 0 || takerBuyBaseAssetVolume < 0 || takerBuyBaseAssetVolume > volume) {
      return {
        score: 0.5,
        scenario: 'DRAW',
        priceChange: (close - open) / open,
        volumeRatio: 0.5
      };
    }
    
    // Calculate price change
    const priceChange = (close - open) / open;
    const isPriceUp = close > open;
    const isPriceDown = close < open;
    const isPriceUnchanged = Math.abs(priceChange) < 0.0001;
    
    // Calculate volume ratio (taker buy vs total volume)
    const takerBuyRatio = volume > 0 ? takerBuyBaseAssetVolume / volume : 0.5;
    const takerSellRatio = 1 - takerBuyRatio;
    const isBuyDominant = takerBuyRatio > takerSellRatio;
    
    let score: number;
    let scenario: HybridScore['scenario'];
    
    if (isPriceUnchanged) {
      score = 0.5; // Draw
      scenario = 'DRAW';
    } else if (isPriceUp) {
      if (isBuyDominant) {
        score = 1.0; // High-confidence win
        scenario = 'HIGH_CONFIDENCE_WIN';
      } else {
        score = 0.75; // Low-confidence win
        scenario = 'LOW_CONFIDENCE_WIN';
      }
    } else if (isPriceDown) {
      if (isBuyDominant) {
        score = 0.25; // Low-confidence loss
        scenario = 'LOW_CONFIDENCE_LOSS';
      } else {
        score = 0.0; // High-confidence loss
        scenario = 'HIGH_CONFIDENCE_LOSS';
      }
    } else {
      score = 0.5; // Fallback to draw
      scenario = 'DRAW';
    }
    
    return {
      score,
      scenario,
      priceChange,
      volumeRatio: takerBuyRatio
    };
  }

  /**
   * Convert Glicko-2 rating to internal scale
   */
  private toGlicko2Scale(rating: number, rd: number): { mu: number; phi: number } {
    const mu = (rating - this.INITIAL_RATING) / this.GLICKO_SCALE;
    const phi = rd / this.GLICKO_SCALE;
    return { mu, phi };
  }

  /**
   * Convert from Glicko-2 internal scale to standard scale
   */
  private fromGlicko2Scale(mu: number, phi: number): { rating: number; rd: number } {
    const rating = mu * this.GLICKO_SCALE + this.INITIAL_RATING;
    const rd = phi * this.GLICKO_SCALE;
    return { rating, rd };
  }

  /**
   * Calculate g(φ) function
   */
  private g(phi: number): number {
    return 1 / Math.sqrt(1 + 3 * Math.pow(phi, 2) / Math.pow(Math.PI, 2));
  }

  /**
   * Calculate E(μ, μⱼ, φⱼ) function (expected score)
   */
  private E(mu: number, muJ: number, phiJ: number): number {
    return 1 / (1 + Math.exp(-this.g(phiJ) * (mu - muJ)));
  }

  /**
   * Update Glicko-2 rating based on game results
   */
  private updateGlickoRating(
    currentRating: GlickoRating,
    games: GlickoGame[]
  ): GlickoRating {
    if (games.length === 0) {
      // No games played - increase RD due to inactivity
      const newRD = Math.min(
        Math.sqrt(Math.pow(currentRating.ratingDeviation, 2) + Math.pow(currentRating.volatility, 2)),
        this.INITIAL_RD
      );
      
      return {
        rating: currentRating.rating,
        ratingDeviation: newRD,
        volatility: currentRating.volatility
      };
    }

    // Convert to Glicko-2 scale
    const { mu, phi } = this.toGlicko2Scale(currentRating.rating, currentRating.ratingDeviation);
    const sigma = currentRating.volatility;

    // Convert opponent ratings to Glicko-2 scale
    const opponents = games.map(game => {
      const { mu: muJ, phi: phiJ } = this.toGlicko2Scale(game.opponentRating, game.opponentRD);
      return { mu: muJ, phi: phiJ, score: game.score };
    });

    // Step 2: Calculate v (estimated variance)
    let v = 0;
    for (const opp of opponents) {
      const gPhi = this.g(opp.phi);
      const expectedScore = this.E(mu, opp.mu, opp.phi);
      v += Math.pow(gPhi, 2) * expectedScore * (1 - expectedScore);
    }
    v = 1 / v;

    // Step 3: Calculate Δ (improvement in rating)
    let delta = 0;
    for (const opp of opponents) {
      const gPhi = this.g(opp.phi);
      const expectedScore = this.E(mu, opp.mu, opp.phi);
      delta += gPhi * (opp.score - expectedScore);
    }
    delta = v * delta;

    // Step 4: Calculate new volatility σ' - WITH STABILITY CHECKS
    const a = Math.log(Math.pow(Math.max(sigma, 0.001), 2)); // Ensure positive sigma
    
    const f = (x: number): number => {
      const ex = Math.exp(Math.max(-10, Math.min(10, x))); // Clamp exponential
      const delta2 = Math.pow(delta, 2);
      const phi2 = Math.pow(phi, 2);
      
      const num1 = ex * (delta2 - phi2 - v - ex);
      const den1 = 2 * Math.pow(phi2 + v + ex, 2);
      const num2 = x - a;
      const den2 = Math.pow(this.TAU, 2);
      
      // Check for numerical stability
      if (!isFinite(den1) || den1 === 0 || !isFinite(den2) || den2 === 0) {
        return 0;
      }
      
      return num1 / den1 - num2 / den2;
    };

    let A = a;
    let B: number;
    const delta2 = Math.pow(delta, 2);
    const phi2 = Math.pow(phi, 2);
    
    if (delta2 > phi2 + v) {
      const logArg = Math.max(0.000001, delta2 - phi2 - v);
      B = Math.log(logArg);
    } else {
      let k = 1;
      let attempts = 0;
      while (f(a - k * this.TAU) < 0 && attempts < 100) { // Prevent infinite loop
        k++;
        attempts++;
      }
      B = a - k * this.TAU;
    }

    let fA = f(A);
    let fB = f(B);
    let iterations = 0;

    // Illinois algorithm for finding root - WITH ITERATION LIMIT
    while (Math.abs(B - A) > this.EPSILON && iterations < 100) {
      const C = A + (A - B) * fA / (fA - fB);
      const fC = f(C);
      
      if (fC * fB < 0) {
        A = B;
        fA = fB;
      } else {
        fA = fA / 2;
      }
      
      B = C;
      fB = fC;
      iterations++;
    }

    const newSigma = Math.min(1.0, Math.max(0.001, Math.exp(A / 2))); // Clamp sigma to reasonable range

    // Step 5: Update rating deviation
    const phiStar = Math.sqrt(Math.pow(phi, 2) + Math.pow(newSigma, 2));

    // Step 6: Update rating and RD
    const newPhi = 1 / Math.sqrt(1 / Math.pow(phiStar, 2) + 1 / v);
    
    let newMu = mu;
    for (const opp of opponents) {
      const gPhi = this.g(opp.phi);
      const expectedScore = this.E(mu, opp.mu, opp.phi);
      newMu += Math.pow(newPhi, 2) * gPhi * (opp.score - expectedScore);
    }

    // Convert back to standard scale
    const { rating: newRating, rd: newRD } = this.fromGlicko2Scale(newMu, newPhi);

    // Validate results and prevent extreme values - STRICTER BOUNDS
    const validatedRating = Math.max(800, Math.min(2200, isNaN(newRating) ? this.INITIAL_RATING : newRating));
    const validatedRD = Math.max(50, Math.min(350, isNaN(newRD) ? this.INITIAL_RD : newRD));
    const validatedVolatility = Math.max(0.001, Math.min(0.5, isNaN(newSigma) ? this.INITIAL_VOLATILITY : newSigma));

    return {
      rating: validatedRating,
      ratingDeviation: validatedRD,
      volatility: validatedVolatility
    };
  }

  /**
   * Get all relevant trading pairs for the given coins
   */
  private async findRelevantPairs(coins: string[]): Promise<Map<string, string[]>> {
    console.log('🔍 Finding relevant trading pairs...');
    
    const coinPairs = new Map<string, string[]>();
    
    for (const coin of coins) {
      const relevantPairs: string[] = [];
      
      for (const otherCoin of coins) {
        if (otherCoin !== coin) {
          // Check if COIN/OTHERCOIN pair exists
          const pair1 = `${coin}${otherCoin}`;
          const pair2 = `${otherCoin}${coin}`;
          
          // Check which pairs actually exist in the database
          const pair1Exists = await this.prisma.klines.findFirst({
            where: { symbol: pair1 },
            select: { id: true }
          });
          
          const pair2Exists = await this.prisma.klines.findFirst({
            where: { symbol: pair2 },
            select: { id: true }
          });
          
          if (pair1Exists) relevantPairs.push(pair1);
          if (pair2Exists) relevantPairs.push(pair2);
        }
      }
      
      coinPairs.set(coin, relevantPairs);
      console.log(`  ${coin}: ${relevantPairs.length} pairs (${relevantPairs.join(', ')})`);
    }
    
    return coinPairs;
  }

  /**
   * Process performance for a single coin at a specific timestamp
   */
  private processCoinPerformance(
    coin: string,
    klines: KlineData[],
    timestamp: string
  ): GlickoGame[] {
    const games: GlickoGame[] = [];
    
    for (const kline of klines) {
      // Determine this coin's role in the trading pair
      const symbol = kline.symbol;
      const isBaseCoin = symbol.startsWith(coin);
      
      let klineData = { ...kline };
      
      // If this coin is the quote asset, we need to invert the performance
      if (!isBaseCoin) {
        // For quote asset, price up means the coin performed worse (it took more of this coin to buy the base)
        // So we invert the open/close and taker volumes
        const originalOpen = klineData.open;
        const originalClose = klineData.close;
        
        // Invert price (1/price)
        klineData.open = 1 / originalClose;
        klineData.close = 1 / originalOpen;
        
        // Swap taker buy/sell volumes (buy base = sell quote)
        const originalTakerBuy = klineData.takerBuyBaseAssetVolume;
        klineData.takerBuyBaseAssetVolume = klineData.volume - originalTakerBuy; // Taker sell base = taker buy quote for our coin
      }
      
      const hybridScore = this.calculateHybridScore(klineData);
      
      // Add game to current batch
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
   * Process a chunk of data (time period + pairs) chronologically
   */
  private async processChunk(
    coins: string[],
    coinStates: Map<string, CoinRatingState>,
    pairs: string[],
    startTime: Date,
    endTime: Date
  ): Promise<Array<{ coin: string; timestamp: Date; rating: GlickoRating; performanceScore: number }>> {
    // Get klines for this chunk
    const chunkKlines = await this.prisma.klines.findMany({
      where: {
        symbol: { in: pairs },
        openTime: {
          gte: startTime,
          lte: endTime
        }
      },
      orderBy: { openTime: 'asc' }
    });

    if (chunkKlines.length === 0) {
      return [];
    }

    // Group klines by timestamp
    const klinesByTimestamp = new Map<string, KlineData[]>();
    
    for (const kline of chunkKlines) {
      // Convert Decimal fields to numbers
      const klineData: KlineData = {
        ...kline,
        open: Number(kline.open),
        high: Number(kline.high),
        low: Number(kline.low),
        close: Number(kline.close),
        volume: Number(kline.volume),
        quoteAssetVolume: Number(kline.quoteAssetVolume),
        takerBuyBaseAssetVolume: Number(kline.takerBuyBaseAssetVolume),
        takerBuyQuoteAssetVolume: Number(kline.takerBuyQuoteAssetVolume),
        ignore: Number(kline.ignore)
      };
      
      const timestamp = kline.openTime.toISOString();
      if (!klinesByTimestamp.has(timestamp)) {
        klinesByTimestamp.set(timestamp, []);
      }
      klinesByTimestamp.get(timestamp)!.push(klineData);
    }

    const timestamps = Array.from(klinesByTimestamp.keys()).sort();
    const results: Array<{ coin: string; timestamp: Date; rating: GlickoRating; performanceScore: number }> = [];
    
    let batchCounter = 0;

    // Process chronologically by timestamp
    for (let i = 0; i < timestamps.length; i++) {
      const timestamp = timestamps[i];
      const timestampKlines = klinesByTimestamp.get(timestamp)!;
      
      // Process ALL COINS for this timestamp simultaneously
      for (const coin of coins) {
        const coinState = coinStates.get(coin);
        if (!coinState) continue;
        
        // Find klines relevant to this coin at this timestamp
        const relevantKlines = timestampKlines.filter(kline => 
          coinState.relevantPairs.includes(kline.symbol)
        );
        
        if (relevantKlines.length > 0) {
          const games = this.processCoinPerformance(coin, relevantKlines, timestamp);
          coinState.gamesBatch.push(...games);
        }
      }
      
      batchCounter++;

      // Update ratings every BATCH_SIZE timestamps or at the end
      if (batchCounter >= this.BATCH_SIZE || i === timestamps.length - 1) {
        // Update ratings for ALL coins simultaneously
        for (const coin of coins) {
          const coinState = coinStates.get(coin);
          if (!coinState) continue;
          
          if (coinState.gamesBatch.length > 0) {
            coinState.currentRating = this.updateGlickoRating(coinState.currentRating, coinState.gamesBatch);
            
            // Calculate average performance score for this batch
            const avgPerformanceScore = coinState.gamesBatch.reduce((sum, game) => sum + game.score, 0) / coinState.gamesBatch.length;
            
            // Store result
            results.push({
              coin,
              timestamp: new Date(timestamp),
              rating: { ...coinState.currentRating },
              performanceScore: avgPerformanceScore * 9.99 // Scale to 0-9.99 range
            });
            
            // Reset batch for next period
            coinState.gamesBatch = [];
          }
        }
        
        batchCounter = 0; // Reset batch counter
      }
    }

    return results;
  }

  /**
   * CHUNKED: Process all coins and calculate their Glicko-2 ratings in manageable chunks
   */
  async calculateAllRatings(
    coins: string[],
    startTime: Date,
    endTime: Date
  ): Promise<void> {
    console.log('🚀 Starting CHUNKED Glicko-2 rating calculations...');
    console.log('✅ Processing BY TIME INTERVAL (chronologically) - CHUNKED VERSION');
    console.log(`📊 Coins: ${coins.join(', ')}`);
    console.log(`📅 Date range: ${startTime.toISOString()} to ${endTime.toISOString()}`);

    // Step 1: Find all relevant trading pairs for each coin
    const coinPairs = await this.findRelevantPairs(coins);

    // Step 2: Initialize rating states for all coins
    const coinStates = new Map<string, CoinRatingState>();
    
    for (const coin of coins) {
      coinStates.set(coin, {
        currentRating: {
          rating: this.INITIAL_RATING,
          ratingDeviation: this.INITIAL_RD,
          volatility: this.INITIAL_VOLATILITY
        },
        gamesBatch: [],
        relevantPairs: coinPairs.get(coin) || []
      });
    }

    // Step 3: Get all unique pairs and chunk them
    const allPairs = Array.from(coinPairs.values()).flat();
    const uniquePairs = [...new Set(allPairs)];
    
    console.log(`📊 Processing ${uniquePairs.length} unique trading pairs in chunks...`);

    // Step 4: Create time chunks
    const totalDays = Math.ceil((endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24));
    const timeChunks: Array<{ start: Date; end: Date }> = [];
    
    let currentStart = new Date(startTime);
    while (currentStart < endTime) {
      const chunkEnd = new Date(currentStart.getTime() + (this.CHUNK_DAYS * 24 * 60 * 60 * 1000));
      const actualEnd = chunkEnd > endTime ? endTime : chunkEnd;
      
      timeChunks.push({
        start: new Date(currentStart),
        end: actualEnd
      });
      
      currentStart = new Date(actualEnd.getTime() + 1);
    }

    console.log(`📅 Processing ${timeChunks.length} time chunks of ~${this.CHUNK_DAYS} days each`);

    // Step 5: Process each time chunk
    const allResults: Array<{ coin: string; timestamp: Date; rating: GlickoRating; performanceScore: number }> = [];
    
    for (let chunkIndex = 0; chunkIndex < timeChunks.length; chunkIndex++) {
      const chunk = timeChunks[chunkIndex];
      
      console.log(`\n🔄 Processing chunk ${chunkIndex + 1}/${timeChunks.length}: ${chunk.start.toISOString().split('T')[0]} to ${chunk.end.toISOString().split('T')[0]}`);
      
      try {
        const chunkResults = await this.processChunk(coins, coinStates, uniquePairs, chunk.start, chunk.end);
        allResults.push(...chunkResults);
        
        console.log(`  ✅ Chunk ${chunkIndex + 1} completed: ${chunkResults.length} ratings calculated`);
        
      } catch (error) {
        console.error(`  ❌ Error processing chunk ${chunkIndex + 1}:`, error);
        // Continue with next chunk
      }
    }

    // Step 6: Save all results to database
    console.log('\n💾 Saving results to database...');
    
    // Group results by coin
    const resultsByCoin = new Map<string, Array<{ timestamp: Date; rating: GlickoRating; performanceScore: number }>>();
    
    for (const result of allResults) {
      if (!resultsByCoin.has(result.coin)) {
        resultsByCoin.set(result.coin, []);
      }
      resultsByCoin.get(result.coin)!.push({
        timestamp: result.timestamp,
        rating: result.rating,
        performanceScore: result.performanceScore
      });
    }
    
    for (const [coin, coinResults] of resultsByCoin) {
      if (coinResults.length > 0) {
        await this.saveRatings(coin, coinResults);
        console.log(`  ✅ Saved ${coinResults.length} ratings for ${coin}`);
      }
    }

    // Display final summary
    console.log('\n📊 Calculation Summary:');
    for (const coin of coins) {
      const coinResults = resultsByCoin.get(coin) || [];
      console.log(`  - ${coin}: ${coinResults.length} rating periods`);
    }

    await this.displayFinalSummary(coins);
  }

  /**
   * Save Glicko-2 ratings to database
   */
  async saveRatings(
    coin: string,
    ratings: Array<{ timestamp: Date; rating: GlickoRating; performanceScore: number }>
  ): Promise<void> {
    const ratingData = ratings.map(r => ({
      symbol: coin,
      timestamp: r.timestamp,
      rating: Math.min(Math.max(r.rating.rating, 800), 2200), // Stricter rating bounds
      ratingDeviation: Math.min(Math.max(r.rating.ratingDeviation, 50), 350), // Stricter RD bounds  
      volatility: Math.min(Math.max(r.rating.volatility, 0.001), 0.5), // Stricter volatility bounds
      performanceScore: Math.min(Math.max(r.performanceScore, 0), 9.99) // Performance score 0-9.99 to fit DB schema
    }));

    try {
      // Delete existing ratings for this coin in this time range
      await this.prisma.glickoRatings.deleteMany({
        where: {
          symbol: coin,
          timestamp: {
            gte: ratings[0].timestamp,
            lte: ratings[ratings.length - 1].timestamp
          }
        }
      });

      // Insert new ratings in smaller batches to avoid memory issues
      const batchSize = 1000;
      let totalSaved = 0;
      
      for (let i = 0; i < ratingData.length; i += batchSize) {
        const batch = ratingData.slice(i, i + batchSize);
        const result = await this.prisma.glickoRatings.createMany({
          data: batch,
          skipDuplicates: true
        });
        totalSaved += result.count;
      }

      console.log(`  ✅ Database save: ${totalSaved}/${ratingData.length} ratings for ${coin}`);

    } catch (error) {
      console.error(`❌ Error saving ratings for ${coin}:`, error);
      throw error;
    }
  }

  /**
   * Display final summary of calculated ratings
   */
  async displayFinalSummary(coins: string[]): Promise<void> {
    console.log('\n🎯 Final Ratings Summary:');
    
    for (const coin of coins) {
      const latestRating = await this.prisma.glickoRatings.findFirst({
        where: { symbol: coin },
        orderBy: { timestamp: 'desc' }
      });

      if (latestRating) {
        console.log(`  ${coin}: Rating=${Math.round(Number(latestRating.rating))}, RD=${Math.round(Number(latestRating.ratingDeviation))}, Vol=${Number(latestRating.volatility).toFixed(4)}`);
      } else {
        console.log(`  ${coin}: No ratings calculated`);
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
  const args = process.argv.slice(2);

  if (args.length !== 3) {
    console.error('❌ Invalid arguments. Usage:');
    console.error('npx ts-node scripts/calculateGlickoRatings-chunked.ts "BTC,ETH,ADA" "2021-08-08" "2025-08-08"');
    process.exit(1);
  }

  const [coinsArg, startTimeArg, endTimeArg] = args;

  // Parse coins
  const coins = coinsArg.split(',').map(coin => coin.trim());

  // Parse dates
  const startTime = new Date(startTimeArg);
  const endTime = new Date(endTimeArg);

  if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
    console.error('❌ Invalid date format. Use YYYY-MM-DD format');
    process.exit(1);
  }

  if (startTime >= endTime) {
    console.error('❌ Start time must be before end time');
    process.exit(1);
  }

  return { coins, startTime, endTime };
}

/**
 * Main execution function
 */
async function main() {
  const calculator = new GlickoCalculatorChunked();

  try {
    console.log('🎯 Starting CHUNKED Glicko-2 rating calculation script...');
    console.log('🔧 CORRECTED: Processing chronologically by time interval with chunking');
    console.log('=' .repeat(70));

    await calculator.initialize();

    const { coins, startTime, endTime } = parseArguments();

    console.log(`📋 Configuration:`);
    console.log(`  - Coins: ${coins.join(', ')}`);
    console.log(`  - Start time: ${startTime.toISOString()}`);
    console.log(`  - End time: ${endTime.toISOString()}`);
    console.log(`  - Calculation order: ✅ BY TIME INTERVAL (CHUNKED)`);;

    await calculator.calculateAllRatings(coins, startTime, endTime);

    console.log('\n🎉 CHUNKED Glicko-2 rating calculation completed successfully!');

  } catch (error) {
    console.error('\n💥 Glicko-2 rating calculation failed:', error);
    process.exit(1);
  } finally {
    await calculator.cleanup();
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { GlickoCalculatorChunked };