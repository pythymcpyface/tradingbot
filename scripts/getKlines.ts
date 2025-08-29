#!/usr/bin/env ts-node

/**
 * Get Klines Script
 * 
 * This script downloads klines from the Binance API for a set of trading pairs
 * with configurable interval and saves the data in the klines table.
 * 
 * Arguments: tradingPairs, startTime, endTime, interval (optional, defaults to 1h)
 * Supported intervals: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M
 * As specified in SPEC.md Stage 3.3
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import axios from 'axios';

config();

interface BinanceKline {
  0: number;    // Open time
  1: string;    // Open
  2: string;    // High
  3: string;    // Low
  4: string;    // Close
  5: string;    // Volume
  6: number;    // Close time
  7: string;    // Quote asset volume
  8: number;    // Number of trades
  9: string;    // Taker buy base asset volume
  10: string;   // Taker buy quote asset volume
  11: string;   // Ignore
}

interface KlineRecord {
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

class KlinesDownloader {
  private prisma: PrismaClient;
  private readonly BINANCE_API_URL = 'https://api.binance.com/api/v3/klines';
  private readonly BATCH_SIZE = 1000; // Maximum klines per request
  private readonly DELAY_MS = 100; // Delay between requests to avoid rate limits
  private interval: string;
  private intervalMs: number; // Interval in milliseconds

  constructor(interval: string = '1h') {
    this.prisma = new PrismaClient();
    this.interval = interval;
    this.intervalMs = this.getIntervalInMs(interval);
  }

  /**
   * Convert interval string to milliseconds
   */
  private getIntervalInMs(interval: string): number {
    const intervalMap: { [key: string]: number } = {
      '1m': 60 * 1000,
      '3m': 3 * 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '2h': 2 * 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '8h': 8 * 60 * 60 * 1000,
      '12h': 12 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
      '3d': 3 * 24 * 60 * 60 * 1000,
      '1w': 7 * 24 * 60 * 60 * 1000,
      '1M': 30 * 24 * 60 * 60 * 1000 // Approximation for 1 month
    };

    if (!intervalMap[interval]) {
      throw new Error(`Unsupported interval: ${interval}. Supported intervals: ${Object.keys(intervalMap).join(', ')}`);
    }

    return intervalMap[interval];
  }

  /**
   * Validate that the interval is supported by Binance API
   */
  private validateInterval(interval: string): void {
    const validIntervals = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'];
    if (!validIntervals.includes(interval)) {
      throw new Error(`Invalid interval: ${interval}. Valid intervals: ${validIntervals.join(', ')}`);
    }
  }

  async initialize(): Promise<void> {
    try {
      await this.prisma.$connect();
      console.log('✅ Connected to database');
      this.validateInterval(this.interval);
      console.log(`📊 Using interval: ${this.interval} (${this.intervalMs}ms)`);
    } catch (error) {
      console.error('❌ Database connection failed:', error);
      throw error;
    }
  }

  /**
   * Download klines for a single symbol within a date range with progressive saving
   */
  async downloadKlinesForSymbol(
    symbol: string,
    startTime: Date,
    endTime: Date
  ): Promise<number> {
    console.log(`📊 Downloading klines for ${symbol}...`);

    let totalSaved = 0;
    let currentStartTime = startTime.getTime();
    const endTimeMs = endTime.getTime();
    const SAVE_BATCH_SIZE = 10000; // Save every 10k records to avoid memory issues

    let batchKlines: KlineRecord[] = [];

    while (currentStartTime < endTimeMs) {
      // Calculate end time for this batch (max 1000 intervals)
      const batchEndTime = Math.min(
        currentStartTime + (this.BATCH_SIZE * this.intervalMs),
        endTimeMs
      );

      try {
        console.log(`  📅 Fetching ${symbol} from ${new Date(currentStartTime).toISOString()} to ${new Date(batchEndTime).toISOString()}`);

        const response = await axios.get(this.BINANCE_API_URL, {
          params: {
            symbol: symbol,
            interval: this.interval,
            startTime: currentStartTime,
            endTime: batchEndTime,
            limit: this.BATCH_SIZE
          }
        });

        const rawKlines: BinanceKline[] = response.data;

        if (rawKlines.length === 0) {
          console.log(`  ⚠️ No data received for ${symbol} in this time range`);
          break;
        }

        // Transform raw klines to our format
        const transformedKlines = rawKlines.map(kline => ({
          symbol: symbol,
          openTime: new Date(kline[0]),
          closeTime: new Date(kline[6]),
          open: parseFloat(kline[1]),
          high: parseFloat(kline[2]),
          low: parseFloat(kline[3]),
          close: parseFloat(kline[4]),
          volume: parseFloat(kline[5]),
          quoteAssetVolume: parseFloat(kline[7]),
          numberOfTrades: kline[8],
          takerBuyBaseAssetVolume: parseFloat(kline[9]),
          takerBuyQuoteAssetVolume: parseFloat(kline[10]),
          ignore: parseFloat(kline[11])
        }));

        batchKlines.push(...transformedKlines);

        // Save progressively when we hit the batch size
        if (batchKlines.length >= SAVE_BATCH_SIZE) {
          console.log(`  💾 Saving batch of ${batchKlines.length} klines for ${symbol}...`);
          await this.saveKlinesInBatches(batchKlines);
          totalSaved += batchKlines.length;
          console.log(`  ✅ Saved ${batchKlines.length} klines, total saved: ${totalSaved}`);
          batchKlines = []; // Clear the batch
        }

        // Update start time for next batch
        const lastKlineTime = rawKlines[rawKlines.length - 1][6];
        currentStartTime = lastKlineTime + 1; // Start from next millisecond

        console.log(`  ✅ Downloaded ${rawKlines.length} klines for ${symbol} (Pending: ${batchKlines.length}, Saved: ${totalSaved})`);

        // Rate limiting delay
        if (this.DELAY_MS > 0) {
          await new Promise(resolve => setTimeout(resolve, this.DELAY_MS));
        }

      } catch (error: any) {
        if (error.response?.status === 429) {
          console.warn(`⚠️ Rate limited for ${symbol}, waiting 60 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 60000));
          continue; // Retry the same batch
        } else {
          console.error(`❌ Error downloading ${symbol}:`, error.message);
          throw error;
        }
      }
    }

    // Save any remaining klines
    if (batchKlines.length > 0) {
      console.log(`  💾 Saving final batch of ${batchKlines.length} klines for ${symbol}...`);
      await this.saveKlinesInBatches(batchKlines);
      totalSaved += batchKlines.length;
      console.log(`  ✅ Saved final batch, total saved: ${totalSaved}`);
    }

    console.log(`✅ Downloaded and saved total of ${totalSaved} klines for ${symbol}`);
    return totalSaved;
  }

  /**
   * Save klines to database in batches
   */
  async saveKlinesInBatches(klines: KlineRecord[], batchSize: number = 10000): Promise<void> {
    console.log(`💾 Saving ${klines.length} klines to database...`);

    let savedCount = 0;
    for (let i = 0; i < klines.length; i += batchSize) {
      const batch = klines.slice(i, i + batchSize);
      
      try {
        const result = await this.prisma.klines.createMany({
          data: batch,
          skipDuplicates: true
        });

        savedCount += result.count;
        const progress = ((i + batch.length) / klines.length * 100).toFixed(1);
        console.log(`  📈 Progress: ${progress}% (${savedCount} saved, ${result.count} new)`);

      } catch (error) {
        console.error(`❌ Error saving batch starting at index ${i}:`, error);
        throw error;
      }
    }

    console.log(`✅ Successfully saved ${savedCount} klines to database`);
  }

  /**
   * Download klines for multiple trading pairs
   */
  async downloadKlines(
    tradingPairs: string[],
    startTime: Date,
    endTime: Date
  ): Promise<void> {
    console.log('🚀 Starting klines download process...');
    console.log(`📊 Trading pairs: ${tradingPairs.length}`);
    console.log(`📅 Date range: ${startTime.toISOString()} to ${endTime.toISOString()}`);

    let completedPairs = 0;
    let totalKlinesSaved = 0;

    for (const symbol of tradingPairs) {
      try {
        console.log(`\n[${completedPairs + 1}/${tradingPairs.length}] Processing ${symbol}...`);
        
        const savedCount = await this.downloadKlinesForSymbol(symbol, startTime, endTime);
        
        if (savedCount > 0) {
          totalKlinesSaved += savedCount;
          console.log(`✅ ${symbol} completed: ${savedCount} klines saved to database`);
        } else {
          console.log(`⚠️ No klines downloaded for ${symbol}`);
        }
        
        completedPairs++;

      } catch (error) {
        console.error(`❌ Failed to download/save ${symbol}:`, error);
        // Continue with next symbol rather than failing completely
      }
    }

    console.log(`\n📊 Download Summary:`);
    console.log(`  - Pairs processed: ${completedPairs}/${tradingPairs.length}`);
    console.log(`  - Total klines saved to database: ${totalKlinesSaved.toLocaleString()}`);
  }

  /**
   * Validate downloaded data
   */
  async validateDownloadedData(tradingPairs: string[]): Promise<void> {
    console.log('🔍 Validating downloaded data...');

    for (const symbol of tradingPairs) {
      const count = await this.prisma.klines.count({
        where: { symbol }
      });

      console.log(`  ${symbol}: ${count.toLocaleString()} records`);
    }

    // Get overall statistics
    const totalRecords = await this.prisma.klines.count();
    const dateRange = await this.prisma.klines.aggregate({
      _min: { openTime: true },
      _max: { closeTime: true }
    });

    console.log(`\n📈 Validation Summary:`);
    console.log(`  - Total records: ${totalRecords.toLocaleString()}`);
    console.log(`  - Date range: ${dateRange._min.openTime} to ${dateRange._max.closeTime}`);
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
    console.log('🧹 Database connection closed');
  }
}

/**
 * Parse command line arguments
 */
function parseArguments(): {
  tradingPairs: string[];
  startTime: Date;
  endTime: Date;
  interval: string;
} {
  const args = process.argv.slice(2);

  if (args.length < 3 || args.length > 4) {
    console.error('❌ Invalid arguments. Usage:');
    console.error('npm run getKlines "BTCUSDT,ETHUSDT,ADAUSDT" "2021-08-08" "2025-08-08" [interval]');
    console.error('');
    console.error('Arguments:');
    console.error('  tradingPairs: Comma-separated list of trading pairs');
    console.error('  startTime: Start date (YYYY-MM-DD)');
    console.error('  endTime: End date (YYYY-MM-DD)');
    console.error('  interval: Optional. Kline interval (default: 1h)');
    console.error('            Supported: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M');
    console.error('');
    console.error('Examples:');
    console.error('  npm run getKlines "BTCUSDT,ETHUSDT" "2021-08-08" "2025-08-08"');
    console.error('  npm run getKlines "BTCUSDT,ETHUSDT" "2021-08-08" "2025-08-08" "1m"');
    console.error('  npm run getKlines "BTCUSDT,ETHUSDT" "2021-08-08" "2025-08-08" "5m"');
    process.exit(1);
  }

  const [tradingPairsArg, startTimeArg, endTimeArg, intervalArg] = args;

  // Parse trading pairs
  const tradingPairs = tradingPairsArg.split(',').map(pair => pair.trim());

  // Parse dates
  const startTime = new Date(startTimeArg);
  const endTime = new Date(endTimeArg);

  // Parse interval (default to '1h' if not provided)
  const interval = intervalArg || '1h';

  // Validate dates
  if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
    console.error('❌ Invalid date format. Use YYYY-MM-DD format');
    process.exit(1);
  }

  if (startTime >= endTime) {
    console.error('❌ Start time must be before end time');
    process.exit(1);
  }

  return { tradingPairs, startTime, endTime, interval };
}

/**
 * Main execution function
 */
async function main() {
  try {
    console.log('🎯 Starting klines download script...');
    console.log('=' .repeat(60));

    const { tradingPairs, startTime, endTime, interval } = parseArguments();
    const downloader = new KlinesDownloader(interval);

    await downloader.initialize();

    console.log(`📋 Configuration:`);
    console.log(`  - Trading pairs: ${tradingPairs.join(', ')}`);
    console.log(`  - Start time: ${startTime.toISOString()}`);
    console.log(`  - End time: ${endTime.toISOString()}`);
    console.log(`  - Interval: ${interval}`);

    await downloader.downloadKlines(tradingPairs, startTime, endTime);
    await downloader.validateDownloadedData(tradingPairs);

    console.log('\n🎉 Klines download completed successfully!');

    await downloader.cleanup();

  } catch (error) {
    console.error('\n💥 Klines download failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { KlinesDownloader };