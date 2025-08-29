#!/usr/bin/env ts-node

/**
 * Calculate Glicko-2 Ratings Script - CORRECTED VERSION
 * 
 * FIXED: Now processes ratings chronologically by time interval, not by coin.
 * This ensures that all coins compete against each other at the same time,
 * maintaining proper temporal consistency in the Glicko-2 system.
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
   * Calculate hybrid performance score according to GLICKO_SPEC.html
   */
  private calculateHybridScore(kline: KlineData): HybridScore {
    const { open, close, takerBuyBaseAssetVolume, volume } = kline;
    
    // Validate input data
    if (!open || !close || open <= 0 || close <= 0) {
      console.warn(`  ⚠️ Invalid price data: open=${open}, close=${close}`);
      return {
        score: 0.5,
        scenario: 'DRAW',
        priceChange: 0,
        volumeRatio: 0.5
      };
    }
    
    if (volume < 0 || takerBuyBaseAssetVolume < 0 || takerBuyBaseAssetVolume > volume) {
      console.warn(`  ⚠️ Invalid volume data: volume=${volume}, takerBuy=${takerBuyBaseAssetVolume}`);
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
    const isPriceUnchanged = Math.abs(priceChange) < 0.0001; // Use small threshold for floating point comparison
    
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

    // Only log if actually clamping
    if (newRating < 800 || newRating > 2200 || isNaN(newRating)) {
      console.warn(`  ⚠️ Rating clamped: ${newRating.toFixed(1)} -> ${validatedRating.toFixed(1)}`);
    }

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
   * Process a chunk of klines data for chunked processing approach
   */
  private async processKlinesChunk(
    chunkKlines: any[],
    coinStates: Map<string, CoinRatingState>
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
          const games = this.processCoinPerformance(coin, relevantKlines, timestamp);
          coinState.gamesBatch.push(...games);
          
          // Process ratings in batches to maintain stability
          if (coinState.gamesBatch.length >= this.BATCH_SIZE) {
            coinState.currentRating = this.updateGlickoRating(coinState.currentRating, coinState.gamesBatch);
            coinState.gamesBatch = []; // Clear processed games
          }
        }
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
        
        // Process this chunk of data
        await this.processKlinesChunk(chunkKlines, coinStates);
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