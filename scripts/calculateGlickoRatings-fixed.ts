#!/usr/bin/env ts-node

/**
 * Calculate Glicko-2 Ratings Script - UNIFIED LIVE ENGINE ALGORITHM
 *
 * ALGORITHM: Implements the simplified Glicko-2 variant used in live trading engine.
 * - Game Result: Continuous scaling from price changes: gameResult = 0.5 + (priceChange * 50)
 * - Volatility Update: Simplified direct calculation: σ' = √(σ² + δ²/v)
 * - Opponent Rating: Dynamic, based on market volatility: opponentRating = 1500 + (marketVolatility * 1000) + (log(volumeRatio) * 100)
 * - No Illinois Algorithm: Skip iterative root-finding for performance
 *
 * PROCESSING: Chronological by time interval (not by coin)
 * This ensures all coins compete at the same time, maintaining temporal consistency.
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
  gamesBatch: GlickoGame[];
  relevantPairs: string[];
}

class GlickoCalculatorFixed {
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
    // Positive price changes scale up to 1.0
    // Negative price changes scale down to 0.0
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
   * Update Glicko-2 rating based on game results (simplified version matching live engine)
   * Uses direct volatility calculation instead of Illinois algorithm
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
    const phiStar = Math.sqrt(Math.pow(phi, 2) + Math.pow(boundedSigma, 2));
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
    recentKlines: KlineData[]
  ): GlickoGame[] {
    const games: GlickoGame[] = [];

    // Calculate market volatility from recent klines for dynamic opponent rating
    const marketVolatility = this.calculateMarketVolatility(recentKlines);

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
   * Process a chunk of klines data for chunked processing approach
   */
  private async processKlinesChunk(
    chunkKlines: any[],
    coinStates: Map<string, CoinRatingState>,
    allHistoricalKlines: Map<string, KlineData[]>
  ): Promise<void> {
    // Group klines by timestamp within this chunk
    const klinesByTimestamp = new Map<string, KlineData[]>();

    for (const kline of chunkKlines) {
      // Convert Decimal fields to numbers
      const klineData: KlineData = {
        ...kline,
        open: Number(kline.open),
        high: Number(kline.high || 0),
        low: Number(kline.low || 0),
        close: Number(kline.close),
        volume: Number(kline.volume),
        quoteAssetVolume: Number(kline.quoteAssetVolume || 0),
        numberOfTrades: Number(kline.numberOfTrades || 0),
        takerBuyBaseAssetVolume: Number(kline.takerBuyBaseAssetVolume),
        takerBuyQuoteAssetVolume: Number(kline.takerBuyQuoteAssetVolume || 0),
        ignore: Number(kline.ignore || 0)
      };

      const timestamp = kline.openTime.toISOString();
      if (!klinesByTimestamp.has(timestamp)) {
        klinesByTimestamp.set(timestamp, []);
      }
      klinesByTimestamp.get(timestamp)!.push(klineData);
    }

    // Process each timestamp chronologically
    const timestamps = Array.from(klinesByTimestamp.keys()).sort();

    for (const timestamp of timestamps) {
      const timestampKlines = klinesByTimestamp.get(timestamp)!;

      // Process all coins for this timestamp simultaneously
      for (const [coin, coinState] of coinStates) {
        // Find klines relevant to this coin at this timestamp
        const relevantKlines = timestampKlines.filter(kline =>
          coinState.relevantPairs.includes(kline.symbol)
        );

        if (relevantKlines.length > 0) {
          // Get recent historical klines for volatility calculation (last 20 intervals)
          const recentKlinesForVolatility: KlineData[] = [];
          for (const pair of coinState.relevantPairs) {
            const pairHistory = allHistoricalKlines.get(pair) || [];
            const recentForPair = pairHistory.slice(-20);
            recentKlinesForVolatility.push(...recentForPair);
          }

          // Use current chunk klines if no historical data
          const volatilityKlines = recentKlinesForVolatility.length > 0 ?
            recentKlinesForVolatility :
            relevantKlines;

          const games = this.processCoinPerformance(coin, relevantKlines, timestamp, volatilityKlines);
          coinState.gamesBatch.push(...games);

          // Process ratings in batches to maintain stability
          if (coinState.gamesBatch.length >= this.BATCH_SIZE) {
            coinState.currentRating = this.updateGlickoRating(coinState.currentRating, coinState.gamesBatch);
            coinState.gamesBatch = []; // Clear processed games
          }
        }
      }

      // Update historical klines tracking
      for (const kline of timestampKlines) {
        if (!allHistoricalKlines.has(kline.symbol)) {
          allHistoricalKlines.set(kline.symbol, []);
        }
        allHistoricalKlines.get(kline.symbol)!.push(kline);
      }
    }
  }

  /**
   * CORRECTED: Process all coins and calculate their Glicko-2 ratings CHRONOLOGICALLY
   */
  async calculateAllRatings(
    coins: string[],
    startTime: Date,
    endTime: Date
  ): Promise<void> {
    console.log('🚀 Starting CORRECTED Glicko-2 rating calculations...');
    console.log('✅ Processing BY TIME INTERVAL (chronologically) - FIXED VERSION');
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

    // Step 3: Get ALL klines data for ALL pairs, sorted by time
    console.log('📊 Loading all klines data...');
    const allPairs = Array.from(coinPairs.values()).flat();
    const uniquePairs = [...new Set(allPairs)];
    
    console.log(`  Loading data for ${uniquePairs.length} unique trading pairs...`);
    console.log('  📊 Using chunked processing to handle large datasets efficiently...');

    // Initialize results arrays for all coins
    const results = new Map<string, Array<{ timestamp: Date; rating: GlickoRating; performanceScore: number }>>();
    for (const coin of coins) {
      results.set(coin, []);
    }

    // Initialize historical klines tracking for volatility calculation
    const allHistoricalKlines = new Map<string, KlineData[]>();

    // Process data in 30-day chunks to avoid memory issues
    const chunkSizeMs = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
    const totalTimeRange = endTime.getTime() - startTime.getTime();
    const totalChunks = Math.ceil(totalTimeRange / chunkSizeMs);

    console.log(`  ⏱️ Processing ${totalChunks} chunks of 30 days each...`);

    let totalProcessedKlines = 0;
    let currentChunk = 0;

    // Process each time chunk sequentially
    for (let currentTime = startTime.getTime(); currentTime < endTime.getTime(); currentTime += chunkSizeMs) {
      currentChunk++;
      const chunkEndTime = new Date(Math.min(currentTime + chunkSizeMs, endTime.getTime()));
      const chunkStartTime = new Date(currentTime);

      console.log(`  📈 Processing chunk ${currentChunk}/${totalChunks}: ${chunkStartTime.toISOString().split('T')[0]} to ${chunkEndTime.toISOString().split('T')[0]}`);

      const chunkKlines = await this.prisma.klines.findMany({
        where: {
          symbol: { in: uniquePairs },
          openTime: {
            gte: chunkStartTime,
            lt: chunkEndTime
          }
        },
        select: {
          symbol: true,
          openTime: true,
          closeTime: true,
          open: true,
          close: true,
          volume: true,
          takerBuyBaseAssetVolume: true
        },
        orderBy: { openTime: 'asc' } // ✅ CRITICAL: Sort by time first
      });

      if (chunkKlines.length > 0) {
        console.log(`    📊 Loaded ${chunkKlines.length.toLocaleString()} klines for this chunk`);
        totalProcessedKlines += chunkKlines.length;

        // Process this chunk of data with historical klines tracking
        await this.processKlinesChunk(chunkKlines, coinStates, allHistoricalKlines);
      } else {
        console.log(`    ⚪ No data found for this time period`);
      }
    }

    if (totalProcessedKlines === 0) {
      console.warn('⚠️ No klines found for any pairs in specified time range');
      return;
    }

    console.log(`✅ Completed processing ${totalProcessedKlines.toLocaleString()} total klines across ${totalChunks} chunks`);

    // Step 4: Process rating updates and save results

    // Process final rating updates for any remaining games in batches
    console.log('\n🔄 Processing final rating updates...');
    
    for (const coin of coins) {
      const coinState = coinStates.get(coin)!;
      
      if (coinState.gamesBatch.length > 0) {
        coinState.currentRating = this.updateGlickoRating(coinState.currentRating, coinState.gamesBatch);
        
        // Calculate average performance score for this batch
        const avgPerformanceScore = coinState.gamesBatch.reduce((sum, game) => sum + game.score, 0) / coinState.gamesBatch.length;
        
        // Store result
        results.get(coin)!.push({
          timestamp: endTime, // Use end time as final timestamp
          rating: { ...coinState.currentRating },
          performanceScore: avgPerformanceScore * 9.99 // Scale to 0-9.99 range
        });
      }
    }

    // Step 5: Save all results to database
    console.log('\n💾 Saving results to database...');
    
    for (const coin of coins) {
      const coinResults = results.get(coin) || [];
      if (coinResults.length > 0) {
        await this.saveRatings(coin, coinResults);
        console.log(`  ✅ Saved ${coinResults.length} ratings for ${coin}`);
      }
    }

    // Display final summary
    console.log('\n📊 Calculation Summary:');
    for (const coin of coins) {
      const coinResults = results.get(coin) || [];
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

      // Insert new ratings
      const result = await this.prisma.glickoRatings.createMany({
        data: ratingData,
        skipDuplicates: true
      });

      console.log(`  ✅ Database save: ${result.count}/${ratingData.length} ratings for ${coin}`);

    } catch (error) {
      console.error(`❌ Error saving ratings for ${coin}:`, error);
      throw error;
    }
  }

  /**
   * Get the earliest and latest dates from the klines table
   */
  async getKlinesDateRange(): Promise<{ startTime: Date; endTime: Date } | null> {
    try {
      const dateRange = await this.prisma.klines.aggregate({
        _min: { openTime: true },
        _max: { closeTime: true }
      });

      if (!dateRange._min.openTime || !dateRange._max.closeTime) {
        return null;
      }

      return {
        startTime: dateRange._min.openTime,
        endTime: dateRange._max.closeTime
      };
    } catch (error) {
      console.error('❌ Error getting klines date range:', error);
      return null;
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
  startTime: Date | null;
  endTime: Date | null;
} {
  const args = process.argv.slice(2);

  // Allow no arguments to use environment variables
  if (args.length === 0) {
    // Try to get coins from environment variable
    const baseCoins = process.env.BASE_COINS;
    if (!baseCoins) {
      console.error('❌ Invalid arguments. Usage:');
      console.error('npm run calculateGlickoRatings:fixed "BTC,ETH,ADA" ["2021-08-08"] ["2025-08-08"]');
      console.error('OR use environment variables: BASE_COINS, START_DATE, END_DATE');
      console.error('');
      console.error('Examples:');
      console.error('  npm run calculateGlickoRatings:fixed "BTC,ETH"  # Uses full date range from klines table');
      console.error('  npm run calculateGlickoRatings:fixed "BTC,ETH" "2024-01-01"  # Start date with latest end date from klines');
      console.error('  npm run calculateGlickoRatings:fixed "BTC,ETH" "2024-01-01" "2024-12-31"  # Both dates specified');
      process.exit(1);
    }
    
    const coins = baseCoins.split(',').map(coin => coin.trim());
    let startTime: Date | null = null;
    let endTime: Date | null = null;
    
    // Check for optional env dates
    if (process.env.START_DATE) {
      startTime = new Date(process.env.START_DATE);
      if (isNaN(startTime.getTime())) {
        console.error('❌ Invalid START_DATE format. Use YYYY-MM-DD format');
        process.exit(1);
      }
    }
    
    if (process.env.END_DATE) {
      endTime = new Date(process.env.END_DATE);
      if (isNaN(endTime.getTime())) {
        console.error('❌ Invalid END_DATE format. Use YYYY-MM-DD format');
        process.exit(1);
      }
    }
    
    return { coins, startTime, endTime };
  }
  
  if (args.length > 3) {
    console.error('❌ Invalid arguments. Usage:');
    console.error('npm run calculateGlickoRatings:fixed "BTC,ETH,ADA" ["2021-08-08"] ["2025-08-08"]');
    process.exit(1);
  }

  const [coinsArg, startTimeArg, endTimeArg] = args;

  // Parse coins
  const coins = coinsArg.split(',').map(coin => coin.trim());

  let startTime: Date | null = null;
  let endTime: Date | null = null;

  // Parse optional start date
  if (startTimeArg) {
    startTime = new Date(startTimeArg);
    if (isNaN(startTime.getTime())) {
      console.error('❌ Invalid start date format. Use YYYY-MM-DD format');
      process.exit(1);
    }
  }

  // Parse optional end date
  if (endTimeArg) {
    endTime = new Date(endTimeArg);
    if (isNaN(endTime.getTime())) {
      console.error('❌ Invalid end date format. Use YYYY-MM-DD format');
      process.exit(1);
    }
  }

  // Validate date relationship if both are provided
  if (startTime && endTime && startTime >= endTime) {
    console.error('❌ Start time must be before end time');
    process.exit(1);
  }

  return { coins, startTime, endTime };
}

/**
 * Main execution function
 */
async function main() {
  const calculator = new GlickoCalculatorFixed();

  try {
    console.log('🎯 Starting FIXED Glicko-2 rating calculation script...');
    console.log('🔧 CORRECTED: Processing chronologically by time interval');
    console.log('=' .repeat(70));

    await calculator.initialize();

    const { coins, startTime: providedStartTime, endTime: providedEndTime } = parseArguments();

    // Resolve date range - use provided dates or fetch from klines table
    let startTime: Date;
    let endTime: Date;

    if (!providedStartTime || !providedEndTime) {
      console.log('📅 Fetching date range from klines table...');
      
      const klinesDateRange = await calculator.getKlinesDateRange();
      
      if (!klinesDateRange) {
        console.error('❌ No klines data found in database. Run getKlines.ts first.');
        process.exit(1);
      }

      startTime = providedStartTime || klinesDateRange.startTime;
      endTime = providedEndTime || klinesDateRange.endTime;

      console.log(`✅ Using date range from klines table:`);
      console.log(`  📅 Available data: ${klinesDateRange.startTime.toISOString()} to ${klinesDateRange.endTime.toISOString()}`);
    } else {
      startTime = providedStartTime;
      endTime = providedEndTime;
    }

    console.log(`📋 Configuration:`);
    console.log(`  - Coins: ${coins.join(', ')}`);
    console.log(`  - Start time: ${startTime.toISOString()}`);
    console.log(`  - End time: ${endTime.toISOString()}`);
    console.log(`  - Calculation order: ✅ BY TIME INTERVAL (FIXED)`);

    await calculator.calculateAllRatings(coins, startTime, endTime);

    console.log('\n🎉 CORRECTED Glicko-2 rating calculation completed successfully!');

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

export { GlickoCalculatorFixed };