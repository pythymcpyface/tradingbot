/**
 * Data Preload Service
 * 
 * Preloads and prepares frequently used backtest data for maximum performance.
 * Uses intelligent scheduling to load data during low-usage periods and
 * maintains hot caches of critical trading data.
 * 
 * Features:
 * - Background data loading and refresh
 * - Intelligent data prioritization
 * - Memory usage optimization
 * - Real-time monitoring and health checks
 */

import { MemoryOptimizedCacheService } from './MemoryOptimizedCacheService';
import { ConnectionPoolService } from '../lib/database/ConnectionPoolService';

interface PreloadConfig {
  symbols: string[];
  lookbackMonths: number;
  updateIntervalMinutes: number;
  prioritySymbols: string[];
  enableBackgroundRefresh: boolean;
  maxMemoryUsageMB: number;
  windowSizes: number[];
}

interface PreloadStatus {
  totalSymbols: number;
  loadedSymbols: number;
  failedSymbols: string[];
  lastUpdate: Date;
  estimatedMemoryUsage: number;
  cacheHitRate: number;
  isLoading: boolean;
}

interface DataStats {
  symbol: string;
  glickoRecords: number;
  klinesRecords: number;
  dateRange: { start: Date; end: Date };
  zScoreWindowsPrecomputed: number[];
  memoryUsage: number;
  lastAccessed: Date;
}

class DataPreloadService {
  private static instance: DataPreloadService;
  private cacheService: MemoryOptimizedCacheService;
  private connectionPool: ConnectionPoolService;
  private config: PreloadConfig;
  private status: PreloadStatus;
  private refreshInterval?: NodeJS.Timeout;
  private loadedDataStats: Map<string, DataStats>;

  private constructor(config?: Partial<PreloadConfig>) {
    this.config = {
      symbols: ['ETHUSDT', 'BTCUSDT', 'ADAUSDT', 'SOLUSDT', 'XRPUSDT'],
      lookbackMonths: 24, // 2 years of data
      updateIntervalMinutes: 360, // 6 hours
      prioritySymbols: ['ETHUSDT', 'BTCUSDT'],
      enableBackgroundRefresh: true,
      maxMemoryUsageMB: 4096, // 4GB max
      windowSizes: [10, 20, 50, 100, 200],
      ...config
    };

    this.status = {
      totalSymbols: this.config.symbols.length,
      loadedSymbols: 0,
      failedSymbols: [],
      lastUpdate: new Date(0),
      estimatedMemoryUsage: 0,
      cacheHitRate: 0,
      isLoading: false
    };

    this.loadedDataStats = new Map();
    this.cacheService = MemoryOptimizedCacheService.getInstance();
    this.connectionPool = ConnectionPoolService.getInstance();
  }

  static getInstance(config?: Partial<PreloadConfig>): DataPreloadService {
    if (!DataPreloadService.instance) {
      DataPreloadService.instance = new DataPreloadService(config);
    }
    return DataPreloadService.instance;
  }

  /**
   * Initialize and start preloading data
   */
  async initialize(): Promise<void> {
    console.log('🚀 Initializing Data Preload Service...');
    console.log(`📊 Target symbols: ${this.config.symbols.join(', ')}`);
    console.log(`📅 Lookback period: ${this.config.lookbackMonths} months`);
    console.log(`💾 Max memory usage: ${this.config.maxMemoryUsageMB}MB`);

    await this.preloadAllData();

    if (this.config.enableBackgroundRefresh) {
      this.startBackgroundRefresh();
    }

    console.log('✅ Data Preload Service initialized');
  }

  /**
   * Preload all configured symbols
   */
  async preloadAllData(): Promise<void> {
    this.status.isLoading = true;
    this.status.loadedSymbols = 0;
    this.status.failedSymbols = [];

    console.log(`\n📥 Preloading data for ${this.config.symbols.length} symbols...`);

    // Load priority symbols first
    const prioritySymbols = this.config.symbols.filter(s => 
      this.config.prioritySymbols.includes(s)
    );
    const normalSymbols = this.config.symbols.filter(s => 
      !this.config.prioritySymbols.includes(s)
    );

    // Process priority symbols first
    for (const symbol of prioritySymbols) {
      await this.preloadSymbolData(symbol, true);
    }

    // Process remaining symbols
    for (const symbol of normalSymbols) {
      await this.preloadSymbolData(symbol, false);
    }

    this.status.isLoading = false;
    this.status.lastUpdate = new Date();
    
    console.log(`\n✅ Preloading completed:`);
    console.log(`   Loaded: ${this.status.loadedSymbols}/${this.status.totalSymbols}`);
    console.log(`   Failed: ${this.status.failedSymbols.length}`);
    if (this.status.failedSymbols.length > 0) {
      console.log(`   Failed symbols: ${this.status.failedSymbols.join(', ')}`);
    }
  }

