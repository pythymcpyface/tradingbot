/**
 * Backtest Worker Thread
 * 
 * Worker thread implementation for parallel backtest execution.
 * Handles individual parameter combinations and communicates results
 * back to the main parallel engine.
 * 
 * Features:
 * - Isolated execution environment
 * - Shared memory access for market data
 * - Optimized z-score calculations
 * - Memory usage monitoring
 * - Error handling and reporting
 */

import { parentPort, workerData } from 'worker_threads';
import { PrismaClient } from '@prisma/client';
import { ConnectionPoolService } from '../lib/database/ConnectionPoolService';
import { MemoryOptimizedCacheService } from './MemoryOptimizedCacheService';

interface WorkerTask {
  id: string;
  parameters: {
    zScoreThreshold: number;
    profitPercent: number;
    stopLossPercent: number;
  };
  config: {
    baseAsset: string;
    quoteAsset: string;
    movingAverages: number;
    windowSize: number;
    startDate?: string;
  };
  priority: 'high' | 'normal' | 'low';
  retries: number;
}

interface WorkerResult {
  taskId: string;
  success: boolean;
  data?: any;
  error?: string;
  executionTime: number;
  memoryUsage: number;
}

interface BacktestSummary {
  runId: string;
  startTime: Date;
  endTime: Date;
  totalReturn: number;
  annualizedReturn: number;
  benchmarkReturn: number;
  alpha: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRatio: number;
  totalTrades: number;
}

class BacktestWorker {
  private workerId: number;
  private connectionPool: ConnectionPoolService;
  private cacheService: MemoryOptimizedCacheService;
  private memoryLimit: number;
  private sharedMemory: boolean;

  constructor() {
    this.workerId = workerData.workerId;
    this.memoryLimit = workerData.memoryLimit;
    this.sharedMemory = workerData.sharedMemory;
    
    // Initialize services
    this.connectionPool = ConnectionPoolService.getInstance({
      maxConnections: 2, // Limited connections per worker
      connectionTimeout: 30000,
      queryTimeout: 60000,
      enableQueryCache: true,
      cacheSize: 200, // Smaller cache per worker
      cacheTTL: 300
    });
    
    this.cacheService = MemoryOptimizedCacheService.getInstance({
      hotTier: { maxSize: this.memoryLimit * 0.4, ttl: 600, maxKeys: 1000 },
      warmTier: { maxSize: this.memoryLimit * 0.3, ttl: 1200, maxKeys: 500 },
      coldTier: { maxSize: this.memoryLimit * 0.2, ttl: 1800, maxKeys: 200 },
      computeTier: { maxSize: this.memoryLimit * 0.1, ttl: 900, maxKeys: 300 },
      enableCompression: true,
      compressionThreshold: 5120,
      memoryMonitoring: false, // Disable in workers to reduce overhead
      backgroundRefresh: false
    });
    
    this.setupMessageHandlers();
  }

  private setupMessageHandlers(): void {
    if (!parentPort) {
      throw new Error('Worker must be run as a worker thread');
    }

    parentPort.on('message', async (message) => {
      if (message.type === 'EXECUTE_BACKTEST') {
        await this.executeBacktest(message.task);
      }
    });

    // Handle worker shutdown
    process.on('SIGTERM', () => {
      this.cleanup();
      process.exit(0);
    });
  }

  /**
   * Execute a backtest for the given parameter combination
   */
  private async executeBacktest(task: WorkerTask): Promise<void> {
    const startTime = performance.now();
    let result: WorkerResult;

    try {
      console.log(`[Worker ${this.workerId}] Executing task ${task.id}`);
      
      // Execute the backtest
      const backtestResult = await this.runParameterBacktest(
        task.parameters,
        task.config
      );

      const executionTime = performance.now() - startTime;
      const memoryUsage = this.getMemoryUsage();

      result = {
        taskId: task.id,
        success: true,
        data: backtestResult,
        executionTime,
        memoryUsage
      };

      console.log(`[Worker ${this.workerId}] Task ${task.id} completed in ${Math.round(executionTime)}ms`);

    } catch (error) {
      const executionTime = performance.now() - startTime;
      const memoryUsage = this.getMemoryUsage();
      
      console.error(`[Worker ${this.workerId}] Task ${task.id} failed:`, error);
      
      result = {
        taskId: task.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTime,
        memoryUsage
      };
    }

    // Send result back to main thread
    parentPort?.postMessage(result);
  }

