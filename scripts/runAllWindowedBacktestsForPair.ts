#!/usr/bin/env ts-node

/**
 * Run All Windowed Backtests For Pair - 3D Parameter Optimization
 * 
 * This script runs comprehensive parameter optimization using the windowed backtest methodology.
 * It tests all combinations of Z-Score thresholds, profit percentages, and stop-loss percentages
 * to find robust parameter regions (plateaus) rather than overfit peaks.
 * 
 * The script generates 3D interactive visualizations and multivariate analysis to identify
 * stable parameter combinations that perform well across different market conditions.
 * 
 * Parameter ranges can be:
 * 1. Loaded from .env file defaults (ZSCORE_THRESHOLDS, PROFIT_PERCENTS, STOP_LOSS_PERCENTS, DEFAULT_MOVING_AVERAGE)
 * 2. Overridden via command-line arguments for custom ranges
 * 3. Mixed approach: override some parameters while using .env defaults for others
 * 
 * Usage Examples:
 *   # Use .env defaults:
 *   npm run runAllWindowedBacktestsForPair ETH USDT
 *   npm run runAllWindowedBacktestsForPair BTC USDT 12 "2021-08-01"
 *   
 *   # Custom parameter ranges:
 *   npm run runAllWindowedBacktestsForPair ETH USDT --zscores=2.0,2.5,3.0 --profits=4.0,5.0,6.0 --stops=2.0,2.5,3.0
 *   npm run runAllWindowedBacktestsForPair BTC USDT 6 --ma=20 --zscores=1.5,2.0,2.5
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

config();

interface ParameterCombination {
  zScoreThreshold: number;
  profitPercent: number;
  stopLossPercent: number;
}

interface OptimizationResult {
  parameters: ParameterCombination;
  performance: {
    totalReturn: number;
    annualizedReturn: number;
    benchmarkReturn: number;
    alpha: number;
    sharpeRatio: number;
    sortinoRatio: number;
    maxDrawdown: number;
    winRatio: number;
    totalTrades: number;
    profitFactor: number;
    avgTradeDuration: number;
  };
  windowsCount: number;
  consistency: number; // Percentage of positive windows
  runId: string;
}

interface OptimizationConfig {
  baseAsset: string;
  quoteAsset: string;
  movingAverages: number;
  windowSize: number;
  startDate?: string;
}

interface OptimizationProgress {
  totalCombinations: number;
  completed: number;
  successful: number;
  failed: number;
  bestResult?: OptimizationResult;
  failureLog: Array<{
    parameters: ParameterCombination;
    reason: string;
    timestamp: Date;
  }>;
}

class ParameterOptimizer {
  private prisma: PrismaClient;
  private progress: OptimizationProgress;
  public logFile: string;

  // Parameter ranges for optimization (configurable)
  private readonly Z_SCORE_THRESHOLDS: number[];
  private readonly PROFIT_PERCENTS: number[];
  private readonly STOP_LOSS_PERCENTS: number[];
  private readonly MOVING_AVERAGES: number;

  constructor(
    zScoreThresholds?: number[],
    profitPercents?: number[],
    stopLossPercents?: number[],
    movingAverages?: number
  ) {
    this.prisma = new PrismaClient();
    
    // Load defaults from environment variables if not provided
    // If custom parameters are provided, use ONLY those parameters (don't mix with defaults)
    this.Z_SCORE_THRESHOLDS = zScoreThresholds && zScoreThresholds.length > 0 
      ? zScoreThresholds 
      : this.parseEnvArray('ZSCORE_THRESHOLDS', [1.5, 2.0, 2.5, 3.0, 3.5, 4.0]);
    this.PROFIT_PERCENTS = profitPercents && profitPercents.length > 0 
      ? profitPercents 
      : this.parseEnvArray('PROFIT_PERCENTS', [3.0, 4.0, 5.0, 6.0, 7.0, 8.0]);
    this.STOP_LOSS_PERCENTS = stopLossPercents && stopLossPercents.length > 0 
      ? stopLossPercents 
      : this.parseEnvArray('STOP_LOSS_PERCENTS', [1.5, 2.0, 2.5, 3.0, 3.5, 4.0]);
    this.MOVING_AVERAGES = movingAverages || parseInt(process.env.DEFAULT_MOVING_AVERAGE || '10');
    
    // Initialize progress tracking
    this.progress = {
      totalCombinations: this.Z_SCORE_THRESHOLDS.length * this.PROFIT_PERCENTS.length * this.STOP_LOSS_PERCENTS.length,
      completed: 0,
      successful: 0,
      failed: 0,
      failureLog: []
    };
    
    // Create log file name
    this.logFile = path.join('analysis', `optimization-progress-${Date.now()}.log`);
  }

  /**
   * Parse comma-separated environment variable into number array
   */
  private parseEnvArray(envKey: string, fallback: number[]): number[] {
    const envValue = process.env[envKey];
    if (!envValue) return fallback;
    
    try {
      return envValue.split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
    } catch (error) {
      console.warn(`⚠️ Failed to parse ${envKey} from environment, using fallback`);
      return fallback;
    }
  }

  async initialize(): Promise<void> {
    try {
      await this.prisma.$connect();
      console.log('✅ Connected to database');
      
      // Ensure analysis directory exists for logs
      if (!fs.existsSync('analysis')) {
        fs.mkdirSync('analysis');
      }
      
      // Initialize log file
      this.writeLog('='.repeat(80));
      this.writeLog(`Optimization started: ${new Date().toISOString()}`);
      this.writeLog(`Total parameter combinations: ${this.progress.totalCombinations}`);
      this.writeLog(`Z-Score Thresholds: [${this.Z_SCORE_THRESHOLDS.join(', ')}]`);
      this.writeLog(`Profit Percents: [${this.PROFIT_PERCENTS.join(', ')}]%`);
      this.writeLog(`Stop Loss Percents: [${this.STOP_LOSS_PERCENTS.join(', ')}]%`);
      this.writeLog(`Moving Average: ${this.MOVING_AVERAGES}`);
      this.writeLog('='.repeat(80));
      
    } catch (error) {
      console.error('❌ Database connection failed:', error);
      throw error;
    }
  }

  /**
   * Write to log file
   */
  private writeLog(message: string): void {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(this.logFile, logEntry);
  }

  /**
   * Log failure with details
   */
  private logFailure(params: ParameterCombination, reason: string): void {
    const failure = {
      parameters: params,
      reason,
      timestamp: new Date()
    };
    
    this.progress.failureLog.push(failure);
    this.writeLog(`FAILURE: Z=${params.zScoreThreshold}, P=${params.profitPercent}%, S=${params.stopLossPercent}% - ${reason}`);
  }

  /**
   * Update progress and display current best
   */
  private updateProgress(result: OptimizationResult | null, params: ParameterCombination): void {
    this.progress.completed++;
    
    if (result) {
      this.progress.successful++;
      
      // Update best result if this is better
      if (!this.progress.bestResult || result.performance.annualizedReturn > this.progress.bestResult.performance.annualizedReturn) {
        this.progress.bestResult = result;
        this.writeLog(`NEW BEST: Z=${params.zScoreThreshold}, P=${params.profitPercent}%, S=${params.stopLossPercent}% - Return: ${result.performance.annualizedReturn.toFixed(2)}%`);
      }
    } else {
      this.progress.failed++;
    }

    // Display progress summary
    const progressPercent = (this.progress.completed / this.progress.totalCombinations * 100).toFixed(1);
    const successRate = this.progress.completed > 0 ? (this.progress.successful / this.progress.completed * 100).toFixed(1) : '0.0';
    
    console.log(`\n📊 Progress Summary [${this.progress.completed}/${this.progress.totalCombinations}] (${progressPercent}%)`);
    console.log(`   ✅ Successful: ${this.progress.successful} | ❌ Failed: ${this.progress.failed} | Success Rate: ${successRate}%`);
    
    if (this.progress.bestResult) {
      const best = this.progress.bestResult;
      console.log(`   🏆 Current Best: Z=${best.parameters.zScoreThreshold}, P=${best.parameters.profitPercent}%, S=${best.parameters.stopLossPercent}%`);
      console.log(`      Return: ${best.performance.annualizedReturn.toFixed(2)}%, Alpha: ${best.performance.alpha.toFixed(2)}%, Sharpe: ${best.performance.sharpeRatio.toFixed(2)}, Consistency: ${best.consistency.toFixed(1)}%`);
    } else {
      console.log(`   🏆 Current Best: None found yet`);
    }
    
    // Show recent failures summary
    if (this.progress.failed > 0) {
      const recentFailures = this.progress.failureLog.slice(-3);
      console.log(`   ⚠️ Recent Failures: ${recentFailures.map(f => `Z=${f.parameters.zScoreThreshold}`).join(', ')}`);
    }
    
    console.log(`   📄 Log File: ${this.logFile}`);
  }

  /**
   * Generate all parameter combinations
   */
  generateParameterGrid(): ParameterCombination[] {
    const combinations: ParameterCombination[] = [];

    for (const zScore of this.Z_SCORE_THRESHOLDS) {
      for (const profit of this.PROFIT_PERCENTS) {
        for (const stopLoss of this.STOP_LOSS_PERCENTS) {
          combinations.push({
            zScoreThreshold: zScore,
            profitPercent: profit,
            stopLossPercent: stopLoss
          });
        }
      }
    }

    return combinations;
  }

  /**
   * Run optimization for a specific parameter combination
   */
  private async runParameterCombination(
    config: OptimizationConfig,
    params: ParameterCombination
  ): Promise<OptimizationResult | null> {
    return new Promise((resolve, reject) => {
      const args = [
        'scripts/runAllWindowedBacktests.ts',
        config.windowSize.toString(),
        config.baseAsset,
        config.quoteAsset,
        params.zScoreThreshold.toString(),
        this.MOVING_AVERAGES.toString(),
        params.profitPercent.toString(),
        params.stopLossPercent.toString()
      ];

      // Add start date if provided
      if (config.startDate) {
        args.splice(1, 0, config.startDate);
      }

      const child = spawn('npx', ['ts-node', ...args], {
        stdio: 'pipe'
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', async (code) => {
        if (code === 0) {
          try {
            // Parse performance metrics from stdout
            const avgReturnMatch = stdout.match(/Average return per window: (-?\d+\.?\d*)%/);
            const benchmarkMatch = stdout.match(/Benchmark.*?(-?\d+\.?\d*)%/);
            const windowsMatch = stdout.match(/Windows analyzed: (\d+)/);
            const consistencyMatch = stdout.match(/Positive windows: \d+\/\d+ \((\d+\.?\d*)%\)/);

            if (!avgReturnMatch || !windowsMatch) {
              const reason = 'Could not parse backtest output - no performance metrics found';
              console.log(`⚠️ ${reason} for params: Z=${params.zScoreThreshold}, P=${params.profitPercent}, S=${params.stopLossPercent}`);
              resolve(null);
              return;
            }

            // Query database for the most recent optimization results for this combination
            const recentResults = await this.prisma.optimizationResults.findMany({
              where: {
                baseAsset: config.baseAsset,
                quoteAsset: config.quoteAsset,
                zScoreThreshold: params.zScoreThreshold,
                profitPercent: params.profitPercent,
                stopLossPercent: params.stopLossPercent
              },
              orderBy: { createdAt: 'desc' },
              take: parseInt(windowsMatch[1]) || 10
            });

            if (recentResults.length === 0) {
              const reason = 'No database results found - backtest may have failed to save';
              console.log(`⚠️ ${reason} for params: Z=${params.zScoreThreshold}, P=${params.profitPercent}, S=${params.stopLossPercent}`);
              resolve(null);
              return;
            }

            // Calculate aggregate metrics from all windows (convert Decimal to number)
            const avgAnnualizedReturn = recentResults.reduce((sum, r) => sum + parseFloat(r.annualizedReturn.toString()), 0) / recentResults.length;
            const avgBenchmarkReturn = recentResults.reduce((sum, r) => sum + parseFloat((r.benchmarkReturn || 0).toString()), 0) / recentResults.length;
            const avgAlpha = recentResults.reduce((sum, r) => sum + parseFloat((r.alpha || 0).toString()), 0) / recentResults.length;
            const avgSharpe = recentResults.reduce((sum, r) => sum + parseFloat(r.sharpeRatio.toString()), 0) / recentResults.length;
            const avgSortino = recentResults.reduce((sum, r) => sum + parseFloat((r.sortinoRatio || 0).toString()), 0) / recentResults.length;
            const maxDrawdown = Math.max(...recentResults.map(r => parseFloat(r.maxDrawdown.toString())));
            const avgWinRatio = recentResults.reduce((sum, r) => sum + parseFloat(r.winRatio.toString()), 0) / recentResults.length;
            const totalTrades = recentResults.reduce((sum, r) => sum + parseInt(r.totalTrades.toString()), 0);
            const avgProfitFactor = recentResults.reduce((sum, r) => sum + Math.min(parseFloat(r.profitFactor.toString()), 999999), 0) / recentResults.length;
            const avgTradeDuration = recentResults.reduce((sum, r) => sum + parseFloat((r.avgTradeDuration || 0).toString()), 0) / recentResults.length;

            const consistency = parseFloat(consistencyMatch?.[1] || '0');

            const result: OptimizationResult = {
              parameters: params,
              performance: {
                totalReturn: parseFloat(avgReturnMatch[1]),
                annualizedReturn: avgAnnualizedReturn,
                benchmarkReturn: avgBenchmarkReturn,
                alpha: avgAlpha,
                sharpeRatio: avgSharpe,
                sortinoRatio: avgSortino,
                maxDrawdown,
                winRatio: avgWinRatio,
                totalTrades,
                profitFactor: avgProfitFactor,
                avgTradeDuration
              },
              windowsCount: recentResults.length,
              consistency,
              runId: `opt_${config.baseAsset}${config.quoteAsset}_${params.zScoreThreshold}_${params.profitPercent}_${params.stopLossPercent}_${Date.now()}`
            };

            resolve(result);
          } catch (error) {
            console.error(`❌ Error processing results for params: Z=${params.zScoreThreshold}, P=${params.profitPercent}, S=${params.stopLossPercent}:`, error);
            resolve(null);
          }
        } else {
          const reason = `Backtest subprocess failed with exit code ${code}`;
          console.error(`❌ ${reason} for params: Z=${params.zScoreThreshold}, P=${params.profitPercent}, S=${params.stopLossPercent}`);
          console.error(`   stderr: ${stderr.slice(0, 200)}...`);
          resolve(null);
        }
      });

      child.on('error', (error) => {
        const reason = `Failed to start backtest subprocess: ${error.message}`;
        console.error(`❌ ${reason}`);
        resolve(null);
      });
    });
  }

  /**
   * Run the complete parameter optimization
   */
  async runOptimization(config: OptimizationConfig): Promise<OptimizationResult[]> {
    const combinations = this.generateParameterGrid();
    const results: OptimizationResult[] = [];

    console.log(`🚀 Starting 3D Parameter Optimization for ${config.baseAsset}/${config.quoteAsset}`);
    console.log(`📊 Testing ${combinations.length} parameter combinations:`);
    console.log(`   Z-Score Thresholds: [${this.Z_SCORE_THRESHOLDS.join(', ')}]`);
    console.log(`   Profit Percents: [${this.PROFIT_PERCENTS.join(', ')}]%`);
    console.log(`   Stop Loss Percents: [${this.STOP_LOSS_PERCENTS.join(', ')}]%`);
    console.log(`   Moving Average: ${this.MOVING_AVERAGES} (fixed)`);
    console.log(`='`.repeat(80));

    for (let i = 0; i < combinations.length; i++) {
      const params = combinations[i];
      const individualProgress = ((i + 1) / combinations.length * 100).toFixed(1);
      
      console.log(`\n[${i + 1}/${combinations.length}] (${individualProgress}%) Testing: Z=${params.zScoreThreshold}, P=${params.profitPercent}%, S=${params.stopLossPercent}%`);
      
      this.writeLog(`Testing combination ${i + 1}/${combinations.length}: Z=${params.zScoreThreshold}, P=${params.profitPercent}%, S=${params.stopLossPercent}%`);

      try {
        const result = await this.runParameterCombination(config, params);
        
        if (result) {
          results.push(result);
          console.log(`   ✅ Return: ${result.performance.annualizedReturn.toFixed(2)}%, Alpha: ${result.performance.alpha.toFixed(2)}%, Sharpe: ${result.performance.sharpeRatio.toFixed(2)}, Consistency: ${result.consistency.toFixed(1)}%`);
          this.writeLog(`SUCCESS: Return: ${result.performance.annualizedReturn.toFixed(2)}%, Alpha: ${result.performance.alpha.toFixed(2)}%, Sharpe: ${result.performance.sharpeRatio.toFixed(2)}`);
        } else {
          console.log(`   ❌ Failed or no results`);
          this.logFailure(params, 'Backtest execution or parsing failed');
        }
        
        // Update progress and show current best
        this.updateProgress(result, params);

        // Small delay to prevent system overload
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        console.error(`   ❌ Error:`, error);
        this.logFailure(params, `Exception: ${error instanceof Error ? error.message : String(error)}`);
        this.updateProgress(null, params);
      }
    }

    console.log(`\n✅ Parameter optimization completed: ${results.length}/${combinations.length} successful combinations`);
    
    // Log final summary
    this.writeLog('='.repeat(80));
    this.writeLog(`Optimization completed: ${new Date().toISOString()}`);
    this.writeLog(`Total combinations: ${this.progress.totalCombinations}`);
    this.writeLog(`Successful: ${this.progress.successful}`);
    this.writeLog(`Failed: ${this.progress.failed}`);
    this.writeLog(`Success rate: ${(this.progress.successful / this.progress.totalCombinations * 100).toFixed(1)}%`);
    
    if (this.progress.bestResult) {
      const best = this.progress.bestResult;
      this.writeLog(`Best result: Z=${best.parameters.zScoreThreshold}, P=${best.parameters.profitPercent}%, S=${best.parameters.stopLossPercent}%`);
      this.writeLog(`Best performance: Return=${best.performance.annualizedReturn.toFixed(2)}%, Alpha=${best.performance.alpha.toFixed(2)}%, Sharpe=${best.performance.sharpeRatio.toFixed(2)}`);
    }
    this.writeLog('='.repeat(80));
    
    return results;
  }

  /**
   * Identify parameter plateaus (stable regions) vs peaks (isolated high performance)
   */
  identifyPlateaus(results: OptimizationResult[]): {
    plateaus: OptimizationResult[];
    peaks: OptimizationResult[];
    analysis: string;
  } {
    if (results.length < 10) {
      return { plateaus: [], peaks: [], analysis: 'Insufficient data for plateau analysis' };
    }

    // Sort by annualized return
    const sortedResults = [...results].sort((a, b) => b.performance.annualizedReturn - a.performance.annualizedReturn);
    
    // Take top 20% of results for analysis
    const topPerformers = sortedResults.slice(0, Math.ceil(results.length * 0.2));
    
    const plateaus: OptimizationResult[] = [];
    const peaks: OptimizationResult[] = [];

    for (const result of topPerformers) {
      // Find neighboring parameter combinations
      const neighbors = results.filter(r => {
        const zDiff = Math.abs(r.parameters.zScoreThreshold - result.parameters.zScoreThreshold);
        const pDiff = Math.abs(r.parameters.profitPercent - result.parameters.profitPercent);
        const sDiff = Math.abs(r.parameters.stopLossPercent - result.parameters.stopLossPercent);
        
        // Consider as neighbor if within one step in any dimension
        return (zDiff <= 0.5 && pDiff <= 1.0 && sDiff <= 0.5) && r !== result;
      });

      // Calculate average performance of neighbors
      const avgNeighborReturn = neighbors.length > 0 
        ? neighbors.reduce((sum, n) => sum + n.performance.annualizedReturn, 0) / neighbors.length
        : result.performance.annualizedReturn;

      // If neighbors perform similarly (within 2% difference), it's a plateau
      const returnDifference = Math.abs(result.performance.annualizedReturn - avgNeighborReturn);
      
      if (returnDifference <= 2.0 && neighbors.length >= 2) {
        plateaus.push(result);
      } else {
        peaks.push(result);
      }
    }

    const analysis = `
Plateau Analysis Results:
- Identified ${plateaus.length} robust parameter combinations (plateaus)
- Found ${peaks.length} potentially overfit parameters (isolated peaks)
- Plateaus indicate stable performance across similar parameter ranges
- Peaks may be overfit to historical data and less reliable for future performance
    `.trim();

    return { plateaus, peaks, analysis };
  }

  /**
   * Generate comprehensive 3D analysis report
   */
  async generate3DAnalysisReport(
    config: OptimizationConfig, 
    results: OptimizationResult[], 
    includeWindowCharts: boolean = false
  ): Promise<string> {
    if (results.length === 0) {
      return '<html><body><h1>No optimization results to analyze</h1></body></html>';
    }

    const { plateaus, peaks, analysis } = this.identifyPlateaus(results);
    
    // Sort results by different metrics for recommendations
    const byReturn = [...results].sort((a, b) => b.performance.annualizedReturn - a.performance.annualizedReturn);
    const bySharpe = [...results].sort((a, b) => b.performance.sharpeRatio - a.performance.sharpeRatio);
    const byConsistency = [...results].sort((a, b) => b.consistency - a.consistency);
    const byAlpha = [...results].sort((a, b) => b.performance.alpha - a.performance.alpha);

    // Best performers for each metric
    const topByReturn = byReturn.slice(0, 5);
    const topBySharpe = bySharpe.slice(0, 5);
    const topByConsistency = byConsistency.slice(0, 5);
    const topPlateaus = plateaus.slice(0, 5);

    // Calculate overall statistics
    const avgReturn = results.reduce((sum, r) => sum + r.performance.annualizedReturn, 0) / results.length;
    const avgSharpe = results.reduce((sum, r) => sum + r.performance.sharpeRatio, 0) / results.length;
    const avgAlpha = results.reduce((sum, r) => sum + r.performance.alpha, 0) / results.length;
    const maxReturn = Math.max(...results.map(r => r.performance.annualizedReturn));
    const minReturn = Math.min(...results.map(r => r.performance.annualizedReturn));

    // Prepare 3D data for Chart.js
    const chartData = results.map(r => ({
      x: r.parameters.profitPercent,
      y: r.parameters.stopLossPercent,
      z: r.parameters.zScoreThreshold,
      value: r.performance.annualizedReturn
    }));

    // Generate windowed backtest charts if requested
    let windowChartsData: any[] = [];
    if (includeWindowCharts && results.length > 0) {
      console.log('📊 Generating individual windowed backtest charts...');
      // Use the best performing parameter set for detailed charts
      const bestResult = results.sort((a, b) => b.performance.annualizedReturn - a.performance.annualizedReturn)[0];
      windowChartsData = await this.generateWindowedBacktestCharts(config, bestResult.parameters);
      console.log(`✅ Generated charts for ${windowChartsData.length} time windows`);
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>3D Parameter Optimization - ${config.baseAsset}/${config.quoteAsset}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@2.0.1/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
    <style>
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            margin: 0; 
            padding: 20px; 
            background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
            min-height: 100vh;
        }
        .container { 
            max-width: 1600px; 
            margin: 0 auto; 
            background: white; 
            padding: 40px; 
            border-radius: 15px; 
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }
        h1 { 
            color: #2c3e50; 
            text-align: center; 
            margin-bottom: 40px; 
            font-size: 2.5em;
            background: linear-gradient(45deg, #3498db, #9b59b6);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        h2 { 
            color: #34495e; 
            border-bottom: 3px solid #3498db; 
            padding-bottom: 10px; 
            margin-top: 40px; 
        }
        .config-panel { 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
            color: white;
            padding: 25px; 
            border-radius: 12px; 
            margin: 25px 0; 
        }
        .config-panel h3 { color: white; margin-top: 0; }
        .summary { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); 
            gap: 25px; 
            margin: 40px 0; 
        }
        .metric { 
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); 
            padding: 25px; 
            border-radius: 12px; 
            text-align: center; 
            border-left: 5px solid #3498db;
            transition: transform 0.3s ease;
        }
        .metric:hover { transform: translateY(-5px); }
        .metric-value { 
            font-size: 32px; 
            font-weight: bold; 
            color: #2c3e50; 
            margin-bottom: 8px;
        }
        .metric-label { 
            color: #7f8c8d; 
            font-size: 14px; 
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .positive { color: #27ae60; }
        .negative { color: #e74c3c; }
        .chart-container { 
            height: 500px; 
            margin: 40px 0; 
            background: #f8f9fa; 
            border-radius: 12px; 
            padding: 20px;
        }
        .results-table { 
            width: 100%; 
            border-collapse: collapse; 
            margin: 30px 0; 
            font-size: 13px; 
            background: white;
        }
        .results-table th, .results-table td { 
            padding: 12px 8px; 
            text-align: center; 
            border-bottom: 1px solid #dee2e6; 
        }
        .results-table th { 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
            color: white;
            font-weight: 600; 
            position: sticky; 
            top: 0; 
        }
        .results-table tr:hover { background: #f8f9fa; }
        .plateau-indicator { 
            background: #d4edda; 
            color: #155724; 
            padding: 4px 8px; 
            border-radius: 4px; 
            font-weight: bold;
            font-size: 11px;
        }
        .peak-indicator { 
            background: #f8d7da; 
            color: #721c24; 
            padding: 4px 8px; 
            border-radius: 4px; 
            font-weight: bold;
            font-size: 11px;
        }
        .analysis-section {
            background: #e8f4fd;
            border-left: 5px solid #3498db;
            padding: 20px;
            margin: 30px 0;
            border-radius: 8px;
        }
        .controls {
            margin: 20px 0;
            text-align: center;
        }
        .controls label {
            margin: 0 10px;
            font-weight: bold;
        }
        .controls input {
            margin: 0 5px;
            padding: 5px;
            border: 1px solid #ddd;
            border-radius: 4px;
        }
        .tab-container {
            margin: 30px 0;
        }
        .tab-buttons {
            display: flex;
            background: #f1f3f5;
            border-radius: 8px 8px 0 0;
            overflow: hidden;
        }
        .tab-button {
            flex: 1;
            padding: 15px;
            border: none;
            background: transparent;
            cursor: pointer;
            font-weight: 600;
            transition: background 0.3s ease;
        }
        .tab-button.active {
            background: #3498db;
            color: white;
        }
        .tab-content {
            display: none;
            padding: 20px;
            border: 1px solid #dee2e6;
            border-top: none;
            border-radius: 0 0 8px 8px;
        }
        .tab-content.active {
            display: block;
        }
        .recommendation-card {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            border-radius: 12px;
            margin: 15px 0;
        }
        .recommendation-card h4 {
            margin-top: 0;
            color: white;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>3D Parameter Optimization Report</h1>
        
        <div class="config-panel">
            <h3>Optimization Configuration</h3>
            <p><strong>Asset Pair:</strong> ${config.baseAsset}/${config.quoteAsset}</p>
            <p><strong>Moving Average Period:</strong> ${this.MOVING_AVERAGES} hours (fixed)</p>
            <p><strong>Window Size:</strong> ${config.windowSize} months</p>
            <p><strong>Parameter Ranges:</strong></p>
            <ul>
                <li>Z-Score Thresholds: [${this.Z_SCORE_THRESHOLDS.join(', ')}] (${this.Z_SCORE_THRESHOLDS.length} values)</li>
                <li>Profit Percents: [${this.PROFIT_PERCENTS.join(', ')}]% (${this.PROFIT_PERCENTS.length} values)</li>
                <li>Stop Loss Percents: [${this.STOP_LOSS_PERCENTS.join(', ')}]% (${this.STOP_LOSS_PERCENTS.length} values)</li>
            </ul>
            <p><strong>Total Combinations Tested:</strong> ${results.length} / ${this.Z_SCORE_THRESHOLDS.length * this.PROFIT_PERCENTS.length * this.STOP_LOSS_PERCENTS.length}</p>
        </div>

        <div class="summary">
            <div class="metric">
                <div class="metric-value ${avgReturn >= 0 ? 'positive' : 'negative'}">${avgReturn.toFixed(2)}%</div>
                <div class="metric-label">Average Return</div>
            </div>
            <div class="metric">
                <div class="metric-value positive">${maxReturn.toFixed(2)}%</div>
                <div class="metric-label">Best Return</div>
            </div>
            <div class="metric">
                <div class="metric-value negative">${minReturn.toFixed(2)}%</div>
                <div class="metric-label">Worst Return</div>
            </div>
            <div class="metric">
                <div class="metric-value">${avgSharpe.toFixed(2)}</div>
                <div class="metric-label">Average Sharpe</div>
            </div>
            <div class="metric">
                <div class="metric-value ${avgAlpha >= 0 ? 'positive' : 'negative'}">${avgAlpha.toFixed(2)}%</div>
                <div class="metric-label">Average Alpha</div>
            </div>
            <div class="metric">
                <div class="metric-value positive">${plateaus.length}</div>
                <div class="metric-label">Stable Plateaus</div>
            </div>
            <div class="metric">
                <div class="metric-value negative">${peaks.length}</div>
                <div class="metric-label">Isolated Peaks</div>
            </div>
            <div class="metric">
                <div class="metric-value">${results.length}</div>
                <div class="metric-label">Total Results</div>
            </div>
        </div>

        <div class="analysis-section">
            <h3>🔍 Plateau vs Peak Analysis</h3>
            <p>${analysis}</p>
            <div style="margin-top: 15px;">
                <strong>Recommendation:</strong> Focus on plateau parameters for robust performance. 
                These combinations show stable returns across similar parameter ranges, indicating 
                less sensitivity to exact parameter values and better generalization to future data.
            </div>
        </div>

        <div class="tab-container">
            <div class="tab-buttons">
                <button class="tab-button active" onclick="showTab('heatmap')">3D Heatmap Visualization</button>
                <button class="tab-button" onclick="showTab('recommendations')">Strategy Recommendations</button>
                <button class="tab-button" onclick="showTab('results')">Detailed Results</button>
                ${includeWindowCharts ? '<button class="tab-button" onclick="showTab(\'windows\')">Individual Windows</button>' : ''}
            </div>

            <div id="heatmap" class="tab-content active">
                <div class="controls">
                    <label for="zScoreSlider">Z-Score Level: <span id="zScoreValue">${this.Z_SCORE_THRESHOLDS[2]}</span></label>
                    <input type="range" id="zScoreSlider" min="0" max="${this.Z_SCORE_THRESHOLDS.length - 1}" value="2" 
                           onchange="updateHeatmap(this.value)">
                    <label for="metricSelect">Metric:</label>
                    <select id="metricSelect" onchange="updateHeatmapMetric(this.value)">
                        <option value="annualizedReturn">Annualized Return</option>
                        <option value="sharpeRatio">Sharpe Ratio</option>
                        <option value="alpha">Alpha</option>
                        <option value="consistency">Consistency</option>
                        <option value="maxDrawdown">Max Drawdown</option>
                    </select>
                </div>
                <div class="chart-container">
                    <canvas id="heatmapChart"></canvas>
                </div>
                <p style="text-align: center; color: #666; font-style: italic;">
                    Use the controls above to explore different Z-score levels and performance metrics. 
                    Green areas represent better performance, red areas represent worse performance.
                </p>
            </div>

            <div id="recommendations" class="tab-content">
                <h3>🏆 Top Strategy Recommendations</h3>
                
                <div class="recommendation-card">
                    <h4>🎯 Best Plateau Strategies (Most Robust)</h4>
                    ${topPlateaus.map((r, i) => `
                        <p><strong>#${i + 1}:</strong> Z=${r.parameters.zScoreThreshold}, P=${r.parameters.profitPercent}%, S=${r.parameters.stopLossPercent}% 
                        | Return: ${r.performance.annualizedReturn.toFixed(2)}%, Sharpe: ${r.performance.sharpeRatio.toFixed(2)}, Consistency: ${r.consistency.toFixed(1)}%</p>
                    `).join('')}
                </div>

                <div class="recommendation-card">
                    <h4>📈 Highest Return Strategies</h4>
                    ${topByReturn.map((r, i) => `
                        <p><strong>#${i + 1}:</strong> Z=${r.parameters.zScoreThreshold}, P=${r.parameters.profitPercent}%, S=${r.parameters.stopLossPercent}% 
                        | Return: ${r.performance.annualizedReturn.toFixed(2)}%, Alpha: ${r.performance.alpha.toFixed(2)}%, Trades: ${r.performance.totalTrades}</p>
                    `).join('')}
                </div>

                <div class="recommendation-card">
                    <h4>⚖️ Best Risk-Adjusted (Sharpe Ratio)</h4>
                    ${topBySharpe.map((r, i) => `
                        <p><strong>#${i + 1}:</strong> Z=${r.parameters.zScoreThreshold}, P=${r.parameters.profitPercent}%, S=${r.parameters.stopLossPercent}% 
                        | Sharpe: ${r.performance.sharpeRatio.toFixed(2)}, Return: ${r.performance.annualizedReturn.toFixed(2)}%, Drawdown: ${r.performance.maxDrawdown.toFixed(2)}%</p>
                    `).join('')}
                </div>

                <div class="recommendation-card">
                    <h4>🎯 Most Consistent Strategies</h4>
                    ${topByConsistency.map((r, i) => `
                        <p><strong>#${i + 1}:</strong> Z=${r.parameters.zScoreThreshold}, P=${r.parameters.profitPercent}%, S=${r.parameters.stopLossPercent}% 
                        | Consistency: ${r.consistency.toFixed(1)}%, Return: ${r.performance.annualizedReturn.toFixed(2)}%, Win Ratio: ${r.performance.winRatio.toFixed(1)}%</p>
                    `).join('')}
                </div>
            </div>

            <div id="results" class="tab-content">
                <h3>📊 Complete Results Table</h3>
                <div style="max-height: 600px; overflow-y: auto;">
                    <table class="results-table">
                        <thead>
                            <tr>
                                <th>Z-Score</th>
                                <th>Profit %</th>
                                <th>Stop Loss %</th>
                                <th>Ann. Return %</th>
                                <th>Alpha %</th>
                                <th>Sharpe</th>
                                <th>Sortino</th>
                                <th>Max DD %</th>
                                <th>Win Ratio %</th>
                                <th>Trades</th>
                                <th>Consistency %</th>
                                <th>Type</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${byReturn.map(result => {
                                const isPlateau = plateaus.includes(result);
                                const typeIndicator = isPlateau 
                                    ? '<span class="plateau-indicator">PLATEAU</span>' 
                                    : peaks.includes(result) 
                                    ? '<span class="peak-indicator">PEAK</span>' 
                                    : '';
                                return `
                                    <tr>
                                        <td>${result.parameters.zScoreThreshold}</td>
                                        <td>${result.parameters.profitPercent}</td>
                                        <td>${result.parameters.stopLossPercent}</td>
                                        <td class="${result.performance.annualizedReturn >= 0 ? 'positive' : 'negative'}">
                                            ${result.performance.annualizedReturn.toFixed(2)}
                                        </td>
                                        <td class="${result.performance.alpha >= 0 ? 'positive' : 'negative'}">
                                            ${result.performance.alpha.toFixed(2)}
                                        </td>
                                        <td>${result.performance.sharpeRatio.toFixed(2)}</td>
                                        <td>${result.performance.sortinoRatio.toFixed(2)}</td>
                                        <td class="negative">${result.performance.maxDrawdown.toFixed(2)}</td>
                                        <td>${result.performance.winRatio.toFixed(1)}</td>
                                        <td>${result.performance.totalTrades}</td>
                                        <td>${result.consistency.toFixed(1)}</td>
                                        <td>${typeIndicator}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            ${includeWindowCharts ? `
            <div id="windows" class="tab-content">
                <h3>📈 Individual Windowed Backtest Charts</h3>
                <p style="color: #666; margin-bottom: 30px;">
                    Charts below show the performance of the best parameter combination (Z=${windowChartsData.length > 0 ? windowChartsData[0].trades.length > 0 ? 'Best params' : 'No trades' : 'No data'}) 
                    across different time windows. Each chart shows market prices, strategy equity curve, and individual trades.
                </p>
                
                ${windowChartsData.map((window, index) => `
                    <div style="margin-bottom: 50px; padding: 20px; border: 1px solid #dee2e6; border-radius: 8px; background: #f8f9fa;">
                        <h4>Window ${index + 1}: ${window.windowStart.toLocaleDateString()} - ${window.windowEnd.toLocaleDateString()}</h4>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 15px; margin-bottom: 20px;">
                            <div style="text-align: center;">
                                <div style="font-size: 20px; font-weight: bold; color: ${window.metrics.totalReturn >= 0 ? '#27ae60' : '#e74c3c'};">
                                    ${window.metrics.totalReturn.toFixed(2)}%
                                </div>
                                <div style="font-size: 12px; color: #666;">Return</div>
                            </div>
                            <div style="text-align: center;">
                                <div style="font-size: 20px; font-weight: bold;">${window.metrics.sharpeRatio.toFixed(2)}</div>
                                <div style="font-size: 12px; color: #666;">Sharpe</div>
                            </div>
                            <div style="text-align: center;">
                                <div style="font-size: 20px; font-weight: bold; color: #e74c3c;">${window.metrics.maxDrawdown.toFixed(2)}%</div>
                                <div style="font-size: 12px; color: #666;">Max DD</div>
                            </div>
                            <div style="text-align: center;">
                                <div style="font-size: 20px; font-weight: bold;">${window.metrics.totalTrades}</div>
                                <div style="font-size: 12px; color: #666;">Trades</div>
                            </div>
                        </div>
                        <div style="height: 400px; margin-bottom: 10px;">
                            <canvas id="windowChart${index}"></canvas>
                        </div>
                    </div>
                `).join('')}
            </div>` : ''}
        </div>
    </div>

    <script>
        // Global variables
        let currentData = ${JSON.stringify(chartData)};
        let currentChart = null;
        let zScoreThresholds = ${JSON.stringify(this.Z_SCORE_THRESHOLDS)};
        let profitPercents = ${JSON.stringify(this.PROFIT_PERCENTS)};
        let stopLossPercents = ${JSON.stringify(this.STOP_LOSS_PERCENTS)};
        let allResults = ${JSON.stringify(results)};
        let windowChartsData = ${JSON.stringify(windowChartsData)};

        function showTab(tabName) {
            // Hide all tab contents
            const contents = document.querySelectorAll('.tab-content');
            contents.forEach(content => content.classList.remove('active'));
            
            // Remove active class from all buttons
            const buttons = document.querySelectorAll('.tab-button');
            buttons.forEach(button => button.classList.remove('active'));
            
            // Show selected tab content
            document.getElementById(tabName).classList.add('active');
            
            // Add active class to clicked button
            event.target.classList.add('active');
            
            // Initialize heatmap if switching to heatmap tab
            if (tabName === 'heatmap' && !currentChart) {
                initializeHeatmap();
            }
            
            // Initialize window charts if switching to windows tab
            if (tabName === 'windows') {
                initializeWindowCharts();
            }
        }

        function initializeHeatmap() {
            const ctx = document.getElementById('heatmapChart').getContext('2d');
            updateHeatmap(2); // Start with middle Z-score value
        }

        function updateHeatmap(zIndex) {
            const zScore = zScoreThresholds[zIndex];
            document.getElementById('zScoreValue').textContent = zScore;
            
            const metric = document.getElementById('metricSelect').value;
            updateHeatmapForZScore(zScore, metric);
        }

        function updateHeatmapMetric(metric) {
            const zIndex = document.getElementById('zScoreSlider').value;
            const zScore = zScoreThresholds[zIndex];
            updateHeatmapForZScore(zScore, metric);
        }

        function updateHeatmapForZScore(zScore, metric) {
            // Filter results for the specific Z-score
            const filteredResults = allResults.filter(r => r.parameters.zScoreThreshold === zScore);
            
            // Create 2D grid data
            const gridData = [];
            const labels = [];
            
            for (let y = 0; y < stopLossPercents.length; y++) {
                const row = [];
                for (let x = 0; x < profitPercents.length; x++) {
                    const result = filteredResults.find(r => 
                        r.parameters.profitPercent === profitPercents[x] && 
                        r.parameters.stopLossPercent === stopLossPercents[y]
                    );
                    
                    let value = 0;
                    if (result) {
                        switch(metric) {
                            case 'annualizedReturn':
                                value = result.performance.annualizedReturn;
                                break;
                            case 'sharpeRatio':
                                value = result.performance.sharpeRatio;
                                break;
                            case 'alpha':
                                value = result.performance.alpha;
                                break;
                            case 'consistency':
                                value = result.consistency;
                                break;
                            case 'maxDrawdown':
                                value = -result.performance.maxDrawdown; // Negative so higher is better
                                break;
                        }
                    }
                    row.push(value);
                }
                gridData.push(row);
                labels.push(stopLossPercents[y] + '%');
            }

            // Destroy existing chart if it exists
            if (currentChart) {
                currentChart.destroy();
            }

            const ctx = document.getElementById('heatmapChart').getContext('2d');
            
            // Flatten data for Chart.js scatter plot styled as heatmap
            const scatterData = [];
            const maxValue = Math.max(...gridData.flat().filter(v => v !== null && isFinite(v)));
            const minValue = Math.min(...gridData.flat().filter(v => v !== null && isFinite(v)));
            
            for (let y = 0; y < stopLossPercents.length; y++) {
                for (let x = 0; x < profitPercents.length; x++) {
                    const value = gridData[y][x];
                    if (value !== null && isFinite(value)) {
                        // Normalize value to 0-1 range for color intensity
                        const normalized = (value - minValue) / (maxValue - minValue);
                        const color = getHeatmapColor(normalized);
                        
                        scatterData.push({
                            x: profitPercents[x],
                            y: stopLossPercents[y],
                            value: value,
                            backgroundColor: color,
                            borderColor: color,
                            pointRadius: 15
                        });
                    }
                }
            }

            currentChart = new Chart(ctx, {
                type: 'scatter',
                data: {
                    datasets: [{
                        label: metric.charAt(0).toUpperCase() + metric.slice(1).replace(/([A-Z])/g, ' $1'),
                        data: scatterData,
                        backgroundColor: scatterData.map(d => d.backgroundColor),
                        borderColor: scatterData.map(d => d.borderColor),
                        pointRadius: scatterData.map(() => 15)
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: {
                            title: {
                                display: true,
                                text: 'Profit Percent (%)',
                                font: { size: 14, weight: 'bold' }
                            },
                            min: Math.min(...profitPercents) - 0.5,
                            max: Math.max(...profitPercents) + 0.5,
                            ticks: { stepSize: 1 }
                        },
                        y: {
                            title: {
                                display: true,
                                text: 'Stop Loss Percent (%)',
                                font: { size: 14, weight: 'bold' }
                            },
                            min: Math.min(...stopLossPercents) - 0.25,
                            max: Math.max(...stopLossPercents) + 0.25,
                            ticks: { stepSize: 0.5 }
                        }
                    },
                    plugins: {
                        title: {
                            display: true,
                            text: \`\${metric.charAt(0).toUpperCase() + metric.slice(1).replace(/([A-Z])/g, ' $1')} Heatmap (Z-Score: \${zScore})\`,
                            font: { size: 16, weight: 'bold' }
                        },
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const point = context.parsed;
                                    return [
                                        \`Profit: \${point.x}%\`,
                                        \`Stop Loss: \${point.y}%\`,
                                        \`Z-Score: \${zScore}\`,
                                        \`\${context.dataset.label}: \${context.raw.value.toFixed(2)}\${metric.includes('Percent') || metric === 'annualizedReturn' || metric === 'alpha' || metric === 'consistency' ? '%' : ''}\`
                                    ];
                                }
                            }
                        }
                    }
                }
            });
        }

        function getHeatmapColor(normalized) {
            // Create a color gradient from red (low) to green (high)
            const red = Math.round(255 * (1 - normalized));
            const green = Math.round(255 * normalized);
            return \`rgba(\${red}, \${green}, 0, 0.8)\`;
        }

        function initializeWindowCharts() {
            if (!windowChartsData || windowChartsData.length === 0) {
                return;
            }

            windowChartsData.forEach((windowData, index) => {
                const canvas = document.getElementById(\`windowChart\${index}\`);
                if (!canvas) return;
                
                const ctx = canvas.getContext('2d');
                
                // Prepare market price data
                const marketData = windowData.marketPrices.map(p => ({
                    x: new Date(p.timestamp),
                    y: p.price
                }));
                
                // Prepare equity curve data  
                const equityData = windowData.equityCurve.map(e => ({
                    x: new Date(e.timestamp),
                    y: e.value
                }));
                
                // Prepare trade markers (each represents a complete trade)
                const profitTrades = windowData.trades.filter(t => t.profitLoss > 0).map(t => ({
                    x: new Date(t.timestamp),
                    y: t.price,
                    profitLoss: t.profitLoss
                }));
                
                const lossTrades = windowData.trades.filter(t => t.profitLoss <= 0).map(t => ({
                    x: new Date(t.timestamp),
                    y: t.price,
                    profitLoss: t.profitLoss
                }));

                new Chart(ctx, {
                    type: 'line',
                    data: {
                        datasets: [
                            {
                                label: 'Market Price',
                                data: marketData,
                                borderColor: '#3498db',
                                backgroundColor: 'rgba(52, 152, 219, 0.1)',
                                fill: false,
                                tension: 0.1,
                                yAxisID: 'priceAxis'
                            },
                            {
                                label: 'Strategy Equity',
                                data: equityData,
                                borderColor: '#2ecc71',
                                backgroundColor: 'rgba(46, 204, 113, 0.1)', 
                                fill: false,
                                tension: 0.1,
                                yAxisID: 'equityAxis'
                            },
                            {
                                label: 'Profitable Trades',
                                data: profitTrades,
                                borderColor: '#27ae60',
                                backgroundColor: '#27ae60',
                                pointRadius: 8,
                                pointHoverRadius: 10,
                                showLine: false,
                                yAxisID: 'priceAxis'
                            },
                            {
                                label: 'Loss Trades',
                                data: lossTrades,
                                borderColor: '#e74c3c',
                                backgroundColor: '#e74c3c',
                                pointRadius: 8,
                                pointHoverRadius: 10,
                                showLine: false,
                                yAxisID: 'priceAxis'
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            x: {
                                type: 'time',
                                time: {
                                    unit: 'day'
                                },
                                title: {
                                    display: true,
                                    text: 'Date'
                                }
                            },
                            priceAxis: {
                                type: 'linear',
                                display: true,
                                position: 'left',
                                title: {
                                    display: true,
                                    text: 'Price (USDT)'
                                }
                            },
                            equityAxis: {
                                type: 'linear',
                                display: true,
                                position: 'right',
                                title: {
                                    display: true,
                                    text: 'Equity Value'
                                },
                                grid: {
                                    drawOnChartArea: false
                                }
                            }
                        },
                        plugins: {
                            title: {
                                display: true,
                                text: \`Window \${index + 1}: \${new Date(windowData.windowStart).toLocaleDateString()} - \${new Date(windowData.windowEnd).toLocaleDateString()}\`
                            },
                            legend: {
                                display: true
                            },
                            tooltip: {
                                mode: 'nearest',
                                intersect: false,
                                callbacks: {
                                    label: function(context) {
                                        const label = context.dataset.label || '';
                                        if (label.includes('Price')) {
                                            return \`\${label}: $\${context.parsed.y.toFixed(2)}\`;
                                        } else if (label.includes('Equity')) {
                                            return \`\${label}: $\${context.parsed.y.toFixed(2)}\`;
                                        } else if (label.includes('Trades')) {
                                            const profitLoss = context.raw.profitLoss || 0;
                                            return [
                                                \`\${label}: $\${context.parsed.y.toFixed(2)}\`,
                                                \`P&L: $\${profitLoss.toFixed(2)}\`
                                            ];
                                        }
                                        return \`\${label}: \${context.parsed.y}\`;
                                    }
                                }
                            }
                        }
                    }
                });
            });
        }

        // Initialize heatmap when page loads
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(() => {
                if (document.getElementById('heatmapChart')) {
                    initializeHeatmap();
                }
            }, 100);
        });
    </script>
</body>
</html>`;

    return html;
  }

  /**
   * Generate failure analysis report
   */
  generateFailureReport(): string {
    if (this.progress.failureLog.length === 0) {
      return 'No failures occurred during optimization.';
    }

    const failureReasons = new Map<string, number>();
    const failuresByZScore = new Map<number, number>();
    const failuresByProfit = new Map<number, number>();
    const failuresByStop = new Map<number, number>();

    for (const failure of this.progress.failureLog) {
      // Count by reason
      failureReasons.set(failure.reason, (failureReasons.get(failure.reason) || 0) + 1);
      
      // Count by parameter ranges
      failuresByZScore.set(failure.parameters.zScoreThreshold, (failuresByZScore.get(failure.parameters.zScoreThreshold) || 0) + 1);
      failuresByProfit.set(failure.parameters.profitPercent, (failuresByProfit.get(failure.parameters.profitPercent) || 0) + 1);
      failuresByStop.set(failure.parameters.stopLossPercent, (failuresByStop.get(failure.parameters.stopLossPercent) || 0) + 1);
    }

    let report = `\n📋 FAILURE ANALYSIS REPORT\n`;
    report += `=`.repeat(50) + '\n';
    report += `Total Failures: ${this.progress.failureLog.length}\n`;
    report += `Success Rate: ${((this.progress.successful / this.progress.totalCombinations) * 100).toFixed(1)}%\n\n`;

    report += `🔍 Failure Reasons:\n`;
    Array.from(failureReasons.entries()).forEach(([reason, count]) => {
      const percentage = (count / this.progress.failureLog.length * 100).toFixed(1);
      report += `   • ${reason}: ${count} (${percentage}%)\n`;
    });

    report += `\n📊 Failures by Parameter:\n`;
    report += `   Z-Score Thresholds: ${Array.from(failuresByZScore.entries()).map(([z, c]) => `${z}:${c}`).join(', ')}\n`;
    report += `   Profit Percents: ${Array.from(failuresByProfit.entries()).map(([p, c]) => `${p}%:${c}`).join(', ')}\n`;
    report += `   Stop Loss Percents: ${Array.from(failuresByStop.entries()).map(([s, c]) => `${s}%:${c}`).join(', ')}\n`;

    report += `\n💡 Recommendations:\n`;
    
    // Find most problematic parameters
    const maxZScoreFailures = Math.max(...Array.from(failuresByZScore.values()));
    const maxProfitFailures = Math.max(...Array.from(failuresByProfit.values()));
    const maxStopFailures = Math.max(...Array.from(failuresByStop.values()));
    
    const problematicZScores = Array.from(failuresByZScore.entries()).filter(([_, count]) => count === maxZScoreFailures).map(([z, _]) => z);
    const problematicProfits = Array.from(failuresByProfit.entries()).filter(([_, count]) => count === maxProfitFailures).map(([p, _]) => p);
    const problematicStops = Array.from(failuresByStop.entries()).filter(([_, count]) => count === maxStopFailures).map(([s, _]) => s);

    if (problematicZScores.length > 0) {
      report += `   • Consider avoiding Z-score thresholds: ${problematicZScores.join(', ')}\n`;
    }
    if (problematicProfits.length > 0) {
      report += `   • Consider avoiding profit targets: ${problematicProfits.join(', ')}%\n`;
    }
    if (problematicStops.length > 0) {
      report += `   • Consider avoiding stop losses: ${problematicStops.join(', ')}%\n`;
    }

    // Check for data-related issues
    const dataIssues = this.progress.failureLog.filter(f => f.reason.includes('database') || f.reason.includes('parse')).length;
    if (dataIssues > this.progress.failureLog.length * 0.5) {
      report += `   • Data issues detected in ${dataIssues} failures - check Glicko ratings and klines data\n`;
    }

    return report;
  }

  /**
   * Generate individual windowed backtest charts for specific parameters
   */
  async generateWindowedBacktestCharts(
    config: OptimizationConfig, 
    params: ParameterCombination
  ): Promise<Array<{
    windowStart: Date;
    windowEnd: Date;
    equityCurve: Array<{ timestamp: Date; value: number }>;
    marketPrices: Array<{ timestamp: Date; price: number }>;
    trades: Array<{ 
      timestamp: Date; 
      type: 'BUY' | 'SELL'; 
      price: number; 
      quantity: number;
      signal?: string;
    }>;
    metrics: any;
  }>> {
    try {
      // Query database for all windowed backtest results for this parameter combination
      const windowResults = await this.prisma.optimizationResults.findMany({
        where: {
          baseAsset: config.baseAsset,
          quoteAsset: config.quoteAsset,
          zScoreThreshold: params.zScoreThreshold,
          profitPercent: params.profitPercent,
          stopLossPercent: params.stopLossPercent
        },
        orderBy: { startTime: 'asc' },
        take: 20 // Limit to latest 20 windows for performance
      });

      // Get trades and price data for each window
      const windowCharts = [];
      for (const result of windowResults) {
        // Get trades for this specific window
        const trades = await this.prisma.backtestOrders.findMany({
          where: {
            symbol: `${config.baseAsset}${config.quoteAsset}`,
            timestamp: {
              gte: result.startTime,
              lte: result.endTime
            }
          },
          orderBy: { timestamp: 'asc' }
        });

        // Get price data for this window
        const priceData = await this.prisma.klines.findMany({
          where: {
            symbol: `${config.baseAsset}${config.quoteAsset}`,
            openTime: {
              gte: result.startTime,
              lte: result.endTime
            }
          },
          orderBy: { openTime: 'asc' },
          select: {
            openTime: true,
            close: true
          }
        });

        // Calculate equity curve from trades
        const INITIAL_CAPITAL = 10000; // Starting capital
        let runningEquity = INITIAL_CAPITAL;
        const equityCurve: Array<{ timestamp: Date; value: number }> = [];
        
        // Initialize equity curve with starting value
        equityCurve.push({
          timestamp: result.startTime,
          value: INITIAL_CAPITAL
        });

        // Build equity curve from completed trades (each BacktestOrders record is a complete trade)
        const validTrades = trades
          .filter(trade => trade.profitLoss !== null)
          .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        for (const trade of validTrades) {
          // Add realized P&L (positive for profit, negative for loss)
          runningEquity += parseFloat(trade.profitLoss!.toString());
          
          equityCurve.push({
            timestamp: trade.timestamp,
            value: runningEquity
          });
        }

        // Add final point at end time if needed
        if (equityCurve.length > 1 && equityCurve[equityCurve.length - 1].timestamp < result.endTime) {
          equityCurve.push({
            timestamp: result.endTime,
            value: runningEquity
          });
        }

        windowCharts.push({
          windowStart: result.startTime,
          windowEnd: result.endTime,
          equityCurve,
          marketPrices: priceData.map(p => ({
            timestamp: p.openTime,
            price: parseFloat(p.close.toString())
          })),
          trades: validTrades.map((t: any) => ({
            timestamp: t.timestamp,
            type: 'TRADE' as 'BUY' | 'SELL', // Each record represents a complete trade
            price: parseFloat(t.price.toString()),
            quantity: parseFloat(t.quantity.toString()),
            signal: t.reason || undefined,
            profitLoss: t.profitLoss ? parseFloat(t.profitLoss.toString()) : 0
          })),
          metrics: {
            totalReturn: parseFloat(result.annualizedReturn.toString()),
            sharpeRatio: parseFloat(result.sharpeRatio.toString()),
            maxDrawdown: parseFloat(result.maxDrawdown.toString()),
            totalTrades: trades.length
          }
        });
      }

      return windowCharts;
    } catch (error) {
      console.error('❌ Error generating windowed backtest charts:', error);
      return [];
    }
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

interface ParsedArguments {
  config: OptimizationConfig;
  parameterRanges: {
    zScoreThresholds?: number[];
    profitPercents?: number[];
    stopLossPercents?: number[];
    movingAverages?: number;
  };
  generateCharts?: boolean;
}

/**
 * Parse command line arguments
 */
function parseArguments(): ParsedArguments {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('❌ Invalid arguments. Usage:');
    console.error('npm run runAllWindowedBacktestsForPair baseAsset quoteAsset [windowSize] [startDate] [--zscores=1.5,2.0,3.0] [--profits=3.0,5.0,7.0] [--stops=1.5,2.5,3.5] [--ma=10] [--charts]');
    console.error('');
    console.error('Examples:');
    console.error('  # Use defaults from .env file:');
    console.error('  npm run runAllWindowedBacktestsForPair ETH USDT');
    console.error('  npm run runAllWindowedBacktestsForPair ETH USDT 12 "2021-08-01"');
    console.error('');
    console.error('  # Custom parameter ranges:');
    console.error('  npm run runAllWindowedBacktestsForPair ETH USDT --zscores=2.0,2.5,3.0 --profits=4.0,5.0,6.0 --stops=2.0,2.5,3.0');
    console.error('  npm run runAllWindowedBacktestsForPair BTC USDT 6 --mas=20 --zscores=1.5,2.0,2.5');
    console.error('');
    console.error('  # Generate individual windowed backtest charts:');
    console.error('  npm run runAllWindowedBacktestsForPair ETH USDT --charts');
    console.error('  npm run runAllWindowedBacktestsForPair BTC USDT --zscores=2.0,3.0 --charts');
    console.error('');
    console.error('Arguments:');
    console.error('  baseAsset: Base asset (e.g., ETH, BTC)');
    console.error('  quoteAsset: Quote asset (e.g., USDT)');
    console.error('  windowSize: Window size in months (default: 12)');
    console.error('  startDate: Start date (YYYY-MM-DD, optional - auto-detected if omitted)');
    console.error('');
    console.error('Parameter Range Options (override .env defaults):');
    console.error('  --zscores=X,Y,Z: Comma-separated Z-score thresholds');
    console.error('  --profits=X,Y,Z: Comma-separated profit percentages');
    console.error('  --stops=X,Y,Z: Comma-separated stop loss percentages');
    console.error('  --ma=N or --mas=N: Moving average period (default: 10)');
    console.error('  --charts: Generate individual windowed backtest charts for best performing parameters');
    console.error('');
    console.error('Current .env defaults:');
    console.error(`  Z-Score Thresholds: ${process.env.ZSCORE_THRESHOLDS || '1.5,2.0,2.5,3.0,3.5,4.0'}`);
    console.error(`  Profit Percents: ${process.env.PROFIT_PERCENTS || '3.0,4.0,5.0,6.0,7.0,8.0'}`);
    console.error(`  Stop Loss Percents: ${process.env.STOP_LOSS_PERCENTS || '1.5,2.0,2.5,3.0,3.5,4.0'}`);
    console.error(`  Moving Average: ${process.env.DEFAULT_MOVING_AVERAGE || '10'}`);
    process.exit(1);
  }

  // Separate regular arguments from parameter flags
  const regularArgs: string[] = [];
  const paramFlags: { [key: string]: string } = {};
  let generateCharts = false;

  for (const arg of args) {
    if (arg.startsWith('--')) {
      if (arg === '--charts') {
        generateCharts = true;
      } else {
        const [key, value] = arg.split('=');
        if (value) {
          paramFlags[key.substring(2)] = value;
        }
      }
    } else {
      regularArgs.push(arg);
    }
  }

  if (regularArgs.length < 2) {
    console.error('❌ Missing required arguments: baseAsset and quoteAsset');
    process.exit(1);
  }

  const [baseAsset, quoteAsset, windowSizeStr, startDate] = regularArgs;

  const windowSize = windowSizeStr ? parseInt(windowSizeStr) : 12;

  if (startDate && isNaN(new Date(startDate).getTime())) {
    console.error('❌ Invalid start date format. Use YYYY-MM-DD format');
    process.exit(1);
  }

  // Parse parameter ranges from flags
  const parameterRanges: ParsedArguments['parameterRanges'] = {};

  if (paramFlags.zscores) {
    parameterRanges.zScoreThresholds = paramFlags.zscores
      .split(',')
      .map(v => parseFloat(v.trim()))
      .filter(v => !isNaN(v));
  }

  if (paramFlags.profits) {
    parameterRanges.profitPercents = paramFlags.profits
      .split(',')
      .map(v => parseFloat(v.trim()))
      .filter(v => !isNaN(v));
  }

  if (paramFlags.stops) {
    parameterRanges.stopLossPercents = paramFlags.stops
      .split(',')
      .map(v => parseFloat(v.trim()))
      .filter(v => !isNaN(v));
  }

  if (paramFlags.ma || paramFlags.mas) {
    const ma = parseInt(paramFlags.ma || paramFlags.mas);
    if (!isNaN(ma)) {
      parameterRanges.movingAverages = ma;
    }
  }

  return {
    config: {
      baseAsset: baseAsset.toUpperCase(),
      quoteAsset: quoteAsset.toUpperCase(),
      movingAverages: parameterRanges.movingAverages || parseInt(process.env.DEFAULT_MOVING_AVERAGE || '10'),
      windowSize,
      startDate
    },
    parameterRanges,
    generateCharts
  };
}

/**
 * Main execution function
 */
async function main() {
  try {
    console.log('🎯 Starting 3D Parameter Optimization Engine...');
    console.log('=' .repeat(80));

    const { config, parameterRanges, generateCharts } = parseArguments();

    // Create optimizer with custom parameters or defaults from .env
    const optimizer = new ParameterOptimizer(
      parameterRanges.zScoreThresholds,
      parameterRanges.profitPercents,
      parameterRanges.stopLossPercents,
      parameterRanges.movingAverages
    );

    await optimizer.initialize();

    // Display parameter configuration
    console.log('📋 Parameter Configuration:');
    const hasCustomParams = parameterRanges.zScoreThresholds || parameterRanges.profitPercents || parameterRanges.stopLossPercents || parameterRanges.movingAverages;
    console.log(`   Source: ${hasCustomParams ? 'Command-line overrides + .env defaults' : '.env file'}`);
    if (hasCustomParams) {
      console.log('   Overrides applied:');
      if (parameterRanges.zScoreThresholds) console.log(`     Z-Scores: [${parameterRanges.zScoreThresholds.join(', ')}]`);
      if (parameterRanges.profitPercents) console.log(`     Profits: [${parameterRanges.profitPercents.join(', ')}]%`);
      if (parameterRanges.stopLossPercents) console.log(`     Stop Loss: [${parameterRanges.stopLossPercents.join(', ')}]%`);
      if (parameterRanges.movingAverages) console.log(`     Moving Average: ${parameterRanges.movingAverages}`);
    }
    
    // Run the optimization
    const results = await optimizer.runOptimization(config);

    if (results.length === 0) {
      console.log('❌ No optimization results obtained');
      return;
    }

    // Generate comprehensive 3D analysis report
    const html = await optimizer.generate3DAnalysisReport(config, results, generateCharts);
    const reportPath = path.join('analysis', `parameter-optimization-3d-${config.baseAsset}${config.quoteAsset}-${Date.now()}.html`);
    
    // Ensure analysis directory exists
    if (!fs.existsSync('analysis')) {
      fs.mkdirSync('analysis');
    }
    
    fs.writeFileSync(reportPath, html);

    // Display summary
    console.log('\\n🎉 3D Parameter Optimization completed!');
    console.log('📊 Final Summary:');
    
    if (results.length > 0) {
      const sortedResults = results.sort((a, b) => b.performance.annualizedReturn - a.performance.annualizedReturn);
      const bestResult = sortedResults[0];
      const avgReturn = results.reduce((sum, r) => sum + r.performance.annualizedReturn, 0) / results.length;
      
      console.log(`  ✅ Successful combinations: ${results.length}`);
      console.log(`  🏆 Best strategy: Z=${bestResult.parameters.zScoreThreshold}, P=${bestResult.parameters.profitPercent}%, S=${bestResult.parameters.stopLossPercent}%`);
      console.log(`  📈 Best annualized return: ${bestResult.performance.annualizedReturn.toFixed(2)}%`);
      console.log(`  📊 Average return: ${avgReturn.toFixed(2)}%`);
      console.log(`  ⚖️ Best Sharpe ratio: ${Math.max(...results.map(r => r.performance.sharpeRatio)).toFixed(2)}`);
      console.log(`  📁 3D analysis report: ${reportPath}`);
    } else {
      console.log(`  ❌ No successful combinations found`);
    }
    
    // Display failure analysis
    console.log(optimizer.generateFailureReport());
    console.log(`📄 Detailed progress log: ${optimizer.logFile}`);

    // Clean up
    await optimizer.cleanup();

  } catch (error) {
    console.error('\\n❌ 3D parameter optimization failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { ParameterOptimizer, OptimizationConfig, OptimizationResult };