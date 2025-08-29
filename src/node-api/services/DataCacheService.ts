import { PrismaClient } from '@prisma/client';
import NodeCache from 'node-cache';
import { LRUCache } from 'lru-cache';

interface CacheConfig {
  ttl: number; // Time to live in seconds
  maxKeys: number; // Maximum number of keys to store
  checkPeriod: number; // Period for automatic delete check in seconds
}

interface GlickoRatingCached {
  id: string;
  symbol: string;
  timestamp: Date;
  rating: number;
  ratingDeviation: number;
  volatility: number;
  performanceScore: number;
}

interface KlineCached {
  symbol: string;
  openTime: Date;
  close: number;
  volume: number;
  high: number;
  low: number;
}

interface ZScoreResult {
  timestamp: Date;
  rating: number;
  zScore: number;
  movingAverage: number;
  stdDev: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  size: number;
  maxSize: number;
}

/**
 * High-performance data caching service for backtest operations
 * 
 * This service implements multiple caching strategies:
 * 1. Hot cache (in-memory) for frequently accessed data
 * 2. Warm cache (LRU) for medium-frequency data
 * 3. Cold cache (time-based) for large datasets
 * 4. Computed cache for expensive calculations (z-scores)
 */
export class DataCacheService {
  private prisma: PrismaClient;
  
  // Multi-tier cache system
  private hotCache: NodeCache; // For ultra-hot data (ratings, prices)
  private warmCache: LRUCache<string, any>; // For medium-frequency data
  private coldCache: Map<string, { data: any; timestamp: number; ttl: number }>; // For large datasets
  private computedCache: LRUCache<string, ZScoreResult[]>; // For expensive calculations
  
  // Cache statistics
  private stats = {
    hot: { hits: 0, misses: 0 },
    warm: { hits: 0, misses: 0 },
    cold: { hits: 0, misses: 0 },
    computed: { hits: 0, misses: 0 }
  };

