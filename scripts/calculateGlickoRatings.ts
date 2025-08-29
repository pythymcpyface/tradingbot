#!/usr/bin/env ts-node

/**
 * Calculate Glicko-2 Ratings Script
 * 
 * This script implements the hybrid performance score and Glicko-2 system,
 * uploading the ratings (μ, φ, σ) for each coin to the glicko_ratings table.
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

class GlickoCalculator {
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
   * Calculate Glicko-2 ratings for a specific coin over a time period
   */
  async calculateRatingsForCoin(
    coin: string,
    coins: string[],
    startTime: Date,
    endTime: Date
  ): Promise<Array<{ timestamp: Date; rating: GlickoRating; performanceScore: number }>> {
    console.log(`📊 Calculating Glicko-2 ratings for ${coin}...`);

    // Find all trading pairs where this coin is either base or quote asset
    // and the other asset is also in our coins list
    const relevantPairs: string[] = [];
    
    for (const otherCoin of coins) {
      if (otherCoin !== coin) {
        // Check if COIN/OTHERCOIN pair exists
        const pair1 = `${coin}${otherCoin}`;
        const pair2 = `${otherCoin}${coin}`;
        
        // We'll check which pairs actually exist in the database
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
    
    console.log(`  Found trading pairs for ${coin}: ${relevantPairs.join(', ')}`);

    if (relevantPairs.length === 0) {
      console.warn(`⚠️ No trading pairs found for ${coin} with other coins`);
      return [];
    }

    // Get all klines for relevant pairs in the time range
    const allKlines = await this.prisma.klines.findMany({
      where: {
        symbol: { in: relevantPairs },
        openTime: {
          gte: startTime,
          lte: endTime
        }
      },
      orderBy: { openTime: 'asc' }
    });

    if (allKlines.length === 0) {
      console.warn(`⚠️ No klines found for ${coin} pairs in specified time range`);
      return [];
    }

    console.log(`  Found ${allKlines.length} klines across all ${coin} pairs`);

    // Initialize rating
    let currentRating: GlickoRating = {
      rating: this.INITIAL_RATING,
      ratingDeviation: this.INITIAL_RD,
      volatility: this.INITIAL_VOLATILITY
    };

    const results: Array<{ timestamp: Date; rating: GlickoRating; performanceScore: number }> = [];

    // Group klines by timestamp (1-hour intervals)
    const klinesByTimestamp = new Map<string, any[]>();
    
    for (const kline of allKlines) {
      const timestamp = kline.openTime.toISOString();
      if (!klinesByTimestamp.has(timestamp)) {
        klinesByTimestamp.set(timestamp, []);
      }
      klinesByTimestamp.get(timestamp)!.push(kline);
    }

    const timestamps = Array.from(klinesByTimestamp.keys()).sort();
    
    // Process each timestamp as a rating period
    let gamesBatch: GlickoGame[] = [];
    const BATCH_SIZE = 168; // Process ratings every 7 days for stability

    for (let i = 0; i < timestamps.length; i++) {
      const timestamp = timestamps[i];
      const timestampKlines = klinesByTimestamp.get(timestamp)!;
      
      // For each kline in this timestamp, determine this coin's performance
      for (const kline of timestampKlines) {
        // Determine this coin's role in the trading pair
        const symbol = kline.symbol;
        const isBaseCoin = symbol.startsWith(coin);
        
        // Convert Decimal fields to numbers
        let klineData: KlineData = {
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
        gamesBatch.push({
          timestamp: new Date(timestamp),
          score: hybridScore.score,
          opponentRating: this.OPPONENT_RATING,
          opponentRD: this.OPPONENT_RD
        });
      }

      // Update rating every BATCH_SIZE hours or at the end
      if (gamesBatch.length >= BATCH_SIZE || i === timestamps.length - 1) {
        currentRating = this.updateGlickoRating(currentRating, gamesBatch);
        
        // Calculate average performance score for this batch
        const avgPerformanceScore = gamesBatch.reduce((sum, game) => sum + game.score, 0) / gamesBatch.length;
        
        results.push({
          timestamp: new Date(timestamp),
          rating: { ...currentRating },
          performanceScore: avgPerformanceScore * 9.99 // Scale to 0-9.99 range to fit DB schema
        });

        gamesBatch = []; // Reset batch
      }
    }

    console.log(`  ✅ Calculated ${results.length} rating periods for ${coin}`);
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

      console.log(`  ✅ Saved ${result.count} ratings for ${coin}`);

    } catch (error) {
      console.error(`❌ Error saving ratings for ${coin}:`, error);
      throw error;
    }
  }

  /**
   * Process all coins and calculate their Glicko-2 ratings
   */
  async calculateAllRatings(
    coins: string[],
    startTime: Date,
    endTime: Date
  ): Promise<void> {
    console.log('🚀 Starting Glicko-2 rating calculations...');
    console.log(`📊 Coins: ${coins.join(', ')}`);
    console.log(`📅 Date range: ${startTime.toISOString()} to ${endTime.toISOString()}`);

    let processedCoins = 0;
    const totalRatings: { [coin: string]: number } = {};

    for (const coin of coins) {
      try {
        console.log(`\n[${processedCoins + 1}/${coins.length}] Processing ${coin}...`);
        
        const ratings = await this.calculateRatingsForCoin(coin, coins, startTime, endTime);
        
        if (ratings.length > 0) {
          await this.saveRatings(coin, ratings);
          totalRatings[coin] = ratings.length;
        }
        
        processedCoins++;

      } catch (error) {
        console.error(`❌ Failed to process ${coin}:`, error);
        // Continue with other coins
      }
    }

    console.log('\n📊 Calculation Summary:');
    console.log(`  - Coins processed: ${processedCoins}/${coins.length}`);
    Object.entries(totalRatings).forEach(([coin, count]) => {
      console.log(`  - ${coin}: ${count} rating periods`);
    });

    // Display final ratings summary
    await this.displayFinalSummary(coins);
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
      console.error('npm run calculateGlickoRatings "BTC,ETH,ADA" ["2021-08-08"] ["2025-08-08"]');
      console.error('OR use environment variables: BASE_COINS, START_DATE, END_DATE');
      console.error('');
      console.error('Examples:');
      console.error('  npm run calculateGlickoRatings "BTC,ETH"  # Uses full date range from klines table');
      console.error('  npm run calculateGlickoRatings "BTC,ETH" "2024-01-01"  # Start date with latest end date from klines');
      console.error('  npm run calculateGlickoRatings "BTC,ETH" "2024-01-01" "2024-12-31"  # Both dates specified');
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
    console.error('npm run calculateGlickoRatings "BTC,ETH,ADA" ["2021-08-08"] ["2025-08-08"]');
    console.error('OR use environment variables: BASE_COINS, START_DATE, END_DATE');
    console.error('');
    console.error('Examples:');
    console.error('  npm run calculateGlickoRatings "BTC,ETH"  # Uses full date range from klines table');
    console.error('  npm run calculateGlickoRatings "BTC,ETH" "2024-01-01"  # Start date with latest end date from klines');
    console.error('  npm run calculateGlickoRatings "BTC,ETH" "2024-01-01" "2024-12-31"  # Both dates specified');
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
  const calculator = new GlickoCalculator();

  try {
    console.log('🎯 Starting Glicko-2 rating calculation script...');
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
    console.log(`  - Hybrid scoring: Price action + Volume dominance`);

    await calculator.calculateAllRatings(coins, startTime, endTime);

    console.log('\n🎉 Glicko-2 rating calculation completed successfully!');

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

export { GlickoCalculator };