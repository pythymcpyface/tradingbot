/**
 * Performance Monitor Service
 * 
 * Comprehensive performance monitoring and benchmarking system for
 * tracking backtest optimization improvements and system health.
 * 
 * Features:
 * - Real-time performance metrics
 * - Benchmark comparisons (before/after optimizations)
 * - Memory usage tracking
 * - Database query performance monitoring
 * - Cache hit rate analysis
 * - Resource utilization metrics
 * - Performance regression detection
 */

import * as os from 'os';
import { EventEmitter } from 'events';

interface PerformanceMetrics {
  timestamp: number;
  
  // Execution metrics
  executionTime: number;
  throughput: number; // operations per second
  
  // Memory metrics
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number; // Resident Set Size
  };
  
  // CPU metrics
  cpuUsage: {
    user: number;
    system: number;
    percent: number;
  };
  
  // Database metrics
  database: {
    queryCount: number;
    avgQueryTime: number;
    slowQueries: number; // queries > 1 second
    connectionPool: {
      active: number;
      idle: number;
      waiting: number;
    };
  };
  
  // Cache metrics
  cache: {
    hitRate: number;
    missRate: number;
    evictions: number;
    memoryUsage: number;
  };
  
  // Custom metrics
  custom: Map<string, number>;
}

interface BenchmarkResult {
  name: string;
  description: string;
  executionTime: number;
  memoryUsage: number;
  throughput: number;
  success: boolean;
  error?: string;
  details?: any;
}

interface BenchmarkSuite {
  name: string;
  description: string;
  results: BenchmarkResult[];
  totalTime: number;
  avgMemoryUsage: number;
  successRate: number;
  timestamp: number;
}

interface PerformanceAlert {
  level: 'info' | 'warning' | 'error' | 'critical';
  metric: string;
  current: number;
  threshold: number;
  message: string;
  timestamp: number;
}

interface MonitorConfig {
  sampleInterval: number; // milliseconds
  alertThresholds: {
    memoryUsageMB: number;
    cpuPercent: number;
    queryTimeMs: number;
    cacheHitRate: number;
    throughputOps: number;
  };
  retentionPeriod: number; // milliseconds
  enableAlerts: boolean;
  enableAutoGC: boolean;
}

class PerformanceMonitorService extends EventEmitter {
  private static instance: PerformanceMonitorService;
  private metrics: PerformanceMetrics[] = [];
  private benchmarkHistory: BenchmarkSuite[] = [];
  private alerts: PerformanceAlert[] = [];
  private config: MonitorConfig;
  private monitorInterval?: NodeJS.Timeout;
  private baselineBenchmark?: BenchmarkSuite;
  private isMonitoring = false;

  // Performance tracking state
  private lastCpuUsage = process.cpuUsage();
  private operationCounters = new Map<string, { count: number; totalTime: number }>();
  private customMetrics = new Map<string, number>();

  private constructor(config?: Partial<MonitorConfig>) {
    super();
    
    this.config = {
      sampleInterval: 5000, // 5 seconds
      alertThresholds: {
        memoryUsageMB: 4096, // 4GB
        cpuPercent: 90,
        queryTimeMs: 1000,
        cacheHitRate: 70,
        throughputOps: 10
      },
      retentionPeriod: 24 * 60 * 60 * 1000, // 24 hours
      enableAlerts: true,
      enableAutoGC: true,
      ...config
    };
  }

  static getInstance(config?: Partial<MonitorConfig>): PerformanceMonitorService {
    if (!PerformanceMonitorService.instance) {
      PerformanceMonitorService.instance = new PerformanceMonitorService(config);
    }
    return PerformanceMonitorService.instance;
  }

  /**
   * Start performance monitoring
   */
  startMonitoring(): void {
    if (this.isMonitoring) return;

    console.log('📊 Starting performance monitoring...');
    this.isMonitoring = true;

    this.monitorInterval = setInterval(() => {
      this.collectMetrics();
    }, this.config.sampleInterval);

    // Clean up old metrics periodically
    setInterval(() => {
      this.cleanupOldMetrics();
    }, 60000); // Every minute

    // Auto garbage collection if enabled
    if (this.config.enableAutoGC) {
      setInterval(() => {
        const memUsage = process.memoryUsage();
        const memUsageMB = memUsage.heapUsed / 1024 / 1024;
        
        if (memUsageMB > this.config.alertThresholds.memoryUsageMB * 0.8) {
          global.gc && global.gc();
        }
      }, 30000); // Every 30 seconds
    }

    this.emit('monitoringStarted');
  }