  /**
   * Preload data for a specific symbol
   */
  private async preloadSymbolData(symbol: string, isPriority: boolean): Promise<void> {
    try {
      console.log(`\n📊 Loading ${symbol}${isPriority ? ' (PRIORITY)' : ''}...`);

      // Calculate date range
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - (this.config.lookbackMonths * 30.44 * 24 * 60 * 60 * 1000));
      
      console.log(`   📅 Date range: ${startTime.toISOString().split('T')[0]} to ${endTime.toISOString().split('T')[0]}`);

      // Load Glicko ratings
      console.log(`   🔄 Loading Glicko ratings...`);
      const ratingsStartTime = performance.now();
      const ratings = await this.connectionPool.getGlickoRatings(symbol, startTime, endTime);
      const ratingsTime = Math.round(performance.now() - ratingsStartTime);
      
      if (ratings.length === 0) {
        console.log(`   ⚠️ No Glicko ratings found for ${symbol}`);
        this.status.failedSymbols.push(symbol);
        return;
      }
      
      console.log(`   ✅ Loaded ${ratings.length.toLocaleString()} Glicko ratings (${ratingsTime}ms)`);

      // Load klines data
      console.log(`   🔄 Loading price data...`);
      const klinesStartTime = performance.now();
      const klines = await this.connectionPool.getKlinesData(symbol, startTime, endTime);
      const klinesTime = Math.round(performance.now() - klinesStartTime);
      
      console.log(`   ✅ Loaded ${klines.length.toLocaleString()} price records (${klinesTime}ms)`);

      // Cache the data with appropriate tiers
      const ratingsCacheKey = `glicko:${symbol}:${startTime.toISOString()}:${endTime.toISOString()}`;
      const klinesCacheKey = `klines:${symbol}:${startTime.toISOString()}:${endTime.toISOString()}`;
      
      const cacheStartTime = performance.now();
      await Promise.all([
        this.cacheService.set(ratingsCacheKey, ratings, isPriority ? 'hot' : 'warm'),
        this.cacheService.set(klinesCacheKey, klines, isPriority ? 'hot' : 'warm')
      ]);
      const cacheTime = Math.round(performance.now() - cacheStartTime);
      
      console.log(`   💾 Cached data (${cacheTime}ms)`);

      // Pre-compute z-scores for all configured window sizes
      console.log(`   🧮 Pre-computing z-scores for windows: [${this.config.windowSizes.join(', ')}]`);
      const zScoreStartTime = performance.now();
      const precomputedWindows: number[] = [];
      
      for (const windowSize of this.config.windowSizes) {
        try {
          const zScores = this.calculateZScores(ratings, windowSize);
          if (zScores.values.length > 0) {
            const zCacheKey = `zscore:${symbol}:${windowSize}`;
            await this.cacheService.set(zCacheKey, {
              symbol,
              windowSize,
              values: zScores.values,
              timestamps: zScores.timestamps,
              startTime,
              endTime
            }, 'compute');
            precomputedWindows.push(windowSize);
          }
        } catch (error) {
          console.warn(`     ⚠️ Failed to precompute z-scores for window ${windowSize}:`, error);
        }
      }
      
      const zScoreTime = Math.round(performance.now() - zScoreStartTime);
      console.log(`   ✅ Pre-computed ${precomputedWindows.length} z-score sets (${zScoreTime}ms)`);

      // Store data statistics
      const stats: DataStats = {
        symbol,
        glickoRecords: ratings.length,
        klinesRecords: klines.length,
        dateRange: { start: startTime, end: endTime },
        zScoreWindowsPrecomputed: precomputedWindows,
        memoryUsage: this.estimateDataSize(ratings) + this.estimateDataSize(klines),
        lastAccessed: new Date()
      };
      
      this.loadedDataStats.set(symbol, stats);
      this.status.loadedSymbols++;
      this.updateEstimatedMemoryUsage();
      
      console.log(`   📈 Estimated memory usage: ${(stats.memoryUsage / 1024 / 1024).toFixed(2)}MB`);

    } catch (error) {
      console.error(`   ❌ Failed to load ${symbol}:`, error);
      this.status.failedSymbols.push(symbol);
    }
  }

  /**
   * Calculate z-scores using sliding window algorithm
   */
  private calculateZScores(ratings: any[], windowSize: number): { values: number[]; timestamps: Date[] } {
    const values: number[] = [];
    const timestamps: Date[] = [];
    
    if (ratings.length < windowSize) return { values, timestamps };
    
    // Sliding window variables
    let windowSum = 0;
    let windowSumSquares = 0;
    const window: number[] = [];
    
    for (let i = 0; i < ratings.length; i++) {
      const rating = parseFloat(ratings[i].rating);
      const timestamp = new Date(ratings[i].timestamp);
      
      // Add new value to window
      window.push(rating);
      windowSum += rating;
      windowSumSquares += rating * rating;
      
      // Remove oldest value if window is full
      if (window.length > windowSize) {
        const oldest = window.shift()!;
        windowSum -= oldest;
        windowSumSquares -= oldest * oldest;
      }
      
      // Calculate z-score once we have full window
      if (window.length === windowSize) {
        const mean = windowSum / windowSize;
        const variance = (windowSumSquares / windowSize) - (mean * mean);
        const stdDev = Math.sqrt(Math.max(variance, 0));
        
        const zScore = stdDev > 0 ? (rating - mean) / stdDev : 0;
        values.push(zScore);
        timestamps.push(timestamp);
      }
    }
    
    return { values, timestamps };
  }

  /**
   * Start background refresh process
   */
  private startBackgroundRefresh(): void {
    console.log(`🔄 Starting background refresh (every ${this.config.updateIntervalMinutes} minutes)`);
    
    this.refreshInterval = setInterval(async () => {
      if (!this.status.isLoading) {
        console.log('\n🔄 Background refresh starting...');
        await this.refreshStaleData();
      }
    }, this.config.updateIntervalMinutes * 60 * 1000);
  }

  /**
   * Refresh data that is getting stale
   */
  private async refreshStaleData(): Promise<void> {
    const now = new Date();
    const refreshThreshold = 6 * 60 * 60 * 1000; // 6 hours
    
    for (const [symbol, stats] of this.loadedDataStats.entries()) {
      const age = now.getTime() - stats.lastAccessed.getTime();
      
      if (age > refreshThreshold) {
        console.log(`🔄 Refreshing stale data for ${symbol}`);
        await this.preloadSymbolData(symbol, this.config.prioritySymbols.includes(symbol));
      }
    }
    
    this.status.lastUpdate = now;
  }

  /**
   * Get preloaded data statistics
   */
  getDataStats(symbol?: string): DataStats | DataStats[] {
    if (symbol) {
      return this.loadedDataStats.get(symbol) || {} as DataStats;
    }
    return Array.from(this.loadedDataStats.values());
  }

  /**
   * Get current preload status
   */
  getStatus(): PreloadStatus {
    // Update cache hit rate from cache service
    const cacheMetrics = this.cacheService.getMetrics();
    this.status.cacheHitRate = cacheMetrics.hitRate;
    
    return { ...this.status };
  }

  /**
   * Estimate memory usage of data
   */
  private estimateDataSize(data: any[]): number {
    if (data.length === 0) return 0;
    
    // Rough estimation based on typical record size
    const sampleSize = JSON.stringify(data[0]).length;
    return data.length * sampleSize * 1.2; // 20% overhead for object structure
  }

  /**
   * Update estimated memory usage
   */
  private updateEstimatedMemoryUsage(): void {
    this.status.estimatedMemoryUsage = Array.from(this.loadedDataStats.values())
      .reduce((total, stats) => total + stats.memoryUsage, 0);
  }

  /**
   * Health check for preloaded data
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'critical';
    details: {
      loadedSymbols: number;
      failedSymbols: number;
      cacheHitRate: number;
      memoryUsage: number;
      lastUpdate: Date;
    };
  }> {
    const cacheMetrics = this.cacheService.getMetrics();
    
    let status: 'healthy' | 'degraded' | 'critical' = 'healthy';
    
    // Determine health status
    if (this.status.failedSymbols.length > 0) {
      status = 'degraded';
    }
    
    if (this.status.loadedSymbols < this.status.totalSymbols * 0.5) {
      status = 'critical';
    }
    
    if (cacheMetrics.hitRate < 70) {
      status = 'degraded';
    }

    return {
      status,
      details: {
        loadedSymbols: this.status.loadedSymbols,
        failedSymbols: this.status.failedSymbols.length,
        cacheHitRate: cacheMetrics.hitRate,
        memoryUsage: this.status.estimatedMemoryUsage,
        lastUpdate: this.status.lastUpdate
      }
    };
  }

  /**
   * Add symbol to preload list
   */
  async addSymbol(symbol: string, isPriority: boolean = false): Promise<void> {
    if (!this.config.symbols.includes(symbol)) {
      this.config.symbols.push(symbol);
      this.status.totalSymbols++;
    }
    
    if (isPriority && !this.config.prioritySymbols.includes(symbol)) {
      this.config.prioritySymbols.push(symbol);
    }
    
    await this.preloadSymbolData(symbol, isPriority);
  }

  /**
   * Remove symbol from preload service
   */
  removeSymbol(symbol: string): void {
    this.config.symbols = this.config.symbols.filter(s => s !== symbol);
    this.config.prioritySymbols = this.config.prioritySymbols.filter(s => s !== symbol);
    this.loadedDataStats.delete(symbol);
    
    if (this.status.loadedSymbols > 0) {
      this.status.loadedSymbols--;
    }
    this.status.totalSymbols = this.config.symbols.length;
    
    // Clear cached data for this symbol
    // This would need to be implemented in the cache service
    console.log(`🗑️ Removed ${symbol} from preload service`);
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    
    console.log('🔴 Data Preload Service shut down');
  }

  static reset(): void {
    if (DataPreloadService.instance) {
      DataPreloadService.instance.shutdown();
      DataPreloadService.instance = null as any;
    }
  }
}

export { DataPreloadService, PreloadConfig, PreloadStatus, DataStats };