#!/usr/bin/env ts-node

/**
 * Preload Backtest Data Script
 * 
 * Preloads frequently used backtest data into memory cache for maximum performance.
 * This script should be run before performing parameter optimization to ensure
 * all necessary data is cached and ready for instant access.
 * 
 * Usage: npm run preload-backtest-data [symbols...]
 * 
 * Examples:
 *   npm run preload-backtest-data                    # Load default symbols
 *   npm run preload-backtest-data ETH USDT BTC      # Load specific symbols  
 *   npm run preload-backtest-data --all             # Load all available symbols
 */

import { DataPreloadService } from '../src/services/DataPreloadService';
import { MemoryOptimizedCacheService } from '../src/services/MemoryOptimizedCacheService';
import { config } from 'dotenv';

config();

interface PreloadOptions {
  symbols: string[];
  lookbackMonths: number;
  enableMonitoring: boolean;
  maxMemoryMB: number;
  windowSizes: number[];
}

class BacktestDataPreloader {
  private dataService: DataPreloadService;
  private cacheService: MemoryOptimizedCacheService;

  constructor() {
    // Initialize services will be done in initialize()
  }

  async initialize(options: PreloadOptions): Promise<void> {
    console.log('🚀 Initializing Backtest Data Preloader...');
    console.log('=' .repeat(80));
    
    // Initialize cache service with aggressive memory settings
    this.cacheService = MemoryOptimizedCacheService.getInstance({
      hotTier: { maxSize: options.maxMemoryMB * 1024 * 1024 * 0.5, ttl: 1800, maxKeys: 10000 },
      warmTier: { maxSize: options.maxMemoryMB * 1024 * 1024 * 0.3, ttl: 3600, maxKeys: 5000 },
      coldTier: { maxSize: options.maxMemoryMB * 1024 * 1024 * 0.15, ttl: 7200, maxKeys: 1000 },
      computeTier: { maxSize: options.maxMemoryMB * 1024 * 1024 * 0.05, ttl: 3600, maxKeys: 2000 },
      enableCompression: true,
      compressionThreshold: 10240,
      memoryMonitoring: options.enableMonitoring,
      backgroundRefresh: true
    });

    // Initialize data preload service
    this.dataService = DataPreloadService.getInstance({
      symbols: options.symbols,
      lookbackMonths: options.lookbackMonths,
      updateIntervalMinutes: 360, // 6 hours
      prioritySymbols: ['ETHUSDT', 'BTCUSDT', 'ADAUSDT', 'SOLUSDT'],
      enableBackgroundRefresh: true,
      maxMemoryUsageMB: options.maxMemoryMB,
      windowSizes: options.windowSizes
    });

    console.log('✅ Services initialized');
  }

  async preloadData(): Promise<void> {
    console.log('\n📥 Starting data preload process...');
    
    const startTime = performance.now();
    await this.dataService.initialize();
    const endTime = performance.now();
    
    const totalTime = Math.round(endTime - startTime);
    const minutes = Math.floor(totalTime / 60000);
    const seconds = Math.round((totalTime % 60000) / 1000);
    
    console.log(`\n🎉 Data preload completed in ${minutes}m ${seconds}s`);
  }

