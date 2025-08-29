#!/usr/bin/env ts-node

/**
 * Fix Failed Klines Downloads
 * 
 * This script addresses the issues found in the bulk download process:
 * 1. Retry downloads for pairs that returned 0 records
 * 2. Use appropriate date ranges for different pairs
 * 3. Handle low-volume/inactive pairs gracefully
 * 4. Provide detailed logging and error handling
 */

import { TurboKlinesDownloader } from './getKlines-turbo';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import axios from 'axios';

config();

interface PairConfig {
  symbol: string;
  startDate: Date;
  endDate: Date;
  reason?: string;
  expectedRecords?: number;
}

class FailedKlinesFixerUpper {
  private prisma: PrismaClient;
  private downloader: TurboKlinesDownloader;
  private readonly BINANCE_API_URL = 'https://api.binance.com/api/v3/klines';

  constructor() {
    this.prisma = new PrismaClient();
    this.downloader = new TurboKlinesDownloader('5m');
  }

  async initialize(): Promise<void> {
    await this.prisma.$connect();
    await this.downloader.initialize();
    console.log('✅ Connected to database and initialized downloader');
  }

  private async getExchangeInfo(): Promise<any> {
    try {
      const response = await axios.get('https://api.binance.com/api/v3/exchangeInfo');
      return response.data;
    } catch (error) {
      console.error('❌ Failed to get exchange info:', error);
      return null;
    }
  }

  private async getSymbolListingDate(symbol: string): Promise<Date | null> {
    try {
      // Try to find earliest available data
      const response = await axios.get(this.BINANCE_API_URL, {
        params: {
          symbol,
          interval: '1d',
          limit: 1,
          startTime: 1420070400000 // Jan 1, 2015
        },
        timeout: 10000
      });

      if (response.data && response.data.length > 0) {
        return new Date(response.data[0][0]);
      }
    } catch (error) {
      console.warn(`⚠️ Could not get listing date for ${symbol}`);
    }
    return null;
  }

  private async generateOptimalConfig(): Promise<PairConfig[]> {
    console.log('🔍 Generating optimal download configurations...');
    
    const configs: PairConfig[] = [];
    const exchangeInfo = await this.getExchangeInfo();

    // Pairs that failed in bulk download
    const failedPairs = [
      'AVAXETH', 'LINKBNB', 'SOLETH', 
      'POLBNB', 'POLBTC', 'POLETH', 'POLUSDT'
    ];

    const now = new Date();
    const defaultEnd = new Date(now.getTime() - 24 * 60 * 60 * 1000); // Yesterday to avoid incomplete data

    for (const symbol of failedPairs) {
      console.log(`📊 Analyzing ${symbol}...`);

      // Check current records in DB
      const currentCount = await this.prisma.klines.count({
        where: { symbol }
      });

      if (currentCount > 0) {
        console.log(`  ✅ ${symbol} already has ${currentCount} records, skipping`);
        continue;
      }

      let startDate: Date;
      let reason: string;

      if (symbol.startsWith('POL')) {
        // POL tokens were likely listed recently
        startDate = new Date('2024-09-13'); // Around when POL replaced MATIC
        reason = 'POL token listing date (replaced MATIC)';
      } else {
        // Try to get actual listing date
        const listingDate = await this.getSymbolListingDate(symbol);
        if (listingDate) {
          startDate = listingDate;
          reason = 'Earliest available data from API';
        } else {
          // Fall back to conservative date
          startDate = new Date('2022-01-01');
          reason = 'Conservative fallback date';
        }
      }

      // Test if the pair has any recent activity
      try {
        const testResponse = await axios.get(this.BINANCE_API_URL, {
          params: {
            symbol,
            interval: '5m',
            limit: 10
          },
          timeout: 10000
        });

        const hasVolume = testResponse.data.some((kline: any) => parseFloat(kline[5]) > 0);
        if (!hasVolume) {
          console.log(`  ⚠️ ${symbol} has no recent volume, may be inactive`);
          reason += ' (low activity)';
        }
      } catch (error) {
        console.log(`  ❌ ${symbol} failed API test, may be delisted`);
        continue;
      }

      configs.push({
        symbol,
        startDate,
        endDate: defaultEnd,
        reason
      });
    }

    return configs;
  }

  async fixFailedDownloads(): Promise<void> {
    console.log('🛠️ Starting Failed Klines Download Fix');
    console.log('='.repeat(80));

    const configs = await this.generateOptimalConfig();

    if (configs.length === 0) {
      console.log('✅ No pairs need fixing - all have data or are inactive');
      return;
    }

    console.log(`\n📋 Found ${configs.length} pairs to fix:`);
    configs.forEach((config, i) => {
      console.log(`  ${i + 1}. ${config.symbol}: ${config.startDate.toISOString().split('T')[0]} to ${config.endDate.toISOString().split('T')[0]}`);
      console.log(`     Reason: ${config.reason}`);
    });

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < configs.length; i++) {
      const config = configs[i];
      console.log(`\n[${i + 1}/${configs.length}] Fixing ${config.symbol}...`);
      console.log(`📅 Date range: ${config.startDate.toISOString().split('T')[0]} to ${config.endDate.toISOString().split('T')[0]}`);

      try {
        await this.downloader.downloadTurbo([config.symbol], config.startDate, config.endDate);
        
        // Verify download
        const finalCount = await this.prisma.klines.count({
          where: { symbol: config.symbol }
        });

        if (finalCount > 0) {
          console.log(`✅ Successfully downloaded ${finalCount} records for ${config.symbol}`);
          successCount++;
        } else {
          console.log(`⚠️ Download completed but no records found for ${config.symbol} - likely inactive pair`);
          failCount++;
        }

        // Brief pause between downloads
        if (i < configs.length - 1) {
          console.log('⏸️ Pausing 30 seconds before next download...');
          await new Promise(resolve => setTimeout(resolve, 30000));
        }

      } catch (error: any) {
        console.error(`❌ Failed to download ${config.symbol}:`, error.message);
        failCount++;
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('🎉 DOWNLOAD FIX COMPLETE');
    console.log('='.repeat(80));
    console.log(`✅ Successful: ${successCount}`);
    console.log(`❌ Failed: ${failCount}`);
    console.log(`📊 Total attempted: ${configs.length}`);

    if (failCount > 0) {
      console.log('\n⚠️ Some downloads failed. This could be due to:');
      console.log('   - Inactive or delisted trading pairs');
      console.log('   - Network connectivity issues');
      console.log('   - API rate limiting');
      console.log('   - Invalid date ranges for specific pairs');
      console.log('\n🔄 You can re-run this script to retry failed downloads');
    }
  }

  async cleanup(): Promise<void> {
    await this.downloader.cleanup();
    await this.prisma.$disconnect();
    console.log('🧹 Cleanup complete');
  }
}

async function main() {
  try {
    const fixer = new FailedKlinesFixerUpper();
    await fixer.initialize();
    await fixer.fixFailedDownloads();
    await fixer.cleanup();
  } catch (error) {
    console.error('\n❌ Fix process failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { FailedKlinesFixerUpper };