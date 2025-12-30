#!/usr/bin/env ts-node

/**
 * Get Trading Pairs Script
 * 
 * This script takes an argument 'coins' and calculates which trading pairs 
 * from Binance exist where each coin in the pair is one of the coins in the argument.
 * 
 * As specified in SPEC.md Stage 3.1
 */

import { TradingPairsGenerator } from '../src/utils/TradingPairsGenerator';

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