  async displayStatus(): Promise<void> {
    console.log('\n📊 Preload Status Report');
    console.log('=' .repeat(50));
    
    // Get preload status
    const status = this.dataService.getStatus();
    const dataStats = this.dataService.getDataStats() as any[];
    const cacheMetrics = this.cacheService.getMetrics();
    
    // Display overall status
    console.log(`📈 Overall Status:`);
    console.log(`   Symbols loaded: ${status.loadedSymbols}/${status.totalSymbols}`);
    console.log(`   Success rate: ${((status.loadedSymbols / status.totalSymbols) * 100).toFixed(1)}%`);
    console.log(`   Last update: ${status.lastUpdate.toISOString()}`);
    console.log(`   Memory usage: ${(status.estimatedMemoryUsage / 1024 / 1024).toFixed(2)}MB`);
    console.log(`   Cache hit rate: ${status.cacheHitRate.toFixed(1)}%`);
    
    if (status.failedSymbols.length > 0) {
      console.log(`   ❌ Failed symbols: ${status.failedSymbols.join(', ')}`);
    }
    
    // Display per-symbol statistics
    console.log(`\n📊 Per-Symbol Statistics:`);
    dataStats.forEach((stats: any) => {
      const memoryMB = (stats.memoryUsage / 1024 / 1024).toFixed(2);
      const dateRange = `${stats.dateRange.start.toISOString().split('T')[0]} to ${stats.dateRange.end.toISOString().split('T')[0]}`;
      
      console.log(`   ${stats.symbol}:`);
      console.log(`     Glicko records: ${stats.glickoRecords.toLocaleString()}`);
      console.log(`     Price records: ${stats.klinesRecords.toLocaleString()}`);
      console.log(`     Date range: ${dateRange}`);
      console.log(`     Z-score windows: [${stats.zScoreWindowsPrecomputed.join(', ')}]`);
      console.log(`     Memory usage: ${memoryMB}MB`);
      console.log(`     Last accessed: ${stats.lastAccessed.toISOString()}`);
      console.log('');
    });
    
    // Display cache statistics
    console.log(`💾 Cache Performance:`);
    console.log(`   Total requests: ${cacheMetrics.totalRequests.toLocaleString()}`);
    console.log(`   Hit rate: ${cacheMetrics.hitRate.toFixed(1)}%`);
    console.log(`   Hot tier hits: ${cacheMetrics.hotHits.toLocaleString()}`);
    console.log(`   Warm tier hits: ${cacheMetrics.warmHits.toLocaleString()}`);
    console.log(`   Cold tier hits: ${cacheMetrics.coldHits.toLocaleString()}`);
    console.log(`   Compute tier hits: ${cacheMetrics.computeHits.toLocaleString()}`);
    console.log(`   Cache misses: ${cacheMetrics.misses.toLocaleString()}`);
    console.log(`   Data promotions: ${cacheMetrics.dataPromotions.toLocaleString()}`);
    
    console.log(`\n💾 Memory Usage by Tier:`);
    console.log(`   Hot tier: ${(cacheMetrics.memoryUsage.hot / 1024 / 1024).toFixed(2)}MB`);
    console.log(`   Warm tier: ${(cacheMetrics.memoryUsage.warm / 1024 / 1024).toFixed(2)}MB`);
    console.log(`   Cold tier: ${(cacheMetrics.memoryUsage.cold / 1024 / 1024).toFixed(2)}MB`);
    console.log(`   Compute tier: ${(cacheMetrics.memoryUsage.compute / 1024 / 1024).toFixed(2)}MB`);
    console.log(`   Total cache: ${(cacheMetrics.memoryUsage.total / 1024 / 1024).toFixed(2)}MB`);
  }

  async performHealthCheck(): Promise<void> {
    console.log('\n🏥 Health Check');
    console.log('=' .repeat(30));
    
    const health = await this.dataService.healthCheck();
    
    console.log(`Status: ${health.status.toUpperCase()}`);
    console.log(`Loaded symbols: ${health.details.loadedSymbols}`);
    console.log(`Failed symbols: ${health.details.failedSymbols}`);
    console.log(`Cache hit rate: ${health.details.cacheHitRate.toFixed(1)}%`);
    console.log(`Memory usage: ${(health.details.memoryUsage / 1024 / 1024).toFixed(2)}MB`);
    console.log(`Last update: ${health.details.lastUpdate.toISOString()}`);
    
    if (health.status === 'critical') {
      console.log('\n⚠️ CRITICAL ISSUES DETECTED:');
      console.log('   - Less than 50% of symbols loaded successfully');
      console.log('   - Consider checking database connectivity');
      console.log('   - Verify symbol availability in database');
    } else if (health.status === 'degraded') {
      console.log('\n⚠️ PERFORMANCE ISSUES DETECTED:');
      console.log('   - Some symbols failed to load or cache hit rate is low');
      console.log('   - Monitor performance during backtests');
    } else {
      console.log('\n✅ All systems operating normally');
    }
  }

