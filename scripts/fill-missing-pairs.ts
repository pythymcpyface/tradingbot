#!/usr/bin/env ts-node

/**
 * Fill Missing Trading Pairs Script
 * 
 * This script identifies missing trading pairs, finds their actual launch dates,
 * and downloads available data for each pair.
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import axios from 'axios';

config();

interface PairInfo {
  symbol: string;
  launchDate: Date | null;
  recordCount: number;
}

class MissingPairsFiller {
  private prisma: PrismaClient;
  private readonly BINANCE_API_URL = 'https://api.binance.com/api/v3/klines';
  
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
   * Get trading pairs from environment variable
   */
  private getTradingPairsFromEnv(): string[] {
    const tradingPairsEnv = process.env.TRADING_PAIRS;
    if (!tradingPairsEnv) {
      throw new Error('TRADING_PAIRS not found in environment variables');
    }
    return tradingPairsEnv.split(',').map(pair => pair.trim());
  }

  /**
   * Check which pairs are missing or have minimal data
   */
  async identifyMissingPairs(): Promise<PairInfo[]> {
    console.log('🔍 Identifying missing or incomplete trading pairs...');
    
    const allPairs = this.getTradingPairsFromEnv();
    const pairInfos: PairInfo[] = [];
    
    for (const symbol of allPairs) {
      const count = await this.prisma.klines.count({
        where: { symbol }
      });
      
      pairInfos.push({
        symbol,
        launchDate: null,
        recordCount: count
      });
    }
    
    // Identify pairs with 0 records or very few records (less than 50k)
    const missingPairs = pairInfos.filter(pair => pair.recordCount < 50000);
    
    console.log(`📊 Found ${missingPairs.length} pairs needing data:`);
    missingPairs.forEach(pair => {
      console.log(`  - ${pair.symbol}: ${pair.recordCount.toLocaleString()} records`);
    });
    
    return missingPairs;
  }

  /**
   * Find the actual launch date for a trading pair
   */
  async findLaunchDate(symbol: string): Promise<Date | null> {
    try {
      console.log(`🔍 Finding launch date for ${symbol}...`);
      
      // Get the earliest available data (limit 1000 to go back far enough)
      const response = await axios.get(this.BINANCE_API_URL, {
        params: {
          symbol: symbol,
          interval: '1d',
          limit: 1000
        }
      });
      
      const klines = response.data;
      if (klines && klines.length > 0) {
        const launchTimestamp = klines[0][0]; // First kline's open time
        const launchDate = new Date(launchTimestamp);
        console.log(`  ✅ ${symbol} launched: ${launchDate.toISOString().split('T')[0]}`);
        return launchDate;
      }
      
      return null;
    } catch (error: any) {
      if (error.response?.status === 400) {
        console.log(`  ❌ ${symbol}: Invalid symbol (doesn't exist on Binance)`);
      } else {
        console.log(`  ⚠️ ${symbol}: Error fetching data - ${error.message}`);
      }
      return null;
    }
  }

  /**
   * Download data for a specific pair from its launch date
   */
  async downloadPairData(symbol: string, launchDate: Date): Promise<number> {
    try {
      console.log(`\n📥 Downloading ${symbol} data from ${launchDate.toISOString().split('T')[0]}...`);
      
      // Calculate end date (July 19, 2025)
      const endDate = new Date('2025-07-19');
      
      // Use our existing KlinesDownloader from getKlines.ts
      const { spawn } = require('child_process');
      
      return new Promise((resolve, reject) => {
        const process = spawn('npm', ['run', 'getKlines', symbol, launchDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0], '5m'], {
          stdio: 'inherit'
        });
        
        process.on('close', (code: number) => {
          if (code === 0) {
            console.log(`✅ ${symbol} download completed`);
            resolve(0);
          } else {
            console.log(`❌ ${symbol} download failed with code ${code}`);
            reject(new Error(`Download failed with code ${code}`));
          }
        });
      });
    } catch (error) {
      console.error(`❌ Error downloading ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Main execution function
   */
  async fillMissingPairs(): Promise<void> {
    console.log('🚀 Starting missing pairs identification and download...');
    console.log('=' .repeat(70));

    // Step 1: Identify missing pairs
    const missingPairs = await this.identifyMissingPairs();
    
    if (missingPairs.length === 0) {
      console.log('🎉 No missing pairs found! All pairs have sufficient data.');
      return;
    }

    // Step 2: Find launch dates for missing pairs
    console.log('\n🔍 Finding launch dates for missing pairs...');
    for (const pairInfo of missingPairs) {
      pairInfo.launchDate = await this.findLaunchDate(pairInfo.symbol);
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Step 3: Download data for pairs that exist
    const validPairs = missingPairs.filter(pair => pair.launchDate !== null);
    const invalidPairs = missingPairs.filter(pair => pair.launchDate === null);

    console.log(`\n📊 Summary:`);
    console.log(`  - Valid pairs to download: ${validPairs.length}`);
    console.log(`  - Invalid pairs (don't exist): ${invalidPairs.length}`);

    if (invalidPairs.length > 0) {
      console.log(`\n❌ Invalid pairs (not available on Binance):`);
      invalidPairs.forEach(pair => console.log(`  - ${pair.symbol}`));
    }

    if (validPairs.length > 0) {
      console.log(`\n📥 Downloading data for valid pairs...`);
      for (const pairInfo of validPairs) {
        if (pairInfo.launchDate) {
          try {
            await this.downloadPairData(pairInfo.symbol, pairInfo.launchDate);
          } catch (error) {
            console.error(`❌ Failed to download ${pairInfo.symbol}:`, error);
            // Continue with next pair
          }
        }
      }
    }

    console.log('\n🎉 Missing pairs processing completed!');
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
    console.log('🧹 Database connection closed');
  }
}

/**
 * Main execution function
 */
async function main() {
  try {
    const filler = new MissingPairsFiller();
    await filler.initialize();
    await filler.fillMissingPairs();
    await filler.cleanup();
  } catch (error) {
    console.error('💥 Script failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { MissingPairsFiller };