  // Configuration
  private readonly configs = {
    hot: { ttl: 300, maxKeys: 1000, checkPeriod: 60 }, // 5 min TTL, check every minute
    warm: { ttl: 1800, maxKeys: 500, checkPeriod: 300 }, // 30 min TTL
    cold: { ttl: 3600, maxKeys: 100, checkPeriod: 600 }, // 1 hour TTL
    computed: { ttl: 1800, maxKeys: 200, checkPeriod: 300 } // 30 min TTL for calculations
  };

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.initializeCaches();
    this.setupCacheCleanup();
  }

  /**
   * Initialize all cache layers
   */
  private initializeCaches(): void {
    // Hot cache for frequently accessed small data
    this.hotCache = new NodeCache({
      stdTTL: this.configs.hot.ttl,
      maxKeys: this.configs.hot.maxKeys,
      checkperiod: this.configs.hot.checkPeriod,
      useClones: false // Better performance, but be careful with mutations
    });

    // Warm cache for medium-frequency data with LRU eviction
    this.warmCache = new LRUCache<string, any>({
      max: this.configs.warm.maxKeys,
      ttl: this.configs.warm.ttl * 1000, // Convert to milliseconds
      allowStale: false,
      updateAgeOnGet: true
    });

    // Cold cache for large datasets
    this.coldCache = new Map();

    // Computed cache for expensive calculations
    this.computedCache = new LRUCache<string, ZScoreResult[]>({
      max: this.configs.computed.maxKeys,
      ttl: this.configs.computed.ttl * 1000,
      allowStale: false,
      updateAgeOnGet: true
    });

    console.log('✅ Multi-tier cache system initialized');
  }

  /**
   * Setup automatic cache cleanup and monitoring
   */
  private setupCacheCleanup(): void {
    // Clean cold cache periodically
    setInterval(() => {
      const now = Date.now();
      let expiredCount = 0;

      for (const [key, entry] of this.coldCache) {
        if (now - entry.timestamp > entry.ttl * 1000) {
          this.coldCache.delete(key);
          expiredCount++;
        }
      }

      if (expiredCount > 0) {
        console.log(`🧹 Cleaned ${expiredCount} expired entries from cold cache`);
      }
    }, this.configs.cold.checkPeriod * 1000);

    // Log cache statistics periodically
    setInterval(() => {
      this.logCacheStatistics();
    }, 300000); // Every 5 minutes
  }

  /**
   * Generate cache key for Glicko ratings
   */
  private getGlickoRatingsKey(
    symbol: string, 
    startTime: Date, 
    endTime: Date, 
    extraHours: number = 0
  ): string {
    const start = new Date(startTime.getTime() - extraHours * 60 * 60 * 1000);
    return `glicko:${symbol}:${start.getTime()}:${endTime.getTime()}`;
  }

  /**
   * Generate cache key for price data
   */
  private getPriceDataKey(symbol: string, startTime: Date, endTime: Date): string {
    return `klines:${symbol}:${startTime.getTime()}:${endTime.getTime()}`;
  }

  /**
   * Generate cache key for z-score calculations
   */
  private getZScoreKey(symbol: string, movingAverages: number, startTime: Date, endTime: Date): string {
    return `zscore:${symbol}:${movingAverages}:${startTime.getTime()}:${endTime.getTime()}`;
  }

  /**
   * Get Glicko ratings with intelligent caching
   */
  async getGlickoRatings(
    symbol: string, 
    startTime: Date, 
    endTime: Date, 
    extraHours: number = 0
  ): Promise<GlickoRatingCached[]> {
    const cacheKey = this.getGlickoRatingsKey(symbol, startTime, endTime, extraHours);
    
    // Try hot cache first
    let data = this.hotCache.get<GlickoRatingCached[]>(cacheKey);
    if (data) {
      this.stats.hot.hits++;
      return data;
    }

    // Try warm cache
    data = this.warmCache.get(cacheKey);
    if (data) {
      this.stats.warm.hits++;
      // Promote to hot cache if frequently accessed
      this.hotCache.set(cacheKey, data, this.configs.hot.ttl);
      return data;
    }

    // Try cold cache
    const coldEntry = this.coldCache.get(cacheKey);
    if (coldEntry && Date.now() - coldEntry.timestamp < coldEntry.ttl * 1000) {
      this.stats.cold.hits++;
      // Promote to warm cache
      this.warmCache.set(cacheKey, coldEntry.data);
      return coldEntry.data;
    }

    // Cache miss - query database
    this.stats.hot.misses++;
    const adjustedStartTime = new Date(startTime.getTime() - extraHours * 60 * 60 * 1000);
    
    const ratings = await this.prisma.glickoRatings.findMany({
      where: {
        symbol,
        timestamp: {
          gte: adjustedStartTime,
          lte: endTime
        }
      },
      select: {
        id: true,
        symbol: true,
        timestamp: true,
        rating: true,
        ratingDeviation: true,
        volatility: true,
        performanceScore: true
      },
      orderBy: { timestamp: 'asc' }
    });

    // Convert Decimal types to numbers for better performance
    const cachedRatings: GlickoRatingCached[] = ratings.map(r => ({
      id: r.id,
      symbol: r.symbol,
      timestamp: r.timestamp,
      rating: parseFloat(r.rating.toString()),
      ratingDeviation: parseFloat(r.ratingDeviation.toString()),
      volatility: parseFloat(r.volatility.toString()),
      performanceScore: parseFloat(r.performanceScore.toString())
    }));

    // Store in appropriate cache based on data size
    const dataSize = cachedRatings.length;
    if (dataSize < 100) {
      // Small dataset - store in hot cache
      this.hotCache.set(cacheKey, cachedRatings, this.configs.hot.ttl);
    } else if (dataSize < 1000) {
      // Medium dataset - store in warm cache
      this.warmCache.set(cacheKey, cachedRatings);
    } else {
      // Large dataset - store in cold cache
      this.coldCache.set(cacheKey, {
        data: cachedRatings,
        timestamp: Date.now(),
        ttl: this.configs.cold.ttl
      });
    }

    return cachedRatings;
  }

  /**
   * Get price data with caching
   */
  async getPriceData(symbol: string, startTime: Date, endTime: Date): Promise<KlineCached[]> {
    const cacheKey = this.getPriceDataKey(symbol, startTime, endTime);
    
    // Try hot cache first
    let data = this.hotCache.get<KlineCached[]>(cacheKey);
    if (data) {
      this.stats.hot.hits++;
      return data;
    }

    // Try warm cache
    data = this.warmCache.get(cacheKey);
    if (data) {
      this.stats.warm.hits++;
      this.hotCache.set(cacheKey, data, this.configs.hot.ttl);
      return data;
    }

    // Cache miss - query database
    this.stats.hot.misses++;
    const klines = await this.prisma.klines.findMany({
      where: {
        symbol,
        openTime: {
          gte: startTime,
          lte: endTime
        }
      },
      select: {
        symbol: true,
        openTime: true,
        close: true,
        volume: true,
        high: true,
        low: true
      },
      orderBy: { openTime: 'asc' }
    });

    // Convert to cached format
    const cachedKlines: KlineCached[] = klines.map(k => ({
      symbol: k.symbol,
      openTime: k.openTime,
      close: parseFloat(k.close.toString()),
      volume: parseFloat(k.volume.toString()),
      high: parseFloat(k.high.toString()),
      low: parseFloat(k.low.toString())
    }));

    // Cache based on size
    if (cachedKlines.length < 500) {
      this.hotCache.set(cacheKey, cachedKlines, this.configs.hot.ttl);
    } else {
      this.warmCache.set(cacheKey, cachedKlines);
    }

    return cachedKlines;
  }

  /**
   * Get or compute z-scores with caching
   */
  async getZScores(
    symbol: string, 
    movingAverages: number, 
    startTime: Date, 
    endTime: Date
  ): Promise<ZScoreResult[]> {
    const cacheKey = this.getZScoreKey(symbol, movingAverages, startTime, endTime);
    
    // Check computed cache
    let zScores = this.computedCache.get(cacheKey);
    if (zScores) {
      this.stats.computed.hits++;
      return zScores;
    }

    // Cache miss - compute z-scores
    this.stats.computed.misses++;
    
    // Get ratings with extra data for moving average calculation
    const extraHours = movingAverages;
    const ratings = await this.getGlickoRatings(symbol, startTime, endTime, extraHours);
    
    if (ratings.length < movingAverages + 10) {
      throw new Error(`Insufficient data for z-score calculation. Need at least ${movingAverages + 10} points, got ${ratings.length}`);
    }

    // Compute z-scores using optimized algorithm
    const computedZScores = this.computeZScoresOptimized(ratings, movingAverages, startTime, endTime);
    
    // Cache the results
    this.computedCache.set(cacheKey, computedZScores);
    
    return computedZScores;
  }

  /**
   * Optimized z-score calculation using sliding window
   */
  private computeZScoresOptimized(
    ratings: GlickoRatingCached[], 
    windowSize: number, 
    startTime: Date, 
    endTime: Date
  ): ZScoreResult[] {
    const results: ZScoreResult[] = [];
    
    // Sliding window statistics for O(1) updates
    let windowSum = 0;
    let windowSumSquares = 0;
    const window: number[] = [];
    
    for (let i = 0; i < ratings.length; i++) {
      const rating = ratings[i];
      const currentRating = rating.rating;
      
      // Add current rating to window
      window.push(currentRating);
      windowSum += currentRating;
      windowSumSquares += currentRating * currentRating;
      
      // Remove oldest rating if window exceeds size
      if (window.length > windowSize) {
        const oldRating = window.shift()!;
        windowSum -= oldRating;
        windowSumSquares -= oldRating * oldRating;
      }
      
      // Calculate z-score if we have enough data and are in target time range
      if (window.length === windowSize && rating.timestamp >= startTime && rating.timestamp <= endTime) {
        const mean = windowSum / windowSize;
        const variance = (windowSumSquares / windowSize) - (mean * mean);
        const stdDev = Math.sqrt(Math.max(variance, 0)); // Ensure non-negative
        
        const zScore = stdDev > 0 ? (currentRating - mean) / stdDev : 0;
        
        results.push({
          timestamp: rating.timestamp,
          rating: currentRating,
          zScore,
          movingAverage: mean,
          stdDev
        });
      }
    }
    
    return results;
  }

  /**
   * Warm up cache with commonly used data
   */
  async warmUpCache(symbols: string[], daysBack: number = 30): Promise<void> {
    console.log(`🔥 Warming up cache for ${symbols.length} symbols, ${daysBack} days back...`);
    
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - daysBack * 24 * 60 * 60 * 1000);
    
    const warmupPromises = [];
    
    for (const symbol of symbols) {
      // Warm up Glicko ratings
      warmupPromises.push(
        this.getGlickoRatings(symbol, startTime, endTime).catch(err => 
          console.warn(`⚠️ Failed to warm up Glicko data for ${symbol}:`, err.message)
        )
      );
      
      // Warm up price data for common trading pairs
      if (symbol.endsWith('USDT')) {
        warmupPromises.push(
          this.getPriceData(symbol, startTime, endTime).catch(err => 
            console.warn(`⚠️ Failed to warm up price data for ${symbol}:`, err.message)
          )
        );
      }
    }
    
    await Promise.all(warmupPromises);
    console.log('✅ Cache warmup completed');
  }

  /**
   * Clear specific cache entries
   */
  clearCache(pattern?: string): void {
    if (pattern) {
      // Clear entries matching pattern
      const hotKeys = this.hotCache.keys().filter(key => key.includes(pattern));
      hotKeys.forEach(key => this.hotCache.del(key));
      
      this.warmCache.clear(); // LRU cache doesn't support pattern deletion
      
      for (const [key] of this.coldCache) {
        if (key.includes(pattern)) {
          this.coldCache.delete(key);
        }
      }
      
      this.computedCache.clear(); // Clear computed cache as it depends on data
      
      console.log(`🧹 Cleared cache entries matching pattern: ${pattern}`);
    } else {
      // Clear all caches
      this.hotCache.flushAll();
      this.warmCache.clear();
      this.coldCache.clear();
      this.computedCache.clear();
      
      console.log('🧹 All caches cleared');
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStatistics(): { [cacheName: string]: CacheStats } {
    const stats = {
      hot: {
        hits: this.stats.hot.hits,
        misses: this.stats.hot.misses,
        hitRate: this.stats.hot.hits / (this.stats.hot.hits + this.stats.hot.misses) || 0,
        size: this.hotCache.keys().length,
        maxSize: this.configs.hot.maxKeys
      },
      warm: {
        hits: this.stats.warm.hits,
        misses: this.stats.warm.misses,
        hitRate: this.stats.warm.hits / (this.stats.warm.hits + this.stats.warm.misses) || 0,
        size: this.warmCache.size,
        maxSize: this.configs.warm.maxKeys
      },
      cold: {
        hits: this.stats.cold.hits,
        misses: this.stats.cold.misses,
        hitRate: this.stats.cold.hits / (this.stats.cold.hits + this.stats.cold.misses) || 0,
        size: this.coldCache.size,
        maxSize: this.configs.cold.maxKeys
      },
      computed: {
        hits: this.stats.computed.hits,
        misses: this.stats.computed.misses,
        hitRate: this.stats.computed.hits / (this.stats.computed.hits + this.stats.computed.misses) || 0,
        size: this.computedCache.size,
        maxSize: this.configs.computed.maxKeys
      }
    };

    return stats;
  }

  /**
   * Log cache performance statistics
   */
  private logCacheStatistics(): void {
    const stats = this.getCacheStatistics();
    
    console.log('\n📊 Cache Performance Statistics:');
    for (const [cacheName, cacheStats] of Object.entries(stats)) {
      const hitRate = (cacheStats.hitRate * 100).toFixed(1);
      const utilization = (cacheStats.size / cacheStats.maxSize * 100).toFixed(1);
      
      console.log(`   ${cacheName.toUpperCase()}: ${hitRate}% hit rate, ${cacheStats.size}/${cacheStats.maxSize} (${utilization}% full)`);
    }
  }

  /**
   * Reset cache statistics
   */
  resetStatistics(): void {
    this.stats = {
      hot: { hits: 0, misses: 0 },
      warm: { hits: 0, misses: 0 },
      cold: { hits: 0, misses: 0 },
      computed: { hits: 0, misses: 0 }
    };
    console.log('📊 Cache statistics reset');
  }
}

export { GlickoRatingCached, KlineCached, ZScoreResult, CacheStats };