  async cleanup(): Promise<void> {
    await this.dataService.shutdown();
    await this.cacheService.shutdown();
  }
}

/**
 * Parse command line arguments
 */
function parseArguments(): PreloadOptions {
  const args = process.argv.slice(2);
  
  // Default configuration
  const options: PreloadOptions = {
    symbols: ['ETHUSDT', 'BTCUSDT', 'ADAUSDT', 'SOLUSDT', 'XRPUSDT'],
    lookbackMonths: 24,
    enableMonitoring: true,
    maxMemoryMB: 4096, // 4GB
    windowSizes: [10, 20, 50, 100, 200]
  };
  
  // Parse arguments
  if (args.includes('--all')) {
    // Use all symbols from .env
    const baseCoins = process.env.BASE_COINS?.split(',') || ['BTC', 'ETH', 'ADA', 'SOL', 'XRP'];
    options.symbols = baseCoins.map(coin => `${coin}USDT`);
  } else {
    // Check for custom symbols
    const customSymbols = args.filter(arg => !arg.startsWith('--'));
    if (customSymbols.length > 0) {
      // Convert to USDT pairs if just coin names provided
      options.symbols = customSymbols.map(symbol => {
        if (symbol.length <= 4 && !symbol.includes('USDT')) {
          return `${symbol.toUpperCase()}USDT`;
        }
        return symbol.toUpperCase();
      });
    }
  }
  
  // Parse other options
  if (args.includes('--lookback')) {
    const lookbackIndex = args.indexOf('--lookback');
    if (args[lookbackIndex + 1]) {
      options.lookbackMonths = parseInt(args[lookbackIndex + 1]);
    }
  }
  
  if (args.includes('--memory')) {
    const memoryIndex = args.indexOf('--memory');
    if (args[memoryIndex + 1]) {
      options.maxMemoryMB = parseInt(args[memoryIndex + 1]);
    }
  }
  
  return options;
}

/**
 * Display usage help
 */
function displayHelp(): void {
  console.log('Backtest Data Preloader');
  console.log('=' .repeat(50));
  console.log('');
  console.log('Usage: npm run preload-backtest-data [options] [symbols...]');
  console.log('');
  console.log('Options:');
  console.log('  --all                 Preload all available symbols');
  console.log('  --lookback <months>   Lookback period in months (default: 24)');
  console.log('  --memory <MB>         Maximum memory usage in MB (default: 4096)');
  console.log('  --help               Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  npm run preload-backtest-data');
  console.log('  npm run preload-backtest-data ETH BTC ADA');
  console.log('  npm run preload-backtest-data ETHUSDT BTCUSDT');
  console.log('  npm run preload-backtest-data --all');
  console.log('  npm run preload-backtest-data --lookback 12 --memory 2048 ETH BTC');
  console.log('');
}

/**
 * Main execution function
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help')) {
    displayHelp();
    return;
  }
  
  const preloader = new BacktestDataPreloader();
  
  try {
    const options = parseArguments();
    
    console.log('🎯 Backtest Data Preloader Starting...');
    console.log('=' .repeat(80));
    console.log(`📊 Symbols: ${options.symbols.join(', ')}`);
    console.log(`📅 Lookback: ${options.lookbackMonths} months`);
    console.log(`💾 Max Memory: ${options.maxMemoryMB}MB`);
    console.log(`🪟 Window Sizes: [${options.windowSizes.join(', ')}]`);
    console.log('');
    
    await preloader.initialize(options);
    await preloader.preloadData();
    await preloader.displayStatus();
    await preloader.performHealthCheck();
    
    console.log('\n🎉 Preload process completed successfully!');
    console.log('\n📚 Next Steps:');
    console.log('   1. Run parameter optimization scripts for faster performance');
    console.log('   2. Monitor cache hit rates during backtest operations');
    console.log('   3. Adjust memory allocation based on usage patterns');
    console.log('   4. Consider running this script before large optimization runs');
    
  } catch (error) {
    console.error('\n❌ Preload process failed:', error);
    process.exit(1);
  } finally {
    await preloader.cleanup();
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { BacktestDataPreloader };