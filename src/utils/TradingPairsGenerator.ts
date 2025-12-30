import axios from 'axios';
import { config } from 'dotenv';

config();

export interface BinanceExchangeInfo {
  symbols: Array<{
    symbol: string;
    status: string;
    baseAsset: string;
    quoteAsset: string;
    isSpotTradingAllowed: boolean;
    permissions: string[];
  }>;
}

export class TradingPairsGenerator {
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
