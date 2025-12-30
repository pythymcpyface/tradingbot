#!/usr/bin/env ts-node

/**
 * Calculate Glicko-2 Ratings Script - UNIFIED PAIRWISE ENGINE ALGORITHM
 * Uses the tested GlickoEngine service.
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { GlickoEngine, GlickoRating } from '../src/services/GlickoEngine';
import { INITIAL_RATING } from '../src/utils/GlickoMath';

config();

interface KlineData {
  symbol: string;
  openTime: Date;
  close: number;
  open: number;
  volume: number;
  takerBuyBaseAssetVolume: number;
}

class GlickoScriptRunner {
  private prisma: PrismaClient;
  private engine: GlickoEngine;

  constructor() {
    this.prisma = new PrismaClient();
    this.engine = new GlickoEngine();
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

  private async findRelevantPairs(coins: string[]): Promise<Map<string, string[]>> {
    console.log('🔍 Finding relevant trading pairs...');
    const coinPairs = new Map<string, string[]>();
    
    for (const coin of coins) {
      const relevantPairs: string[] = [];
      for (const otherCoin of coins) {
        if (otherCoin !== coin) {
          const pair1 = `${coin}${otherCoin}`;
          const pair2 = `${otherCoin}${coin}`;
          
          const pair1Exists = await this.prisma.klines.findFirst({ where: { symbol: pair1 }, select: { id: true } });
          const pair2Exists = await this.prisma.klines.findFirst({ where: { symbol: pair2 }, select: { id: true } });
          
          if (pair1Exists) relevantPairs.push(pair1);
          if (pair2Exists) relevantPairs.push(pair2);
        }
      }
      coinPairs.set(coin, relevantPairs);
    }
    return coinPairs;
  }

  async calculateAllRatings(coins: string[], startTime: Date, endTime: Date): Promise<void> {
    console.log('🚀 Starting PAIRWISE Glicko-2 rating calculations (TDD Engine)...');
    
    // 1. Identify Pairs
    const coinPairs = await this.findRelevantPairs(coins);
    
    // Build metadata map
    const pairMetadata = new Map<string, { base: string, quote: string }>();
    for (const [coin, pairs] of coinPairs) {
      for (const pair of pairs) {
        if (!pairMetadata.has(pair)) {
            const base = coins.find(c => pair.startsWith(c) && pair !== c); 
            if (base) {
                const quote = pair.substring(base.length);
                if (coins.includes(quote)) {
                    pairMetadata.set(pair, { base, quote });
                }
            }
        }
      }
    }
    
    const allPairs = Array.from(pairMetadata.keys());
    console.log(`ℹ️  Identified ${pairMetadata.size} unique pairwise matchups.`);

    if (allPairs.length === 0) {
        console.warn('⚠️ No relevant trading pairs found.');
        return;
    }

    // 2. Initialize Results Storage
    const results = new Map<string, Array<{ timestamp: Date; rating: GlickoRating; performanceScore: number }>>();
    for (const coin of coins) {
      results.set(coin, []);
      this.engine.ensureCoinExists(coin, startTime);
    }

    // 3. Process Data in Chunks
    const chunkSizeMs = 30 * 24 * 60 * 60 * 1000; // 30 days
    const totalTimeRange = endTime.getTime() - startTime.getTime();
    const totalChunks = Math.ceil(totalTimeRange / chunkSizeMs);

    let totalProcessedKlines = 0;
    let currentChunk = 0;

    for (let currentTime = startTime.getTime(); currentTime < endTime.getTime(); currentTime += chunkSizeMs) {
      currentChunk++;
      const chunkStartTime = new Date(currentTime);
      const chunkEndTime = new Date(Math.min(currentTime + chunkSizeMs, endTime.getTime()));

      console.log(`  📈 Processing chunk ${currentChunk}/${totalChunks}: ${chunkStartTime.toISOString().split('T')[0]} to ${chunkEndTime.toISOString().split('T')[0]}`);

      const chunkKlines = await this.prisma.klines.findMany({
        where: {
          symbol: { in: allPairs },
          openTime: { gte: chunkStartTime, lt: chunkEndTime }
        },
        select: {
          symbol: true,
          openTime: true,
          close: true,
          open: true,
          volume: true,
          takerBuyBaseAssetVolume: true
        },
        orderBy: { openTime: 'asc' }
      });

      if (chunkKlines.length > 0) {
        totalProcessedKlines += chunkKlines.length;
        await this.processChunk(chunkKlines, pairMetadata, results);
      }
    }

    console.log(`✅ Completed processing ${totalProcessedKlines.toLocaleString()} klines.`);

    // 4. Save Results
    console.log('');
    console.log('💾 Saving results to database...');
    for (const coin of coins) {
        const coinResults = results.get(coin) || [];
        if (coinResults.length > 0) {
            await this.saveRatings(coin, coinResults);
        }
    }
    
    await this.displayFinalSummary(coins);
  }

  private async processChunk(
    klines: any[], 
    pairMetadata: Map<string, { base: string, quote: string }>,
    results: Map<string, Array<{ timestamp: Date; rating: GlickoRating; performanceScore: number }>>
  ) {
      // Group by timestamp
      const klinesByTimestamp = new Map<string, any[]>();
      for (const kline of klines) {
          const t = kline.openTime.toISOString();
          if (!klinesByTimestamp.has(t)) klinesByTimestamp.set(t, []);
          klinesByTimestamp.get(t)!.push(kline);
      }

      const timestamps = Array.from(klinesByTimestamp.keys()).sort();

      for (const timestamp of timestamps) {
          const timestampKlines = klinesByTimestamp.get(timestamp)!;
          // Sort for determinism
          timestampKlines.sort((a, b) => a.symbol.localeCompare(b.symbol));

          const updatedCoins = new Set<string>();

          for (const kline of timestampKlines) {
              const meta = pairMetadata.get(kline.symbol);
              if (!meta) continue;

              const { base, quote } = meta;
              const priceChange = (Number(kline.close) - Number(kline.open)) / Number(kline.open);
              const tsDate = new Date(timestamp);
              
              const volume = Number(kline.volume);
              const takerBuyVolume = Number(kline.takerBuyBaseAssetVolume);

              // Engine handles logic with volume metrics
              this.engine.processGame(
                  base, 
                  quote, 
                  priceChange, 
                  tsDate, 
                  { volume, takerBuyVolume }
              );
              
              updatedCoins.add(base);
              updatedCoins.add(quote);
          }

          // Normalize ratings to prevent drift
          this.engine.normalizeRatings();

          // Snapshot state
          for (const coin of updatedCoins) {
              const state = this.engine.getCoinState(coin);
              if (state) {
                  results.get(coin)!.push({
                      timestamp: new Date(timestamp),
                      rating: { ...state.rating },
                      performanceScore: 5.0 // Placeholder
                  });
              }
          }
      }
  }

  async saveRatings(
    coin: string,
    ratings: Array<{ timestamp: Date; rating: GlickoRating; performanceScore: number }>
  ): Promise<void> {
    const ratingData = ratings.map(r => ({
      symbol: coin,
      timestamp: r.timestamp,
      rating: r.rating.rating, 
      ratingDeviation: r.rating.ratingDeviation, 
      volatility: r.rating.volatility, 
      performanceScore: r.performanceScore
    }));

    // Batch delete and insert
    try {
        await this.prisma.glickoRatings.deleteMany({
            where: {
                symbol: coin,
                timestamp: {
                    gte: ratings[0].timestamp,
                    lte: ratings[ratings.length - 1].timestamp
                }
            }
        });

        await this.prisma.glickoRatings.createMany({
            data: ratingData,
            skipDuplicates: true
        });
        
        console.log(`  ✅ Saved ${ratingData.length} ratings for ${coin}`);
    } catch (e) {
        console.error(`Error saving ${coin}`, e);
    }
  }
  
  async displayFinalSummary(coins: string[]): Promise<void> {
      console.log('');
      console.log('🎯 Final Ratings Summary (Engine State):');
      for (const coin of coins) {
          const state = this.engine.getCoinState(coin);
          if (state) {
              console.log(`  ${coin}: Rating=${state.rating.rating.toFixed(0)}, RD=${state.rating.ratingDeviation.toFixed(0)}, Vol=${state.rating.volatility.toFixed(4)}`);
          }
      }
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
    console.log('');
    console.log('🧹 Database connection closed');
  }
}

// -- Main Execution --

function parseArguments(): { coins: string[], startTime: Date | null, endTime: Date | null } {
    const args = process.argv.slice(2);
    if (args.length === 0 && process.env.BASE_COINS) {
        const coins = process.env.BASE_COINS.split(',').map(c => c.trim());
        const start = process.env.START_DATE ? new Date(process.env.START_DATE) : null;
        const end = process.env.END_DATE ? new Date(process.env.END_DATE) : null;
        return { coins, startTime: start, endTime: end };
    }
    if (args.length < 1) {
        console.error('Usage: npm run calculateGlickoRatings "BTC,ETH" [START] [END]');
        process.exit(1);
    }
    const coins = args[0].split(',').map(c => c.trim());
    const start = args[1] ? new Date(args[1]) : null;
    const end = args[2] ? new Date(args[2]) : null;
    return { coins, startTime: start, endTime: end };
}

async function main() {
    const runner = new GlickoScriptRunner();
    try {
        await runner.initialize();
        const { coins, startTime, endTime } = parseArguments();
        
        // Default dates if null
        let s = startTime;
        let e = endTime;
        
        if (!s || !e) {
             const range = await (runner as any).prisma.klines.aggregate({ _min: { openTime: true }, _max: { closeTime: true } });
             if (!s) s = range._min.openTime;
             if (!e) e = range._max.closeTime;
        }

        if (!s || !e) throw new Error('Could not determine date range');

        await runner.calculateAllRatings(coins, s, e);

        console.log('');
        console.log('🎉 Glicko-2 rating calculation completed successfully!');

        // Run validation script
        console.log('');
        console.log('🔍 Running glicko ratings validation...');
        console.log('=' .repeat(70));
        const { execSync } = require('child_process');
        try {
            execSync('npx ts-node scripts/validate-glicko-integrity.ts', { stdio: 'inherit' });
        } catch (validationError) {
            console.warn('');
            console.warn('⚠️  Glicko ratings validation encountered issues (see above)');
        }

    } catch (error) {
        console.error('Fatal Error:', error);
        process.exit(1);
    } finally {
        await runner.cleanup();
    }
}

if (require.main === module) {
    main().catch(console.error);
}