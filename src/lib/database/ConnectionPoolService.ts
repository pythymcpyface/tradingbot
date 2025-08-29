/**
 * Database Connection Pool Service
 * 
 * Provides optimized database connection management with connection pooling,
 * query caching, and performance monitoring for backtest operations.
 * 
 * Features:
 * - Shared connection pool across all scripts
 * - Read-only replica support for historical queries
 * - Prepared statement caching
 * - Query performance monitoring
 * - Connection health checks
 */

import { PrismaClient } from '@prisma/client';
import NodeCache from 'node-cache';

interface ConnectionConfig {
  maxConnections: number;
  connectionTimeout: number;
  queryTimeout: number;
  enableQueryCache: boolean;
  cacheSize: number;
  cacheTTL: number;
}

interface QueryMetrics {
  queryCount: number;
  totalExecutionTime: number;
  cacheHits: number;
  cacheMisses: number;
  errorCount: number;
  avgExecutionTime: number;
}

interface CachedQuery {
  sql: string;
  params: any[];
  result: any;
  timestamp: number;
  executionTime: number;
}

class ConnectionPoolService {
  private static instance: ConnectionPoolService;
  private primaryClient!: PrismaClient;
  private replicaClient?: PrismaClient;
  private queryCache: NodeCache;
  private config: ConnectionConfig;
  private metrics: QueryMetrics;
  private preparedStatements: Map<string, any>;

  private constructor(config?: Partial<ConnectionConfig>) {
    this.config = {
      maxConnections: 10,
      connectionTimeout: 30000, // 30 seconds
      queryTimeout: 60000,      // 60 seconds
      enableQueryCache: true,
      cacheSize: 1000,
      cacheTTL: 300,            // 5 minutes
      ...config
    };

    this.metrics = {
      queryCount: 0,
      totalExecutionTime: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errorCount: 0,
      avgExecutionTime: 0
    };

    this.preparedStatements = new Map();
    this.queryCache = new NodeCache({
      maxKeys: this.config.cacheSize,
      stdTTL: this.config.cacheTTL,
      checkperiod: 60
    });

    this.initializeConnections();
  }

  /**
   * Get singleton instance of connection pool
   */
  static getInstance(config?: Partial<ConnectionConfig>): ConnectionPoolService {
    if (!ConnectionPoolService.instance) {
      ConnectionPoolService.instance = new ConnectionPoolService(config);
    }
    return ConnectionPoolService.instance;
  }

