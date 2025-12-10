#!/usr/bin/env ts-node

/**
 * Calculate Glicko-2 Ratings Script - CHUNKED VERSION (UNIFIED LIVE ENGINE ALGORITHM)
 *
 * ALGORITHM: Simplified Glicko-2 variant matching live trading engine.
 * - Game Result: Continuous scaling from price changes: gameResult = 0.5 + (priceChange * 50)
 * - Volatility Update: Simplified direct calculation: σ' = √(σ² + δ²/v)
 * - Opponent Rating: Dynamic, market-based: opponentRating = 1500 + (marketVolatility * 1000) + (log(volumeRatio) * 100)
 *
 * PROCESSING: Chunked by 30-day periods to handle large datasets efficiently
 * Maintains chronological processing order for temporal consistency.
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
   * Calculate game result using continuous scaling (matches live trading algorithm)
   * Maps price change to [0.0, 1.0] where 0.5 is neutral (0% change)
   */
  private calculateGameResult(priceChange: number): number {
    // Draw detection
    if (Math.abs(priceChange) < 0.001) { // < 0.1% change = draw
      return 0.5;
    }

    // Continuous scaling: maps price change to game result
    const gameResult = 0.5 + (priceChange * 50);

    // Bound result to [0.0, 1.0]
    return Math.min(1.0, Math.max(0.0, gameResult));
  }

  /**
   * Calculate market volatility from recent price movements
   * Used to adjust opponent rating dynamically
   */
  private calculateMarketVolatility(klines: KlineData[]): number {
    if (klines.length < 2) return 0.1;

    const returns: number[] = [];
    for (let i = 1; i < klines.length; i++) {
      const prevPrice = klines[i - 1].close;
      const currPrice = klines[i].close;
      const logReturn = Math.log(currPrice / prevPrice);
      returns.push(logReturn);
    }

    // Calculate standard deviation of returns
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    return Math.sqrt(variance);
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

    // Calculate variance v
    let v = 0;
    for (const opp of opponents) {
      const gPhi = this.g(opp.phi);
      const expectedScore = this.E(mu, opp.mu, opp.phi);
      v += Math.pow(gPhi, 2) * expectedScore * (1 - expectedScore);
    }
    v = 1 / v;

    // Calculate rating improvement delta
    let delta = 0;
    for (const opp of opponents) {
      const gPhi = this.g(opp.phi);
      const expectedScore = this.E(mu, opp.mu, opp.phi);
      delta += gPhi * (opp.score - expectedScore);
    }
    delta = v * delta;

    // Simplified volatility update: newSigma = sqrt(sigma^2 + delta^2/v)
    const newSigma = Math.sqrt(sigma * sigma + (delta * delta) / v);
    const boundedSigma = Math.min(0.2, Math.max(0.01, newSigma));

    // Update rating deviation using phi-star calculation
    const phi2 = Math.pow(phi, 2);
    const phiStar = Math.sqrt(phi2 + Math.pow(boundedSigma, 2));
    const newPhiSquared = 1 / (1 / Math.pow(phiStar, 2) + 1 / v);
    const newPhi = Math.sqrt(newPhiSquared);

    // Update rating
    let newMu = mu;
    for (const opp of opponents) {
      const gPhi = this.g(opp.phi);
      const expectedScore = this.E(mu, opp.mu, opp.phi);
      newMu += newPhiSquared * gPhi * (opp.score - expectedScore);
    }

    // Convert back to standard scale
    const { rating: newRating, rd: newRD } = this.fromGlicko2Scale(newMu, newPhi);

    // Validate results and prevent extreme values
    const validatedRating = Math.max(800, Math.min(2200, isNaN(newRating) ? this.INITIAL_RATING : newRating));
    const validatedRD = Math.max(50, Math.min(350, isNaN(newRD) ? this.INITIAL_RD : newRD));
    const validatedVolatility = Math.max(0.01, Math.min(0.2, isNaN(boundedSigma) ? this.INITIAL_VOLATILITY : boundedSigma));

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
   * Calculates continuous game results and dynamic opponent ratings
   */
  private processCoinPerformance(
    coin: string,
    klines: KlineData[],
    timestamp: string,
    recentKlines: KlineData[] = []
  ): GlickoGame[] {
    const games: GlickoGame[] = [];

    // Calculate market volatility from recent klines for dynamic opponent rating
    const marketVolatility = recentKlines.length > 0 ?
      this.calculateMarketVolatility(recentKlines) :
      this.calculateMarketVolatility(klines);

    for (const kline of klines) {
      // Determine this coin's role in the trading pair
      const symbol = kline.symbol;
      const isBaseCoin = symbol.startsWith(coin);

      let klineData = { ...kline };

      // If this coin is the quote asset, invert the performance
      if (!isBaseCoin) {
        const originalOpen = klineData.open;
        const originalClose = klineData.close;

        // Invert price (1/price)
        klineData.open = 1 / originalClose;
        klineData.close = 1 / originalOpen;

        // Swap taker buy/sell volumes
        const originalTakerBuy = klineData.takerBuyBaseAssetVolume;
        klineData.takerBuyBaseAssetVolume = klineData.volume - originalTakerBuy;
      }

      // Calculate price change for continuous scaling
      const priceChange = (klineData.close - klineData.open) / klineData.open;
      const gameResult = this.calculateGameResult(priceChange);

      // Calculate volume ratio for dynamic opponent rating
      const volumeRatio = (kline.volume || 1) / (recentKlines[recentKlines.length - 1]?.volume || 1);

      // Dynamic opponent rating: base + market volatility adjustment + volume adjustment
      const opponentRating = this.OPPONENT_RATING +
        (marketVolatility * 1000) +
        (Math.log(volumeRatio) * 100);

      // Add game to current batch
      games.push({
        timestamp: new Date(timestamp),
        score: gameResult,
        opponentRating: opponentRating,
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