  /**
   * Stop performance monitoring
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) return;

    console.log('📊 Stopping performance monitoring...');
    this.isMonitoring = false;

    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = undefined;
    }

    this.emit('monitoringStopped');
  }

  /**
   * Collect current performance metrics
   */
  private collectMetrics(): void {
    const now = Date.now();
    
    // Memory metrics
    const memUsage = process.memoryUsage();
    
    // CPU metrics
    const cpuUsage = process.cpuUsage(this.lastCpuUsage);
    this.lastCpuUsage = process.cpuUsage();
    
    const cpuPercent = (cpuUsage.user + cpuUsage.system) / 1000000 / (this.config.sampleInterval / 1000) * 100;

    // Create metrics snapshot
    const metrics: PerformanceMetrics = {
      timestamp: now,
      executionTime: 0, // Will be set by specific operations
      throughput: this.calculateThroughput(),
      
      memoryUsage: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
        rss: memUsage.rss
      },
      
      cpuUsage: {
        user: cpuUsage.user,
        system: cpuUsage.system,
        percent: Math.min(cpuPercent, 100)
      },
      
      database: {
        queryCount: 0, // Will be updated by database service
        avgQueryTime: 0,
        slowQueries: 0,
        connectionPool: {
          active: 0,
          idle: 0,
          waiting: 0
        }
      },
      
      cache: {
        hitRate: 0, // Will be updated by cache service
        missRate: 0,
        evictions: 0,
        memoryUsage: 0
      },
      
      custom: new Map(this.customMetrics)
    };

    this.metrics.push(metrics);
    
    // Check for alerts
    if (this.config.enableAlerts) {
      this.checkAlerts(metrics);
    }
    