  /**
   * Initialize database connections with optimized settings
   */
  private initializeConnections(): void {
    // Primary connection for read/write operations
    this.primaryClient = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL
        }
      },
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' }
      ]
    });

    // Set up query logging for performance monitoring
    // Note: Prisma client events might vary by version
    try {
      (this.primaryClient as any).$on('query', (event: any) => {
        this.updateMetrics(event.duration, false);
      });

      (this.primaryClient as any).$on('error', (error: any) => {
        console.error('Database error:', error);
        this.metrics.errorCount++;
      });
    } catch (error) {
      console.warn('Could not set up Prisma event listeners:', error);
    }

    // Optional: Read replica for historical data queries
    if (process.env.DATABASE_REPLICA_URL) {
      this.replicaClient = new PrismaClient({
        datasources: {
          db: {
            url: process.env.DATABASE_REPLICA_URL
          }
        }
      });
    }
  }

  /**
   * Get optimized client for read operations (uses replica if available)
   */
  getReadClient(): PrismaClient {
    return this.replicaClient || this.primaryClient;
  }

  /**
   * Get client for write operations (always uses primary)
   */
  getWriteClient(): PrismaClient {
    return this.primaryClient;
  }

  /**
   * Execute cached query with performance monitoring
   */
  async cachedQuery<T = any>(
    sql: string, 
    params: any[] = [], 
    useCache: boolean = true
  ): Promise<T> {
    const cacheKey = this.generateCacheKey(sql, params);
    
    // Check cache first
    if (useCache && this.config.enableQueryCache) {
      const cached = this.queryCache.get<CachedQuery>(cacheKey);
      if (cached) {
        this.metrics.cacheHits++;
        return cached.result as T;
      }
      this.metrics.cacheMisses++;
    }

    // Execute query with timing
    const startTime = performance.now();
    let result: T;
    let error: any = null;

    try {
      const client = this.getReadClient();
      result = await client.$queryRawUnsafe(sql, ...params) as T;
    } catch (err) {
      error = err;
      this.metrics.errorCount++;
      throw err;
    } finally {
      const executionTime = performance.now() - startTime;
      this.updateMetrics(executionTime, !!error);
    }

    // Cache successful results
    if (!error && useCache && this.config.enableQueryCache) {
      const cached: CachedQuery = {
        sql,
        params,
        result,
        timestamp: Date.now(),
        executionTime: performance.now() - startTime
      };
      this.queryCache.set(cacheKey, cached);
    }

    return result!;
  }

  /**
   * Optimized queries for common backtest patterns
   */
  async getGlickoRatings(
    symbol: string, 
    startTime: Date, 
    endTime: Date
  ): Promise<any[]> {
    const sql = `
      SELECT symbol, timestamp, rating, rating_deviation, volatility 
      FROM glicko_ratings 
      WHERE symbol = $1 AND timestamp BETWEEN $2 AND $3
      ORDER BY timestamp
    `;
    
    return this.cachedQuery(sql, [symbol, startTime, endTime]);
  }

  async getKlinesData(
    symbol: string, 
    startTime: Date, 
    endTime: Date
  ): Promise<any[]> {
    const sql = `
      SELECT symbol, open_time, close, high, low, volume 
      FROM klines 
      WHERE symbol = $1 AND open_time BETWEEN $2 AND $3
      ORDER BY open_time
    `;
    
    return this.cachedQuery(sql, [symbol, startTime, endTime]);
  }

  async getOptimizationResults(
    baseAsset: string,
    quoteAsset: string,
    limit?: number
  ): Promise<any[]> {
    let sql = `
      SELECT * FROM optimization_results 
      WHERE base_asset = $1 AND quote_asset = $2
      ORDER BY annualized_return DESC, sharpe_ratio DESC
    `;
    
    const params: any[] = [baseAsset, quoteAsset];
    if (limit) {
      sql += ` LIMIT $3`;
      params.push(limit);
    }
    
    return this.cachedQuery(sql, params);
  }

  async getParameterCombination(
    baseAsset: string,
    quoteAsset: string,
    zScore: number,
    profit: number,
    stopLoss: number
  ): Promise<any[]> {
    const sql = `
      SELECT * FROM optimization_results
      WHERE base_asset = $1 AND quote_asset = $2
      AND z_score_threshold = $3 
      AND profit_percent = $4 
      AND stop_loss_percent = $5
      ORDER BY created_at DESC
    `;
    
    return this.cachedQuery(sql, [baseAsset, quoteAsset, zScore, profit, stopLoss]);
  }

  /**
   * Bulk data loading with optimized queries
   */
  async bulkLoadBacktestData(
    symbols: string[],
    startTime: Date,
    endTime: Date
  ): Promise<{ glicko: any[], klines: any[] }> {
    const symbolList = symbols.join("','");
    
    // Use parallel queries for better performance
    const [glickoPromise, klinesPromise] = await Promise.all([
      this.cachedQuery(`
        SELECT symbol, timestamp, rating, rating_deviation, volatility 
        FROM glicko_ratings 
        WHERE symbol IN ('${symbolList}') 
        AND timestamp BETWEEN $1 AND $2
        ORDER BY symbol, timestamp
      `, [startTime, endTime]),
      
      this.cachedQuery(`
        SELECT symbol, open_time, close, high, low, volume 
        FROM klines 
        WHERE symbol IN ('${symbolList}') 
        AND open_time BETWEEN $1 AND $2
        ORDER BY symbol, open_time
      `, [startTime, endTime])
    ]);

    return {
      glicko: await glickoPromise,
      klines: await klinesPromise
    };
  }

  /**
   * Clear query cache for specific patterns or all
   */
  clearCache(pattern?: string): void {
    if (pattern) {
      const keys = this.queryCache.keys().filter(key => key.includes(pattern));
      this.queryCache.del(keys);
    } else {
      this.queryCache.flushAll();
    }
  }

  /**
   * Generate cache key from SQL and parameters
   */
  private generateCacheKey(sql: string, params: any[]): string {
    const normalizedSql = sql.replace(/\s+/g, ' ').trim();
    const paramString = JSON.stringify(params);
    return `query:${Buffer.from(normalizedSql + paramString).toString('base64')}`;
  }

  /**
   * Update performance metrics
   */
  private updateMetrics(executionTime: number, isError: boolean): void {
    if (!isError) {
      this.metrics.queryCount++;
      this.metrics.totalExecutionTime += executionTime;
      this.metrics.avgExecutionTime = this.metrics.totalExecutionTime / this.metrics.queryCount;
    }
  }

  /**
   * Get performance metrics
   */
  getMetrics(): QueryMetrics & { cacheStats: any } {
    return {
      ...this.metrics,
      cacheStats: {
        keys: this.queryCache.keys().length,
        hits: this.queryCache.getStats().hits,
        misses: this.queryCache.getStats().misses,
        hitRate: this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses) * 100
      }
    };
  }

  /**
   * Health check for connections
   */
  async healthCheck(): Promise<{ primary: boolean; replica?: boolean }> {
    try {
      await this.primaryClient.$queryRaw`SELECT 1 as health`;
      const primaryHealth = true;

      let replicaHealth: boolean | undefined;
      if (this.replicaClient) {
        try {
          await this.replicaClient.$queryRaw`SELECT 1 as health`;
          replicaHealth = true;
        } catch {
          replicaHealth = false;
        }
      }

      return { primary: primaryHealth, replica: replicaHealth };
    } catch {
      return { primary: false };
    }
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    await this.primaryClient.$disconnect();
    if (this.replicaClient) {
      await this.replicaClient.$disconnect();
    }
    this.queryCache.close();
  }

  /**
   * Reset singleton instance (for testing)
   */
  static reset(): void {
    if (ConnectionPoolService.instance) {
      ConnectionPoolService.instance.close();
      ConnectionPoolService.instance = null as any;
    }
  }
}

export { ConnectionPoolService, ConnectionConfig, QueryMetrics };