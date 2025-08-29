#!/usr/bin/env ts-node

/**
 * Analyze Klines Download Issues
 * 
 * This script investigates why certain trading pairs returned 0 klines
 * during the bulk download process.
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import axios from 'axios';

config();

interface PairAnalysis {
  symbol: string;
  recordsInDB: number;
  apiWorking: boolean;
  lastKlineTimestamp?: Date;
  firstKlineTimestamp?: Date;
  avgVolume?: number;
  error?: string;
}

class KlinesIssueAnalyzer {
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

  async analyzePair(symbol: string): Promise<PairAnalysis> {
    console.log(`\n📊 Analyzing ${symbol}...`);
    
    const analysis: PairAnalysis = {
      symbol,
      recordsInDB: 0,
      apiWorking: false
    };

    try {
      // Check records in database
      const count = await this.prisma.klines.count({
        where: { symbol }
      });
      analysis.recordsInDB = count;

      if (count > 0) {
        // Get timestamp range and average volume
        const stats = await this.prisma.klines.aggregate({
          where: { symbol },
          _min: { openTime: true },
          _max: { openTime: true },
          _avg: { volume: true }
        });

        analysis.firstKlineTimestamp = stats._min.openTime || undefined;
        analysis.lastKlineTimestamp = stats._max.openTime || undefined;
        analysis.avgVolume = stats._avg.volume ? Number(stats._avg.volume) : undefined;
      }

      // Test Binance API
      try {
        const response = await axios.get(this.BINANCE_API_URL, {
          params: {
            symbol,
            interval: '5m',
            limit: 5
          },
          timeout: 10000
        });

        if (response.data && Array.isArray(response.data) && response.data.length > 0) {
          analysis.apiWorking = true;
          
          // Check if recent data has volume
          const recentKlines = response.data;
          const hasVolume = recentKlines.some((kline: any) => parseFloat(kline[5]) > 0);
          
          if (!hasVolume) {
            analysis.error = "No recent trading volume - pair may be inactive";
          }
        } else {
          analysis.error = "API returned empty data";
        }
      } catch (apiError: any) {
        analysis.error = `API Error: ${apiError.message}`;
      }

    } catch (dbError: any) {
      analysis.error = `Database Error: ${dbError.message}`;
    }

    return analysis;
  }

  async analyzeProblematicPairs(): Promise<void> {
    // From the bulk download log, these pairs had 0 records
    const problematicPairs = [
      'AVAXETH', 'LINKBNB', 'SOLETH', 
      'POLBNB', 'POLBTC', 'POLETH', 'POLUSDT',
      'TRXETH', 'TRXUSDT', 'TRXXRP'
    ];

    // Compare with successful pairs
    const successfulPairs = [
      'BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'SOLUSDT', 'XRPUSDT'
    ];

    console.log('🔍 Analyzing Problematic Trading Pairs');
    console.log('='.repeat(80));

    const results: PairAnalysis[] = [];

    // Analyze problematic pairs
    console.log('\n❌ PROBLEMATIC PAIRS:');
    for (const symbol of problematicPairs) {
      const analysis = await this.analyzePair(symbol);
      results.push(analysis);
    }

    // Analyze successful pairs for comparison
    console.log('\n✅ SUCCESSFUL PAIRS (for comparison):');
    for (const symbol of successfulPairs) {
      const analysis = await this.analyzePair(symbol);
      results.push(analysis);
    }

    // Generate summary report
    this.generateSummaryReport(results, problematicPairs, successfulPairs);
  }

  private generateSummaryReport(
    results: PairAnalysis[], 
    problematicPairs: string[], 
    successfulPairs: string[]
  ): void {
    console.log('\n' + '='.repeat(80));
    console.log('📊 ANALYSIS SUMMARY');
    console.log('='.repeat(80));

    // Group results
    const problematic = results.filter(r => problematicPairs.includes(r.symbol));
    const successful = results.filter(r => successfulPairs.includes(r.symbol));

    console.log('\n🔍 PATTERNS IDENTIFIED:');

    // Pattern 1: Cross-crypto vs USDT pairs
    const usdtPairs = results.filter(r => r.symbol.endsWith('USDT'));
    const crossCryptoPairs = results.filter(r => !r.symbol.endsWith('USDT'));
    
    const usdtSuccess = usdtPairs.filter(r => r.recordsInDB > 0).length;
    const crossCryptoSuccess = crossCryptoPairs.filter(r => r.recordsInDB > 0).length;

    console.log(`\n1. USDT Pairs: ${usdtSuccess}/${usdtPairs.length} successful (${(usdtSuccess/usdtPairs.length*100).toFixed(1)}%)`);
    console.log(`   Cross-Crypto Pairs: ${crossCryptoSuccess}/${crossCryptoPairs.length} successful (${(crossCryptoSuccess/crossCryptoPairs.length*100).toFixed(1)}%)`);

    // Pattern 2: Volume analysis
    const lowVolumePairs = results.filter(r => r.avgVolume && r.avgVolume < 1).length;
    console.log(`\n2. Low Volume Pairs: ${lowVolumePairs} pairs with avg volume < 1`);

    // Pattern 3: POL token issues
    const polPairs = results.filter(r => r.symbol.startsWith('POL'));
    const polSuccess = polPairs.filter(r => r.recordsInDB > 0).length;
    console.log(`\n3. POL Token Pairs: ${polSuccess}/${polPairs.length} successful (POL is relatively new)`);

    console.log('\n📋 DETAILED BREAKDOWN:');
    console.log('-'.repeat(80));
    console.log('Symbol'.padEnd(12) + 'DB Records'.padEnd(12) + 'API Works'.padEnd(12) + 'Issue');
    console.log('-'.repeat(80));

    for (const result of results) {
      const dbRecords = result.recordsInDB.toLocaleString().padEnd(12);
      const apiWorks = (result.apiWorking ? 'Yes' : 'No').padEnd(12);
      const issue = result.error || (result.recordsInDB > 0 ? 'None' : 'Unknown');
      
      console.log(`${result.symbol.padEnd(12)}${dbRecords}${apiWorks}${issue}`);
    }

    console.log('\n🛠️ RECOMMENDED FIXES:');
    console.log('1. Retry failed downloads with extended date ranges');
    console.log('2. Check for delisted or inactive trading pairs');
    console.log('3. Implement better error handling for low-volume pairs');
    console.log('4. Consider excluding POL pairs that were listed after data range');
    console.log('5. Add volume threshold filtering to avoid inactive pairs');
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
    console.log('\n🧹 Cleanup complete');
  }
}

async function main() {
  try {
    const analyzer = new KlinesIssueAnalyzer();
    await analyzer.initialize();
    await analyzer.analyzeProblematicPairs();
    await analyzer.cleanup();
  } catch (error) {
    console.error('\n❌ Analysis failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { KlinesIssueAnalyzer };