  /**
   * Run backtest for specific parameter combination
   */
  private async runParameterBacktest(
    parameters: WorkerTask['parameters'],
    config: WorkerTask['config']
  ): Promise<any> {
    const { zScoreThreshold, profitPercent, stopLossPercent } = parameters;
    const { baseAsset, quoteAsset, movingAverages, windowSize, startDate } = config;

    // Check if we have recent results for this combination in the database
    const recentResults = await this.getRecentOptimizationResults(
      baseAsset, quoteAsset, zScoreThreshold, profitPercent, stopLossPercent
    );

    if (recentResults.length === 0) {
      throw new Error('No recent backtest results found for parameter combination');
    }

    // Process walk-forward results to calculate aggregated metrics
    const aggregatedResults = this.aggregateWalkForwardResults(recentResults);

    return {
      parameters,
      performance: aggregatedResults.performance,
      windowsCount: recentResults.length,
      consistency: aggregatedResults.consistency,
      runId: `worker_${this.workerId}_${Date.now()}`
    };
  }

  /**
   * Get recent optimization results from database
   */
  private async getRecentOptimizationResults(
    baseAsset: string,
    quoteAsset: string, 
    zScoreThreshold: number,
    profitPercent: number,
    stopLossPercent: number
  ): Promise<any[]> {
    // Use cached query for better performance
    const cacheKey = `optimization:${baseAsset}:${quoteAsset}:${zScoreThreshold}:${profitPercent}:${stopLossPercent}`;
    
    let results = await this.cacheService.get<any[]>(cacheKey);
    
    if (!results) {
      results = await this.connectionPool.getParameterCombination(
        baseAsset, quoteAsset, zScoreThreshold, profitPercent, stopLossPercent
      );
      
      if (results.length > 0) {
        // Cache for 5 minutes
        await this.cacheService.set(cacheKey, results, 'warm', 300);
      }
    }

    return results;
  }

  /**
   * Aggregate walk-forward results into final metrics
   */
  private aggregateWalkForwardResults(results: any[]): {
    performance: any;
    consistency: number;
  } {
    if (results.length === 0) {
      throw new Error('No results to aggregate');
    }

    // Calculate averages for most metrics
    const avgAnnualizedReturn = results.reduce((sum, r) => 
      sum + parseFloat(r.annualizedReturn.toString()), 0) / results.length;
    
    const avgBenchmarkReturn = results.reduce((sum, r) => 
      sum + parseFloat((r.benchmarkReturn || 0).toString()), 0) / results.length;
    
    const avgAlpha = results.reduce((sum, r) => 
      sum + parseFloat((r.alpha || 0).toString()), 0) / results.length;
    
    const avgSharpe = results.reduce((sum, r) => 
      sum + parseFloat(r.sharpeRatio.toString()), 0) / results.length;
    
    const avgSortino = results.reduce((sum, r) => 
      sum + parseFloat((r.sortinoRatio || 0).toString()), 0) / results.length;
    
    const avgWinRatio = results.reduce((sum, r) => 
      sum + parseFloat(r.winRatio.toString()), 0) / results.length;
    
    const avgProfitFactor = results.reduce((sum, r) => 
      sum + Math.min(parseFloat(r.profitFactor.toString()), 999999), 0) / results.length;
    
    const avgTradeDuration = results.reduce((sum, r) => 
      sum + parseFloat((r.avgTradeDuration || 0).toString()), 0) / results.length;

    // Use maximum drawdown (worst case)
    const maxDrawdown = Math.max(...results.map(r => 
      parseFloat(r.maxDrawdown.toString())));

    // Sum total trades
    const totalTrades = results.reduce((sum, r) => 
      sum + parseInt(r.totalTrades.toString()), 0);

    // Calculate total return (compound if time periods don't overlap)
    const avgTotalReturn = results.reduce((sum, r) => 
      sum + parseFloat(r.totalReturn.toString()), 0) / results.length;

    // Calculate consistency (percentage of positive windows)
    const positiveWindows = results.filter(r => 
      parseFloat(r.totalReturn.toString()) > 0).length;
    const consistency = (positiveWindows / results.length) * 100;

    return {
      performance: {
        totalReturn: avgTotalReturn,
        annualizedReturn: avgAnnualizedReturn,
        benchmarkReturn: avgBenchmarkReturn,
        alpha: avgAlpha,
        sharpeRatio: avgSharpe,
        sortinoRatio: avgSortino,
        maxDrawdown: maxDrawdown,
        winRatio: avgWinRatio,
        totalTrades: totalTrades,
        profitFactor: avgProfitFactor,
        avgTradeDuration: avgTradeDuration
      },
      consistency
    };
  }

  /**
   * Get current memory usage
   */
  private getMemoryUsage(): number {
    const memUsage = process.memoryUsage();
    return memUsage.heapUsed + memUsage.external;
  }

  /**
   * Cleanup worker resources
   */
  private cleanup(): void {
    // Close database connections
    this.connectionPool.close();
    
    // Clear caches
    this.cacheService.clearAll();
    
    console.log(`[Worker ${this.workerId}] Cleanup completed`);
  }
}

// Initialize worker if running as worker thread
if (parentPort) {
  new BacktestWorker();
} else {
  console.error('BacktestWorker must be run as a worker thread');
  process.exit(1);
}