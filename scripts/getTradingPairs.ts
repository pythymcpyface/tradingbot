#!/usr/bin/env ts-node

/**
 * Get Trading Pairs Script
 * 
 * This script takes an argument 'coins' and calculates which trading pairs 
 * from Binance exist where each coin in the pair is one of the coins in the argument.
 * 
 * As specified in SPEC.md Stage 3.1
 */

import axios from 'axios';
import { config } from 'dotenv';

config();

interface BinanceExchangeInfo {
  symbols: Array<{
    symbol: string;
    status: string;
    baseAsset: string;
    quoteAsset: string;
    isSpotTradingAllowed: boolean;
    permissions: string[];
  }>;
}

class TradingPairsGenerator {
  private readonly BINANCE_API_URL = 'https://api.binance.com/api/v3/exchangeInfo';

  /**
   * Fetch all available trading pairs from Binance
   */
  async fetchBinanceExchangeInfo(): Promise<BinanceExchangeInfo> {
    try {
      console.log('🔄 Fetching Binance exchange information...');
      const response = await axios.get(this.BINANCE_API_URL);
      console.log('✅ Successfully fetched exchange information');
      return response.data;
    } catch (error) {
      console.error('❌ Error fetching Binance exchange info:', error);
      throw error;
    }
  }

  /**
   * Generate valid trading pairs from given coins
   */
  async generateTradingPairs(coins: string[]): Promise<string[]> {
    console.log(`🎯 Generating trading pairs for coins: ${coins.join(', ')}`);
    
    // Normalize coins to uppercase
    const normalizedCoins = coins.map(coin => coin.toUpperCase());
    
    // Define major quote currencies (stablecoins and major cryptos)
    const majorQuotes = ['USDT', 'USDC', 'BTC', 'ETH', 'BNB'];
    
    // Fetch exchange information
    const exchangeInfo = await this.fetchBinanceExchangeInfo();
    
    // Filter for active trading pairs where the base asset is in our coins list
    // and the quote asset is either in our coins list OR a major quote currency
    const validPairs: string[] = [];
    
    for (const symbol of exchangeInfo.symbols) {
      // Only include spot trading pairs that are active
      if (
        symbol.status === 'TRADING' &&
        symbol.isSpotTradingAllowed
      ) {
        const baseAsset = symbol.baseAsset;
        const quoteAsset = symbol.quoteAsset;
        
        // Check if base asset is in our coins list AND
        // quote asset is either in our coins list OR a major quote currency
        if (
          normalizedCoins.includes(baseAsset) &&
          (normalizedCoins.includes(quoteAsset) || majorQuotes.includes(quoteAsset)) &&
          baseAsset !== quoteAsset // Ensure they're different
        ) {
          validPairs.push(symbol.symbol);
        }
      }
    }
    
    // Sort pairs alphabetically for consistency
    validPairs.sort();
    
    console.log(`✅ Found ${validPairs.length} valid trading pairs`);
    console.log(`📋 Trading pairs: ${validPairs.slice(0, 20).join(', ')}${validPairs.length > 20 ? '...' : ''}`);
    
    return validPairs;
  }

  /**
   * Save trading pairs to a file for reference
   */
  async saveTradingPairsToFile(pairs: string[], filename: string = 'trading-pairs.txt'): Promise<void> {
    const fs = require('fs');
    const path = require('path');
    
    try {
      const filePath = path.join(process.cwd(), 'analysis', filename);
      
      // Ensure analysis directory exists
      const analysisDir = path.dirname(filePath);
      if (!fs.existsSync(analysisDir)) {
        fs.mkdirSync(analysisDir, { recursive: true });
      }
      
      // Create file content
      const content = [
        `# Trading Pairs Generated: ${new Date().toISOString()}`,
        `# Total pairs: ${pairs.length}`,
        '',
        ...pairs
      ].join('\n');
      
      fs.writeFileSync(filePath, content);
      console.log(`📁 Trading pairs saved to ${filePath}`);
      
    } catch (error) {
      console.error('❌ Error saving trading pairs to file:', error);
    }
  }

  /**
   * Validate that trading pairs meet minimum requirements
   */
  validateTradingPairs(pairs: string[], minPairs: number = 10): boolean {
    if (pairs.length < minPairs) {
      console.warn(`⚠️ Warning: Only ${pairs.length} trading pairs found (minimum recommended: ${minPairs})`);
      return false;
    }
    
    console.log(`✅ Trading pairs validation passed: ${pairs.length} pairs (>= ${minPairs})`);
    return true;
  }

  /**
   * Get detailed information about trading pairs
   */
  async getDetailedPairInfo(pairs: string[]): Promise<Array<{
    symbol: string;
    baseAsset: string;
    quoteAsset: string;
    status: string;
  }>> {
    const exchangeInfo = await this.fetchBinanceExchangeInfo();
    
    return pairs.map(pair => {
      const symbolInfo = exchangeInfo.symbols.find(s => s.symbol === pair);
      return {
        symbol: pair,
        baseAsset: symbolInfo?.baseAsset || 'Unknown',
        quoteAsset: symbolInfo?.quoteAsset || 'Unknown',
        status: symbolInfo?.status || 'Unknown'
      };
    });
  }
}

/**
 * Main execution function
 */
async function main() {
  try {
    // Get coins from command line argument or environment variable
    const args = process.argv.slice(2);
    let coins: string[] = [];
    
    if (args.length > 0) {
      // Parse coins from command line argument
      coins = args[0].split(',').map(coin => coin.trim());
    } else {
      // Get coins from BASE_COINS environment variable
      const baseCoins = process.env.BASE_COINS;
      if (!baseCoins) {
        console.error('❌ Error: No coins provided. Use either:');
        console.error('  1. Command line: npm run getTradingPairs "BTC,ETH,ADA"');
        console.error('  2. Environment variable: BASE_COINS in .env');
        process.exit(1);
      }
      coins = baseCoins.split(',').map(coin => coin.trim());
    }
    
    console.log('🚀 Starting trading pairs generation...');
    console.log('=' .repeat(50));
    console.log(`📊 Input coins: ${coins.join(', ')}`);
    
    const generator = new TradingPairsGenerator();
    
    // Generate trading pairs
    const tradingPairs = await generator.generateTradingPairs(coins);
    
    // Validate results
    generator.validateTradingPairs(tradingPairs);
    
    // Get detailed information
    const detailedInfo = await generator.getDetailedPairInfo(tradingPairs);
    
    // Display summary
    console.log('\n📈 Trading Pairs Summary:');
    console.log('-'.repeat(40));
    
    const baseAssets = new Set(detailedInfo.map(p => p.baseAsset));
    const quoteAssets = new Set(detailedInfo.map(p => p.quoteAsset));
    
    console.log(`Base assets: ${Array.from(baseAssets).join(', ')}`);
    console.log(`Quote assets: ${Array.from(quoteAssets).join(', ')}`);
    console.log(`Total pairs: ${tradingPairs.length}`);
    
    // Save to file
    await generator.saveTradingPairsToFile(tradingPairs);
    
    // Output pairs for use in other scripts
    console.log('\n📋 Generated Trading Pairs:');
    console.log(tradingPairs.join(','));
    
    console.log('\n🎉 Trading pairs generation completed successfully!');
    
  } catch (error) {
    console.error('\n💥 Trading pairs generation failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { TradingPairsGenerator };