#!/usr/bin/env ts-node

/**
 * Initial Glicko-2 Ratings Calculation Script
 * 
 * This script calculates Glicko-2 ratings for all historical klines data
 * after the database migration is complete.
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { RustCoreService } from '../src/node-api/services/RustCoreService';

// Load environment variables
config();

interface ProcessingStats {
  totalSymbols: number;
  processedSymbols: number;
  totalKlines: number;
  processedKlines: number;
  totalRatings: number;
  errors: number;
  startTime: Date;
}

class GlickoCalculator {
  private prisma: PrismaClient;
  private rustCore: RustCoreService;
  private stats: ProcessingStats;

  constructor() {
    this.prisma = new PrismaClient();
    this.rustCore = new RustCoreService();
    this.stats = {
      totalSymbols: 0,
      processedSymbols: 0,
      totalKlines: 0,
      processedKlines: 0,
      totalRatings: 0,
      errors: 0,
      startTime: new Date()
    };
  }

  async initialize(): Promise<void> {
    console.log('🔄 Initializing Glicko-2 calculation system...');
    
    try {
      // Connect to database
      await this.prisma.$connect();
      console.log('✅ Connected to database');
      
      // Initialize Rust core (this will build if needed)
      await this.rustCore.initialize();
      console.log('✅ Rust core initialized');
      
    } catch (error) {
      console.error('❌ Initialization failed:', error);
      throw error;
    }
  }

  async analyzeKlinesData(): Promise<{
    symbols: string[];
    totalRecords: number;
    dateRange: { start: Date; end: Date };
    recordsPerSymbol: Record<string, number>;
  }> {
    console.log('🔍 Analyzing klines data...');

    // Get all unique symbols
    const symbols = await this.prisma.klines.findMany({
      distinct: ['symbol'],
      select: { symbol: true },
      orderBy: { symbol: 'asc' }
    });

    // Get overall statistics
    const stats = await this.prisma.klines.aggregate({
      _count: { id: true },
      _min: { openTime: true },
      _max: { closeTime: true }
    });

    // Get records per symbol
    const recordsPerSymbol: Record<string, number> = {};
    
    for (const symbolRecord of symbols) {
      const count = await this.prisma.klines.count({
        where: { symbol: symbolRecord.symbol }
      });
      recordsPerSymbol[symbolRecord.symbol] = count;
    }

    const symbolList = symbols.map(s => s.symbol);
    const analysis = {
      symbols: symbolList,
      totalRecords: stats._count.id || 0,
      dateRange: {
        start: stats._min.openTime || new Date(),
        end: stats._max.closeTime || new Date()
      },
      recordsPerSymbol
    };

    this.stats.totalSymbols = symbolList.length;
    this.stats.totalKlines = analysis.totalRecords;

    console.log('📊 Klines Data Analysis:');
    console.log(`  - Total symbols: ${symbolList.length}`);
    console.log(`  - Total records: ${analysis.totalRecords.toLocaleString()}`);
    console.log(`  - Date range: ${analysis.dateRange.start.toISOString()} to ${analysis.dateRange.end.toISOString()}`);
    console.log(`  - Top symbols by records:`);
    
    const sortedSymbols = Object.entries(recordsPerSymbol)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10);
    
    sortedSymbols.forEach(([symbol, count]) => {
      console.log(`    ${symbol}: ${count.toLocaleString()}`);
    });

    return analysis;
  }

  async calculateRatingsForSymbol(
    symbol: string, 
    batchSize: number = 10000
  ): Promise<number> {
    console.log(`🔄 Processing ${symbol}...`);

    try {
      // Get total count for this symbol
      const totalCount = await this.prisma.klines.count({
        where: { symbol }
      });

      if (totalCount === 0) {
        console.log(`⚠️ No data found for ${symbol}`);
        return 0;
      }

      console.log(`  - Total records: ${totalCount.toLocaleString()}`);

      let processedCount = 0;
      let ratingsCount = 0;
      let offset = 0;

      while (offset < totalCount) {
        const batchStartTime = Date.now();

        // Fetch batch of klines
        const klines = await this.prisma.klines.findMany({
          where: { symbol },
          orderBy: { openTime: 'asc' },
          take: batchSize,
          skip: offset
        });

        if (klines.length === 0) break;

        // Transform to format expected by Rust core
        const klinesData = klines.map(k => ({
          symbol: k.symbol,
          open_time: k.openTime.getTime(),
          close_time: k.closeTime.getTime(),
          open: parseFloat(k.open.toString()),
          high: parseFloat(k.high.toString()),
          low: parseFloat(k.low.toString()),
          close: parseFloat(k.close.toString()),
          volume: parseFloat(k.volume.toString()),
          quote_asset_volume: parseFloat(k.quoteAssetVolume.toString()),
          number_of_trades: k.numberOfTrades,
          taker_buy_base_asset_volume: parseFloat(k.takerBuyBaseAssetVolume.toString()),
          taker_buy_quote_asset_volume: parseFloat(k.takerBuyQuoteAssetVolume.toString())
        }));

        // Calculate Glicko-2 ratings using Rust core
        const ratings = await this.rustCore.calculateGlickoRatings(klinesData);

        // Save ratings to database
        if (ratings.length > 0) {
          const savedRatings = await this.prisma.glickoRatings.createMany({
            data: ratings.map(r => ({
              symbol: r.symbol,
              timestamp: new Date(r.timestamp),
              rating: r.rating,
              ratingDeviation: r.rating_deviation,
              volatility: r.volatility,
              performanceScore: r.performance_score
            })),
            skipDuplicates: true
          });

          ratingsCount += savedRatings.count;
        }

        processedCount += klines.length;
        offset += batchSize;

        const batchTime = Date.now() - batchStartTime;
        const progress = (processedCount / totalCount * 100).toFixed(1);
        const rate = Math.round(klines.length / (batchTime / 1000));

        console.log(`    Progress: ${progress}% (${processedCount.toLocaleString()}/${totalCount.toLocaleString()}) - ${rate} records/sec`);
      }

      console.log(`✅ ${symbol} completed: ${ratingsCount.toLocaleString()} ratings calculated`);
      
      this.stats.processedSymbols++;
      this.stats.processedKlines += processedCount;
      this.stats.totalRatings += ratingsCount;

      return ratingsCount;

    } catch (error) {
      console.error(`❌ Error processing ${symbol}:`, error);
      this.stats.errors++;
      return 0;
    }
  }

  async calculateAllRatings(
    targetSymbols?: string[],
    batchSize: number = 10000
  ): Promise<void> {
    console.log('🚀 Starting Glicko-2 ratings calculation...');

    const analysis = await this.analyzeKlinesData();
    const symbolsToProcess = targetSymbols || analysis.symbols;

    console.log(`📋 Processing ${symbolsToProcess.length} symbols...`);

    // Process each symbol sequentially to avoid memory issues
    for (let i = 0; i < symbolsToProcess.length; i++) {
      const symbol = symbolsToProcess[i];
      console.log(`\n[${i + 1}/${symbolsToProcess.length}] Processing ${symbol}...`);

      await this.calculateRatingsForSymbol(symbol, batchSize);

      // Print progress summary
      this.printProgressSummary();
    }

    console.log('\n🎉 All symbols processed!');
    await this.createOptimizedIndexes();
    this.printFinalSummary();
  }

  private printProgressSummary(): void {
    const elapsed = Date.now() - this.stats.startTime.getTime();
    const elapsedMinutes = Math.round(elapsed / 60000);
    
    console.log(`\n📊 Progress Summary:`);
    console.log(`  - Symbols: ${this.stats.processedSymbols}/${this.stats.totalSymbols}`);
    console.log(`  - Klines processed: ${this.stats.processedKlines.toLocaleString()}`);
    console.log(`  - Ratings calculated: ${this.stats.totalRatings.toLocaleString()}`);
    console.log(`  - Errors: ${this.stats.errors}`);
    console.log(`  - Elapsed time: ${elapsedMinutes} minutes`);
    
    if (this.stats.processedSymbols > 0) {
      const avgTime = elapsedMinutes / this.stats.processedSymbols;
      const remaining = this.stats.totalSymbols - this.stats.processedSymbols;
      const eta = Math.round(remaining * avgTime);
      console.log(`  - ETA: ${eta} minutes remaining`);
    }
  }

  private printFinalSummary(): void {
    const elapsed = Date.now() - this.stats.startTime.getTime();
    const elapsedMinutes = Math.round(elapsed / 60000);
    
    console.log(`\n✅ Final Summary:`);
    console.log(`  - Total symbols processed: ${this.stats.processedSymbols}`);
    console.log(`  - Total klines processed: ${this.stats.processedKlines.toLocaleString()}`);
    console.log(`  - Total ratings calculated: ${this.stats.totalRatings.toLocaleString()}`);
    console.log(`  - Total errors: ${this.stats.errors}`);
    console.log(`  - Total time: ${elapsedMinutes} minutes`);
    
    if (this.stats.processedKlines > 0) {
      const rate = Math.round(this.stats.processedKlines / (elapsed / 1000));
      console.log(`  - Average rate: ${rate} klines/sec`);
    }
  }

  async createOptimizedIndexes(): Promise<void> {
    console.log('🔧 Creating optimized indexes for Glicko ratings...');

    try {
      await this.prisma.$executeRaw`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_glicko_ratings_symbol_timestamp_desc
        ON "glicko_ratings" (symbol, timestamp DESC);
      `;

      await this.prisma.$executeRaw`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_glicko_ratings_timestamp_desc
        ON "glicko_ratings" (timestamp DESC);
      `;

      await this.prisma.$executeRaw`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_glicko_ratings_rating_desc
        ON "glicko_ratings" (rating DESC);
      `;

      console.log('✅ Indexes created successfully');

    } catch (error) {
      console.error('⚠️ Some indexes may already exist or failed to create:', error);
    }
  }

  async validateCalculations(): Promise<boolean> {
    console.log('🔍 Validating Glicko-2 calculations...');

    try {
      // Check basic statistics
      const ratingStats = await this.prisma.glickoRatings.aggregate({
        _count: { id: true },
        _avg: { rating: true, ratingDeviation: true, volatility: true },
        _min: { rating: true, timestamp: true },
        _max: { rating: true, timestamp: true }
      });

      const uniqueSymbols = await this.prisma.glickoRatings.findMany({
        distinct: ['symbol'],
        select: { symbol: true }
      });

      console.log('📊 Validation Results:');
      console.log(`  - Total ratings: ${ratingStats._count.id?.toLocaleString()}`);
      console.log(`  - Unique symbols: ${uniqueSymbols.length}`);
      console.log(`  - Average rating: ${ratingStats._avg.rating?.toFixed(2)}`);
      console.log(`  - Average RD: ${ratingStats._avg.ratingDeviation?.toFixed(2)}`);
      console.log(`  - Average volatility: ${ratingStats._avg.volatility?.toFixed(4)}`);
      console.log(`  - Rating range: ${ratingStats._min.rating?.toFixed(2)} - ${ratingStats._max.rating?.toFixed(2)}`);
      console.log(`  - Date range: ${ratingStats._min.timestamp} to ${ratingStats._max.timestamp}`);

      // Validate rating distributions look reasonable
      const isValid = (
        ratingStats._count.id !== null && ratingStats._count.id > 0 &&
        ratingStats._avg.rating !== null && ratingStats._avg.rating > 1000 &&
        ratingStats._avg.ratingDeviation !== null && ratingStats._avg.ratingDeviation > 0 &&
        uniqueSymbols.length > 0
      );

      if (isValid) {
        console.log('✅ Validation passed');
      } else {
        console.log('❌ Validation failed');
      }

      return isValid;

    } catch (error) {
      console.error('❌ Validation error:', error);
      return false;
    }
  }

  async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up...');
    try {
      await this.prisma.$disconnect();
      console.log('✅ Database disconnected');
    } catch (error) {
      console.error('⚠️ Cleanup warning:', error);
    }
  }
}

// Main function
async function main() {
  const calculator = new GlickoCalculator();

  try {
    console.log('🚀 Starting Glicko-2 ratings calculation...');
    console.log('=' .repeat(60));

    await calculator.initialize();
    await calculator.calculateAllRatings();

    const isValid = await calculator.validateCalculations();
    
    if (isValid) {
      console.log('\n🎉 Glicko-2 ratings calculation completed successfully!');
      console.log('\nNext steps:');
      console.log('  1. Start the API server: npm run dev');
      console.log('  2. Check the /api/glicko/latest endpoint for recent ratings');
      console.log('  3. Run your first backtest with the calculated ratings');
    } else {
      console.log('\n❌ Validation failed. Please check the logs and data.');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n💥 Calculation failed:', error);
    process.exit(1);
  } finally {
    await calculator.cleanup();
  }
}

// Run if called directly
if (require.main === module) {
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Calculation interrupted by user');
    process.exit(0);
  });

  main().catch(console.error);
}

export { GlickoCalculator };