    this.emit('metricsCollected', metrics);
  }

  /**
   * Calculate current throughput
   */
  private calculateThroughput(): number {
    const recentMetrics = this.metrics.slice(-10); // Last 10 samples
    if (recentMetrics.length < 2) return 0;

    const totalOps = Array.from(this.operationCounters.values())
      .reduce((sum, counter) => sum + counter.count, 0);
    
    const timeSpan = (Date.now() - recentMetrics[0].timestamp) / 1000; // seconds
    return timeSpan > 0 ? totalOps / timeSpan : 0;
  }

  /**
   * Check performance thresholds and generate alerts
   */
  private checkAlerts(metrics: PerformanceMetrics): void {
    const alerts: PerformanceAlert[] = [];
    
    // Memory usage alert
    const memUsageMB = metrics.memoryUsage.heapUsed / 1024 / 1024;
    if (memUsageMB > this.config.alertThresholds.memoryUsageMB) {
      alerts.push({
        level: 'warning',
        metric: 'memoryUsage',
        current: memUsageMB,
        threshold: this.config.alertThresholds.memoryUsageMB,
        message: `High memory usage: ${memUsageMB.toFixed(0)}MB`,
        timestamp: metrics.timestamp
      });
    }
    
    // CPU usage alert
    if (metrics.cpuUsage.percent > this.config.alertThresholds.cpuPercent) {
      alerts.push({
        level: 'warning',
        metric: 'cpuUsage',
        current: metrics.cpuUsage.percent,
        threshold: this.config.alertThresholds.cpuPercent,
        message: `High CPU usage: ${metrics.cpuUsage.percent.toFixed(1)}%`,
        timestamp: metrics.timestamp
      });
    }
    
    // Cache hit rate alert
    if (metrics.cache.hitRate > 0 && metrics.cache.hitRate < this.config.alertThresholds.cacheHitRate) {
      alerts.push({
        level: 'info',
        metric: 'cacheHitRate',
        current: metrics.cache.hitRate,
        threshold: this.config.alertThresholds.cacheHitRate,
        message: `Low cache hit rate: ${metrics.cache.hitRate.toFixed(1)}%`,
        timestamp: metrics.timestamp
      });
    }
    
    // Throughput alert
    if (metrics.throughput < this.config.alertThresholds.throughputOps) {
      alerts.push({
        level: 'info',
        metric: 'throughput',
        current: metrics.throughput,
        threshold: this.config.alertThresholds.throughputOps,
        message: `Low throughput: ${metrics.throughput.toFixed(1)} ops/sec`,
        timestamp: metrics.timestamp
      });
    }

    // Emit alerts
    alerts.forEach(alert => {
      this.alerts.push(alert);
      this.emit('alert', alert);
    });
  }

  /**
   * Record operation performance
   */
  recordOperation(name: string, executionTime: number): void {
    const counter = this.operationCounters.get(name) || { count: 0, totalTime: 0 };
    counter.count++;
    counter.totalTime += executionTime;
    this.operationCounters.set(name, counter);
  }

  /**
   * Set custom metric
   */
  setCustomMetric(name: string, value: number): void {
    this.customMetrics.set(name, value);
  }

  /**
   * Run benchmark suite
   */
  async runBenchmark(
    name: string,
    description: string,
    benchmarks: Array<{
      name: string;
      description: string;
      fn: () => Promise<any> | any;
    }>
  ): Promise<BenchmarkSuite> {
    console.log(`🏃 Running benchmark suite: ${name}`);
    
    const results: BenchmarkResult[] = [];
    const startTime = Date.now();
    let totalMemoryUsage = 0;

    for (const benchmark of benchmarks) {
      console.log(`   Running: ${benchmark.name}`);
      
      const initialMemory = process.memoryUsage().heapUsed;
      const benchmarkStart = performance.now();
      let success = true;
      let error: string | undefined;
      let result: any;

      try {
        result = await benchmark.fn();
      } catch (err) {
        success = false;
        error = err instanceof Error ? err.message : String(err);
      }

      const executionTime = performance.now() - benchmarkStart;
      const memoryUsage = process.memoryUsage().heapUsed - initialMemory;
      totalMemoryUsage += memoryUsage;

      results.push({
        name: benchmark.name,
        description: benchmark.description,
        executionTime,
        memoryUsage,
        throughput: executionTime > 0 ? 1000 / executionTime : 0,
        success,
        error,
        details: result
      });

      console.log(`     ✅ ${executionTime.toFixed(2)}ms, ${(memoryUsage / 1024 / 1024).toFixed(2)}MB`);
    }

    const totalTime = Date.now() - startTime;
    const successCount = results.filter(r => r.success).length;
    const avgMemoryUsage = totalMemoryUsage / results.length;

    const suite: BenchmarkSuite = {
      name,
      description,
      results,
      totalTime,
      avgMemoryUsage,
      successRate: (successCount / results.length) * 100,
      timestamp: Date.now()
    };

    this.benchmarkHistory.push(suite);
    
    console.log(`🏁 Benchmark completed: ${successCount}/${results.length} passed, ${totalTime}ms total`);
    
    this.emit('benchmarkCompleted', suite);
    return suite;
  }

  /**
   * Set baseline benchmark for comparison
   */
  setBaseline(suite: BenchmarkSuite): void {
    this.baselineBenchmark = { ...suite };
    console.log(`📊 Baseline set: ${suite.name}`);
  }

  /**
   * Compare current performance against baseline
   */
  compareToBaseline(current: BenchmarkSuite): {
    overall: { improvement: number; regression: boolean };
    details: Array<{
      name: string;
      improvement: number;
      regression: boolean;
      current: number;
      baseline: number;
    }>;
  } {
    if (!this.baselineBenchmark) {
      throw new Error('No baseline benchmark set');
    }

    const details = current.results.map(currentResult => {
      const baselineResult = this.baselineBenchmark!.results
        .find(r => r.name === currentResult.name);
      
      if (!baselineResult) {
        return {
          name: currentResult.name,
          improvement: 0,
          regression: false,
          current: currentResult.executionTime,
          baseline: 0
        };
      }

      const improvement = (baselineResult.executionTime - currentResult.executionTime) / baselineResult.executionTime * 100;
      
      return {
        name: currentResult.name,
        improvement,
        regression: improvement < -5, // > 5% slower is regression
        current: currentResult.executionTime,
        baseline: baselineResult.executionTime
      };
    });

    const avgImprovement = details.reduce((sum, d) => sum + d.improvement, 0) / details.length;
    const hasRegression = details.some(d => d.regression);

    return {
      overall: {
        improvement: avgImprovement,
        regression: hasRegression
      },
      details
    };
  }

  /**
   * Get current system health status
   */
  getHealthStatus(): {
    status: 'healthy' | 'warning' | 'critical';
    metrics: PerformanceMetrics | null;
    alerts: PerformanceAlert[];
    details: {
      memoryUsage: string;
      cpuUsage: string;
      cachePerformance: string;
      throughput: string;
    };
  } {
    const latestMetrics = this.metrics[this.metrics.length - 1];
    const recentAlerts = this.alerts.filter(a => Date.now() - a.timestamp < 300000); // 5 minutes
    
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    
    if (recentAlerts.some(a => a.level === 'critical')) {
      status = 'critical';
    } else if (recentAlerts.some(a => a.level === 'error' || a.level === 'warning')) {
      status = 'warning';
    }

    const details = latestMetrics ? {
      memoryUsage: `${(latestMetrics.memoryUsage.heapUsed / 1024 / 1024).toFixed(0)}MB`,
      cpuUsage: `${latestMetrics.cpuUsage.percent.toFixed(1)}%`,
      cachePerformance: `${latestMetrics.cache.hitRate.toFixed(1)}% hit rate`,
      throughput: `${latestMetrics.throughput.toFixed(1)} ops/sec`
    } : {
      memoryUsage: 'N/A',
      cpuUsage: 'N/A', 
      cachePerformance: 'N/A',
      throughput: 'N/A'
    };

    return {
      status,
      metrics: latestMetrics || null,
      alerts: recentAlerts,
      details
    };
  }

  /**
   * Get performance summary for time period
   */
  getSummary(periodMs: number = 3600000): { // 1 hour default
    avgMemoryUsage: number;
    avgCpuUsage: number;
    avgThroughput: number;
    peakMemoryUsage: number;
    peakCpuUsage: number;
    totalAlerts: number;
    cacheStats: {
      avgHitRate: number;
      totalEvictions: number;
    };
  } {
    const cutoff = Date.now() - periodMs;
    const recentMetrics = this.metrics.filter(m => m.timestamp > cutoff);
    
    if (recentMetrics.length === 0) {
      return {
        avgMemoryUsage: 0,
        avgCpuUsage: 0,
        avgThroughput: 0,
        peakMemoryUsage: 0,
        peakCpuUsage: 0,
        totalAlerts: 0,
        cacheStats: { avgHitRate: 0, totalEvictions: 0 }
      };
    }

    const avgMemoryUsage = recentMetrics
      .reduce((sum, m) => sum + m.memoryUsage.heapUsed, 0) / recentMetrics.length;
    
    const avgCpuUsage = recentMetrics
      .reduce((sum, m) => sum + m.cpuUsage.percent, 0) / recentMetrics.length;
    
    const avgThroughput = recentMetrics
      .reduce((sum, m) => sum + m.throughput, 0) / recentMetrics.length;
    
    const peakMemoryUsage = Math.max(...recentMetrics.map(m => m.memoryUsage.heapUsed));
    const peakCpuUsage = Math.max(...recentMetrics.map(m => m.cpuUsage.percent));
    
    const recentAlerts = this.alerts.filter(a => a.timestamp > cutoff);
    
    const cacheHitRates = recentMetrics.map(m => m.cache.hitRate).filter(r => r > 0);
    const avgHitRate = cacheHitRates.length > 0 ? 
      cacheHitRates.reduce((sum, r) => sum + r, 0) / cacheHitRates.length : 0;
    
    const totalEvictions = recentMetrics.reduce((sum, m) => sum + m.cache.evictions, 0);

    return {
      avgMemoryUsage: avgMemoryUsage / 1024 / 1024, // MB
      avgCpuUsage,
      avgThroughput,
      peakMemoryUsage: peakMemoryUsage / 1024 / 1024, // MB
      peakCpuUsage,
      totalAlerts: recentAlerts.length,
      cacheStats: {
        avgHitRate,
        totalEvictions
      }
    };
  }

  /**
   * Clean up old metrics
   */
  private cleanupOldMetrics(): void {
    const cutoff = Date.now() - this.config.retentionPeriod;
    
    this.metrics = this.metrics.filter(m => m.timestamp > cutoff);
    this.alerts = this.alerts.filter(a => a.timestamp > cutoff);
    this.benchmarkHistory = this.benchmarkHistory.filter(b => b.timestamp > cutoff);
  }

  /**
   * Export performance data
   */
  exportData(): {
    metrics: PerformanceMetrics[];
    benchmarks: BenchmarkSuite[];
    alerts: PerformanceAlert[];
    config: MonitorConfig;
  } {
    return {
      metrics: [...this.metrics],
      benchmarks: [...this.benchmarkHistory],
      alerts: [...this.alerts],
      config: { ...this.config }
    };
  }

  /**
   * Reset all monitoring data
   */
  reset(): void {
    this.metrics = [];
    this.benchmarkHistory = [];
    this.alerts = [];
    this.operationCounters.clear();
    this.customMetrics.clear();
    this.baselineBenchmark = undefined;
    
    console.log('📊 Performance monitor reset');
  }

  /**
   * Shutdown monitoring service
   */
  shutdown(): void {
    this.stopMonitoring();
    this.reset();
    this.removeAllListeners();
  }

  static resetInstance(): void {
    if (PerformanceMonitorService.instance) {
      PerformanceMonitorService.instance.shutdown();
      PerformanceMonitorService.instance = null as any;
    }
  }
}

export { 
  PerformanceMonitorService, 
  PerformanceMetrics, 
  BenchmarkResult, 
  BenchmarkSuite,
  PerformanceAlert,
  MonitorConfig 
};