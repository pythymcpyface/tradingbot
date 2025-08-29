#!/usr/bin/env ts-node

/**
 * Calculate Initial Glicko-2 Ratings
 * 
 * This script processes the migrated historical klines data to calculate
 * initial Glicko-2 ratings for all trading pairs based on price momentum
 * and volume-weighted performance.
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

interface PairPerformance {
  symbol: string;
  returns: number[];
  volumeWeights: number[];
  zScores: number[];
  winRate: number;
  avgReturn: number;
  volatility: number;
}

class GlickoRatingCalculator {
  private prisma: PrismaClient;
  
  // Glicko-2 constants
  private readonly TAU = 0.5; // System volatility
  private readonly EPSILON = 0.000001;
  private readonly INITIAL_RATING = 1500;
  private readonly INITIAL_RD = 350;
  private readonly INITIAL_VOLATILITY = 0.06;
  
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
   * Calculate z-score momentum for price movements
   */
  private calculateZScore(values: number[], windowSize: number = 20): number[] {
    const zScores: number[] = [];
    
    for (let i = windowSize; i < values.length; i++) {
      const window = values.slice(i - windowSize, i);
      const mean = window.reduce((sum, val) => sum + val, 0) / window.length;
      const variance = window.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / window.length;
      const stdDev = Math.sqrt(variance);
      
      if (stdDev > 0) {
        zScores.push((values[i] - mean) / stdDev);
      } else {
        zScores.push(0);
      }
    }
    
    return zScores;
  }

  /**
   * Process historical data for a symbol to calculate performance metrics
   */
  async calculatePairPerformance(symbol: string): Promise<PairPerformance> {
    console.log(`📊 Processing ${symbol}...`);
    
    // Get historical data ordered by time
    const klines = await this.prisma.klines.findMany({
      where: { symbol },
      orderBy: { openTime: 'asc' },
      select: {
        openTime: true,
        closeTime: true,
        open: true,
        high: true,
        low: true,
        close: true,
        volume: true,
        quoteAssetVolume: true,
        takerBuyBaseAssetVolume: true,
        takerBuyQuoteAssetVolume: true
      }
    });

    if (klines.length < 50) {
      throw new Error(`Insufficient data for ${symbol}: ${klines.length} records`);
    }

    // Calculate returns and volume metrics
    const returns: number[] = [];
    const volumeWeights: number[] = [];
    
    for (let i = 1; i < klines.length; i++) {
      const prevClose = Number(klines[i - 1].close);
      const currentClose = Number(klines[i].close);
      const volumeRatio = Number(klines[i].takerBuyBaseAssetVolume) / Number(klines[i].volume);
      
      // Calculate price return
      const priceReturn = (currentClose - prevClose) / prevClose;
      returns.push(priceReturn);
      
      // Volume-weighted score (positive for buy pressure, negative for sell pressure)
      const volumeWeight = volumeRatio > 0.5 ? volumeRatio : -(1 - volumeRatio);
      volumeWeights.push(volumeWeight);
    }

    // Calculate z-scores for momentum
    const zScores = this.calculateZScore(returns);
    
    // Calculate performance metrics
    const positiveReturns = returns.filter(r => r > 0).length;
    const winRate = positiveReturns / returns.length;
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const volatility = Math.sqrt(variance);

    return {
      symbol,
      returns,
      volumeWeights,
      zScores,
      winRate,
      avgReturn,
      volatility
    };
  }

  /**
   * Calculate initial Glicko-2 rating based on historical performance
   */
  private calculateInitialGlickoRating(performance: PairPerformance): {
    rating: number;
    ratingDeviation: number;
    volatility: number;
  } {
    // Base rating adjustments on performance metrics
    const performanceScore = (
      performance.winRate * 0.4 +                    // 40% win rate
      Math.min(Math.max(performance.avgReturn * 1000, -200), 200) * 0.3 + // 30% average return (capped)
      Math.min(Math.max(-performance.volatility * 100, -100), 100) * 0.2 + // 20% volatility (lower is better)
      Math.min(Math.max(performance.zScores.slice(-20).reduce((sum, z) => sum + z, 0) / 20 * 50, -100), 100) * 0.1 // 10% recent momentum
    );

    // Adjust rating from base
    const rating = this.INITIAL_RATING + performanceScore;
    
    // Rating deviation based on data consistency (lower volatility = more reliable)
    const ratingDeviation = Math.max(
      this.INITIAL_RD * (0.5 + performance.volatility * 2), // Higher volatility = higher RD
      150 // Minimum RD
    );
    
    // Volatility based on recent price behavior
    const volatility = Math.min(Math.max(
      this.INITIAL_VOLATILITY + (performance.volatility - 0.02), // Adjust from baseline
      0.01
    ), 0.2);

    return {
      rating: Math.round(rating),
      ratingDeviation: Math.round(ratingDeviation * 100) / 100,
      volatility: Math.round(volatility * 10000) / 10000
    };
  }

  /**
   * Process all symbols and calculate initial ratings
   */
  async calculateAllInitialRatings(): Promise<void> {
    console.log('🚀 Calculating initial Glicko-2 ratings from historical data...');
    
    // Get all unique symbols
    const symbols = await this.prisma.klines.findMany({
      select: { symbol: true },
      distinct: ['symbol']
    });

    console.log(`📈 Processing ${symbols.length} trading pairs...`);
    
    const ratings: Array<{
      symbol: string;
      timestamp: Date;
      rating: number;
      ratingDeviation: number;
      volatility: number;
      performanceScore: number;
    }> = [];

    // Process each symbol
    for (const { symbol } of symbols) {
      try {
        const performance = await this.calculatePairPerformance(symbol);
        const glickoRating = this.calculateInitialGlickoRating(performance);
        
        // Calculate performance score for this pair (0-9.99 scale to fit decimal(3,2))
        const performanceScore = Math.min(Math.max(
          (performance.winRate * 4) + 
          (Math.min(Math.max(performance.avgReturn * 100 + 1, 0), 3)) +
          (Math.min(Math.max(3 - performance.volatility * 10, 0), 3)),
          0
        ), 9.99);

        ratings.push({
          symbol,
          timestamp: new Date(),
          rating: glickoRating.rating,
          ratingDeviation: glickoRating.ratingDeviation,
          volatility: glickoRating.volatility,
          performanceScore: performanceScore
        });

        console.log(`✅ ${symbol}: Rating=${glickoRating.rating}, RD=${glickoRating.ratingDeviation}, Vol=${glickoRating.volatility}`);
        
      } catch (error) {
        console.error(`❌ Error processing ${symbol}:`, error);
      }
    }

    // Save ratings to database
    console.log('\n💾 Saving ratings to database...');
    
    // Clear existing ratings first
    await this.prisma.glickoRatings.deleteMany({});
    
    // Insert new ratings
    const result = await this.prisma.glickoRatings.createMany({
      data: ratings,
      skipDuplicates: false
    });

    console.log(`✅ Saved ${result.count} initial ratings`);
    
    // Display summary statistics
    const avgRating = ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length;
    const minRating = Math.min(...ratings.map(r => r.rating));
    const maxRating = Math.max(...ratings.map(r => r.rating));
    
    console.log('\n📊 Rating Summary:');
    console.log(`  - Average Rating: ${Math.round(avgRating)}`);
    console.log(`  - Rating Range: ${minRating} to ${maxRating}`);
    console.log(`  - Total Pairs: ${ratings.length}`);
    
    // Show top and bottom performers
    const sortedRatings = ratings.sort((a, b) => b.rating - a.rating);
    
    console.log('\n🏆 Top 5 Rated Pairs:');
    sortedRatings.slice(0, 5).forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.symbol}: ${r.rating} (RD: ${r.ratingDeviation})`);
    });
    
    console.log('\n📉 Bottom 5 Rated Pairs:');
    sortedRatings.slice(-5).forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.symbol}: ${r.rating} (RD: ${r.ratingDeviation})`);
    });
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
    console.log('🧹 Cleanup completed');
  }
}

// Main execution function
async function main() {
  const calculator = new GlickoRatingCalculator();
  
  try {
    console.log('🎯 Starting initial Glicko-2 rating calculation...');
    console.log('=' .repeat(60));
    
    await calculator.initialize();
    await calculator.calculateAllInitialRatings();
    
    console.log('\n🎉 Initial rating calculation completed successfully!');
    console.log('The Glicko-2 ratings are now ready for backtesting and live trading.');
    
  } catch (error) {
    console.error('\n💥 Rating calculation failed:', error);
    process.exit(1);
  } finally {
    await calculator.cleanup();
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { GlickoRatingCalculator };