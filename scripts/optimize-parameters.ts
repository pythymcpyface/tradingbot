#!/usr/bin/env ts-node

/**
 * Advanced Parameter Optimization Script (EDA Approach)
 * 
 * This script performs a parallelized, iterative optimization of trading parameters
 * using an Estimation of Distribution Algorithm (EDA) approach.
 * 
 * Workflow:
 * 1. Discovery: Identifies target pairs from .env and available data range from DB.
 * 2. Phase 1 (Exploration): "Casts a wide net" by randomly sampling parameters from wide ranges.
 * 3. Evaluation: Runs backtests in parallel child processes (using Walk-Forward Analysis).
 * 4. Analysis: Identifies top performers based on ALPHA (Excess Return).
 * 5. Phase 2 (Refinement): Samples new parameters from a distribution centered on best performers.
 * 6. Result: Saves all runs to database and outputs optimal parameters.
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

config();

// --- Configuration ---
const CONCURRENCY_LIMIT = parseInt(process.env.OPTIMIZE_CONCURRENCY || '5'); 
const INITIAL_SAMPLES = parseInt(process.env.OPTIMIZE_PHASE1_SAMPLES || '20');
const REFINEMENT_SAMPLES = parseInt(process.env.OPTIMIZE_PHASE2_SAMPLES || '10');
const BACKTEST_TIMEOUT = 120000; // 2 minutes hard timeout for walk-forward
const MIN_DATAPOINTS = 100;

// Ranges
const RANGES = {
  zScore: { 
    min: parseFloat(process.env.OPTIMIZE_ZSCORE_MIN || '1.5'), 
    max: parseFloat(process.env.OPTIMIZE_ZSCORE_MAX || '4.5'), 
    step: 0.1 
  },
  ma: { 
    min: parseInt(process.env.OPTIMIZE_MA_MIN || '2'), 
    max: parseInt(process.env.OPTIMIZE_MA_MAX || '20'), 
    step: 2 
  },
  profit: { 
    min: parseFloat(process.env.OPTIMIZE_PROFIT_MIN || '1.0'), 
    max: parseFloat(process.env.OPTIMIZE_PROFIT_MAX || '15.0'), 
    step: 0.5 
  },
  stop: { 
    min: parseFloat(process.env.OPTIMIZE_STOP_MIN || '1.0'), 
    max: parseFloat(process.env.OPTIMIZE_STOP_MAX || '10.0'), 
    step: 0.5 
  }
};

interface ParameterSet {
  zScore: number;
  ma: number;
  profit: number;
  stop: number;
}

interface OptimizationResult {
  params: ParameterSet;
  metrics: {
    totalReturn: number;
    sharpeRatio: number;
    alpha: number;
    trades: number;
  };
  runId: string;
}

interface WorkerState {
  id: number;
  pair: string;
  params: string;
  progress: number;
  startTime: number;
  status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED';
}

// --- Dashboard ---

class Dashboard {
  private workers: WorkerState[] = [];
  private totalTasks: number = 0;
  private completedTasks: number = 0;
  private startTime: number = Date.now();
  private logs: string[] = [];
  private maxLogs = 10;

  constructor(concurrency: number) {
    for (let i = 0; i < concurrency; i++) {
      this.workers.push({
        id: i + 1,
        pair: '-',
        params: '-',
        progress: 0,
        startTime: 0,
        status: 'IDLE'
      });
    }
  }

  setTotalTasks(count: number) {
    this.totalTasks = count;
  }

  updateWorker(id: number, data: Partial<WorkerState>) {
    const worker = this.workers.find(w => w.id === id);
    if (worker) {
      Object.assign(worker, data);
      if (data.status === 'RUNNING' && !data.startTime) {
        worker.startTime = Date.now();
      }
    }
    this.render();
  }

  completeTask() {
    this.completedTasks++;
    this.render();
  }

  log(message: string) {
    this.logs.push(`[${new Date().toLocaleTimeString()}] ${message}`);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    this.render();
  }

  private formatTime(ms: number): string {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  }

  private generateProgressBar(percent: number, width: number = 20): string {
    const filled = Math.round((width * percent) / 100);
    const empty = width - filled;
    return '[' + '='.repeat(filled) + '>'.repeat(filled < width ? 1 : 0) + ' '.repeat(Math.max(0, empty - 1)) + ']';
  }

  render() {
    // Clear screen
    readline.cursorTo(process.stdout, 0, 0);
    readline.clearScreenDown(process.stdout);

    // Global Stats
    const elapsed = Date.now() - this.startTime;
    const globalProgress = this.totalTasks > 0 ? (this.completedTasks / this.totalTasks) * 100 : 0;
    
    // Estimate Total ETA
    let globalEta = 0;
    if (this.completedTasks > 0) {
      const avgTimePerTask = elapsed / this.completedTasks;
      const remainingTasks = this.totalTasks - this.completedTasks;
      globalEta = avgTimePerTask * remainingTasks;
    }

    console.log(`🚀 OPTIMIZATION DASHBOARD (Strategy: Maximize Alpha)`);
    console.log(`================================================================================`);
    console.log(`Global Progress: ${globalProgress.toFixed(1)}% ${this.generateProgressBar(globalProgress, 40)}`);
    console.log(`Tasks: ${this.completedTasks}/${this.totalTasks} | Elapsed: ${this.formatTime(elapsed)} | ETA: ${this.formatTime(globalEta)}`);
    console.log(`================================================================================`);
    console.log(`ACTIVE WORKERS`);
    console.log(`--------------------------------------------------------------------------------`);
    
    this.workers.forEach(w => {
      let eta = '--:--:--';
      if (w.status === 'RUNNING' && w.progress > 0) {
        const workerElapsed = Date.now() - w.startTime;
        const estimatedTotal = (workerElapsed / w.progress) * 100;
        const remaining = estimatedTotal - workerElapsed;
        eta = this.formatTime(remaining);
      } else if (w.status === 'IDLE') {
        eta = '--:--:--';
      }

      const statusIcon = w.status === 'RUNNING' ? '🟢' : w.status === 'IDLE' ? '⚪' : w.status === 'COMPLETED' ? '✅' : '❌';
      console.log(`${statusIcon} W${w.id} | ${w.pair.padEnd(8)} | ${w.params.padEnd(30)} | ${w.progress.toString().padStart(3)}% ${this.generateProgressBar(w.progress, 10)} | ETA: ${eta}`);
    });
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`RECENT LOGS`);
    this.logs.forEach(l => console.log(l));
  }
}

// --- Utilities ---

function randomRange(min: number, max: number, step: number): number {
  const steps = Math.floor((max - min) / step);
  const randomStep = Math.floor(Math.random() * (steps + 1));
  return parseFloat((min + (randomStep * step)).toFixed(2));
}

function clamp(value: number, min: number, max: number, step: number): number {
  let v = Math.max(min, Math.min(max, value));
  v = Math.round(v / step) * step;
  return parseFloat(v.toFixed(2));
}

function calculateMean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function calculateStdDev(values: number[]): number {
  const mean = calculateMean(values);
  const squareDiffs = values.map(v => Math.pow(v - mean, 2));
  return Math.sqrt(calculateMean(squareDiffs));
}

function sampleNormal(mean: number, stdDev: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return mean + z0 * stdDev;
}

// --- Main Class ---

class ParameterOptimizer {
  private prisma: PrismaClient;
  private dashboard: Dashboard;
  private workerSlots: number[];

  constructor() {
    this.prisma = new PrismaClient();
    this.dashboard = new Dashboard(CONCURRENCY_LIMIT);
    this.workerSlots = Array.from({ length: CONCURRENCY_LIMIT }, (_, i) => i + 1);
  }

  async initialize() {
    await this.prisma.$connect();
    this.dashboard.log('Connected to database');
  }

  private async getWorkerSlot(): Promise<number> {
    while (this.workerSlots.length === 0) {
      await new Promise(r => setTimeout(r, 100));
    }
    return this.workerSlots.shift()!;
  }

  private releaseWorkerSlot(id: number) {
    this.workerSlots.push(id);
    this.dashboard.updateWorker(id, { status: 'IDLE', pair: '-', params: '-', progress: 0 });
  }

  async getGlobalDateRange(baseAsset: string): Promise<{ start: Date, end: Date } | null> {
    const range = await this.prisma.glickoRatings.aggregate({
      where: { symbol: baseAsset },
      _min: { timestamp: true },
      _max: { timestamp: true },
      _count: true
    });

    if (!range._min.timestamp || !range._max.timestamp || range._count < MIN_DATAPOINTS) {
      return null;
    }
    return { start: range._min.timestamp, end: range._max.timestamp };
  }

  private runBacktestProcess(
    workerId: number,
    baseAsset: string,
    quoteAsset: string,
    start: Date,
    params: ParameterSet
  ): Promise<OptimizationResult | null> {
    return new Promise((resolve) => {
      // Use 12-month window for walk-forward analysis
      const windowMonths = 12;

      const paramStr = `Z=${params.zScore} MA=${params.ma} P=${params.profit} S=${params.stop}`;
      this.dashboard.updateWorker(workerId, {
        status: 'RUNNING',
        pair: `${baseAsset}/${quoteAsset}`,
        params: paramStr,
        progress: 0,
        startTime: Date.now()
      });

      // Pass --no-html to suppress charts/logs
      const args = [
        'scripts/runAllWindowedBacktests.ts',
        start.toISOString().split('T')[0],
        windowMonths.toString(),
        baseAsset,
        quoteAsset,
        params.zScore.toString(),
        params.ma.toString(),
        params.profit.toString(),
        params.stop.toString(),
        '--no-html'
      ];

      const child = spawn('npx', ['ts-node', ...args], {
        stdio: 'pipe',
        timeout: BACKTEST_TIMEOUT
      });

      let stdout = '';
      
      child.stdout.on('data', (data) => {
        const str = data.toString();
        stdout += str;
        
        // Count "Running backtest" occurrences for progress estimation
        const matches = str.match(/Running backtest/g);
        if (matches) {
           this.dashboard.updateWorker(workerId, { progress: Math.min(99, matches.length * 10) });
        }
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          try {
            // Parse Walk-Forward Metrics
            
            // 1. Sharpe (Parse all occurrences and average them, or wait for summary support in runAllWindowed)
            // Currently runAllWindowed prints "Sharpe Ratio: X.XX" for each window.
            const sharpeMatches = [...stdout.matchAll(/Sharpe Ratio: (-?\d+\.?\d*)/g)];
            const totalSharpe = sharpeMatches.reduce((sum, match) => sum + parseFloat(match[1]), 0);
            const avgSharpe = sharpeMatches.length > 0 ? totalSharpe / sharpeMatches.length : 0;
            
            // 2. Alpha (Excess Return)
            // Currently runAllWindowed prints "Alpha: X.XX%" for each window.
            const alphaMatches = [...stdout.matchAll(/Alpha: (-?\d+\.?\d*)%/g)];
            const totalAlpha = alphaMatches.reduce((sum, match) => sum + parseFloat(match[1]), 0);
            const avgAlpha = alphaMatches.length > 0 ? totalAlpha / alphaMatches.length : 0;
            
            // 3. Return & Trades (from summary or individual)
            // Using individual sum for trades
            const tradesMatches = [...stdout.matchAll(/Trades: (\d+)/g)];
            const totalTrades = tradesMatches.reduce((sum, match) => sum + parseInt(match[1]), 0);

            // 4. Total Return (Average Return per Window)
            // runAllWindowedBacktests logs "Average Return per Window" at end.
            const avgReturnMatch = stdout.match(/Average Return per Window.*: (-?\d+\.?\d*)%/);
            const avgReturn = avgReturnMatch ? parseFloat(avgReturnMatch[1]) : 0;

            if (sharpeMatches.length > 0) {
              resolve({
                params,
                metrics: {
                  totalReturn: avgReturn,
                  sharpeRatio: avgSharpe,
                  alpha: avgAlpha,
                  trades: totalTrades
                },
                runId: 'walk-forward'
              });
              return;
            }
          } catch (e) { }
        }
        resolve(null);
      });

      child.on('error', () => resolve(null));
      
      setTimeout(() => {
        if (!child.killed) child.kill();
      }, BACKTEST_TIMEOUT);
    });
  }

  async optimizePair(baseAsset: string, quoteAsset: string): Promise<void> {
    const dateRange = await this.getGlobalDateRange(baseAsset);
    if (!dateRange) {
      this.dashboard.log(`No data for ${baseAsset}`);
      return;
    }

    // Phase 1
    const phase1Promises: Promise<OptimizationResult | null>[] = [];
    for (let i = 0; i < INITIAL_SAMPLES; i++) {
      const params: ParameterSet = {
        zScore: randomRange(RANGES.zScore.min, RANGES.zScore.max, RANGES.zScore.step),
        ma: randomRange(RANGES.ma.min, RANGES.ma.max, RANGES.ma.step),
        profit: randomRange(RANGES.profit.min, RANGES.profit.max, RANGES.profit.step),
        stop: randomRange(RANGES.stop.min, RANGES.stop.max, RANGES.stop.step)
      };

      phase1Promises.push((async () => {
        const slot = await this.getWorkerSlot();
        try {
          const res = await this.runBacktestProcess(slot, baseAsset, quoteAsset, dateRange.start, params);
          this.dashboard.completeTask();
          return res;
        } finally {
          this.releaseWorkerSlot(slot);
        }
      })());
    }

    const phase1Results = (await Promise.all(phase1Promises)).filter((r): r is OptimizationResult => r !== null);
    if (phase1Results.length === 0) return;

    // Analyze Phase 1 (Sort by Alpha)
    const sorted = phase1Results.sort((a, b) => b.metrics.alpha - a.metrics.alpha);
    const topPerformers = sorted.slice(0, Math.max(3, Math.floor(phase1Results.length * 0.2)));
    const best = topPerformers[0];
    this.dashboard.log(`Phase 1 Best (${baseAsset}): Alpha=${best.metrics.alpha.toFixed(2)}%`);

    // Phase 2 (Refine around best Alpha performers)
    const zStats = { mean: calculateMean(topPerformers.map(r => r.params.zScore)), std: calculateStdDev(topPerformers.map(r => r.params.zScore)) || 0.5 };
    const maStats = { mean: calculateMean(topPerformers.map(r => r.params.ma)), std: calculateStdDev(topPerformers.map(r => r.params.ma)) || 5 };
    const profitStats = { mean: calculateMean(topPerformers.map(r => r.params.profit)), std: calculateStdDev(topPerformers.map(r => r.params.profit)) || 1.0 };
    const stopStats = { mean: calculateMean(topPerformers.map(r => r.params.stop)), std: calculateStdDev(topPerformers.map(r => r.params.stop)) || 0.5 };

    const phase2Promises: Promise<OptimizationResult | null>[] = [];
    for (let i = 0; i < REFINEMENT_SAMPLES; i++) {
      const params: ParameterSet = {
        zScore: clamp(sampleNormal(zStats.mean, zStats.std), RANGES.zScore.min, RANGES.zScore.max, RANGES.zScore.step),
        ma: clamp(sampleNormal(maStats.mean, maStats.std), RANGES.ma.min, RANGES.ma.max, RANGES.ma.step),
        profit: clamp(sampleNormal(profitStats.mean, profitStats.std), RANGES.profit.min, RANGES.profit.max, RANGES.profit.step),
        stop: clamp(sampleNormal(stopStats.mean, stopStats.std), RANGES.stop.min, RANGES.stop.max, RANGES.stop.step)
      };

      phase2Promises.push((async () => {
        const slot = await this.getWorkerSlot();
        try {
          const res = await this.runBacktestProcess(slot, baseAsset, quoteAsset, dateRange.start, params);
          this.dashboard.completeTask();
          return res;
        } finally {
          this.releaseWorkerSlot(slot);
        }
      })());
    }

    const phase2Results = (await Promise.all(phase2Promises)).filter((r): r is OptimizationResult => r !== null);
    
    // Final Log
    const all = [...phase1Results, ...phase2Results].sort((a, b) => b.metrics.alpha - a.metrics.alpha);
    const finalBest = all[0];
    this.dashboard.log(`Optimized ${baseAsset}: Best Alpha=${finalBest.metrics.alpha.toFixed(2)}% (Z=${finalBest.params.zScore}, MA=${finalBest.params.ma}, P=${finalBest.params.profit}, S=${finalBest.params.stop})`);
    
    // Explicitly save the best result to the database as "OPTIMAL" if needed, 
    // but runAllWindowedBacktests already saved the runs. 
    // We just need to report them.
  }

  async reportTopSets() {
    console.log('\n🏆 TOP PERFORMING PARAMETER SETS (By Alpha)');
    console.log('================================================================================');
    
    // Query OptimizationResults table
    const results = await this.prisma.optimizationResults.findMany({
      orderBy: { alpha: 'desc' },
      take: 20,
      select: {
        baseAsset: true,
        quoteAsset: true,
        zScoreThreshold: true,
        movingAverages: true,
        profitPercent: true,
        stopLossPercent: true,
        alpha: true,
        sharpeRatio: true,
        totalReturn: true,
        totalTrades: true
      }
    });

    console.log(`${'PAIR'.padEnd(10)} | ${'ALPHA'.padEnd(10)} | ${'SHARPE'.padEnd(8)} | ${'RETURN'.padEnd(10)} | ${'TRADES'.padEnd(8)} | ${'PARAMS (Z/MA/P/S)'.padEnd(30)}`);
    console.log('-'.repeat(90));

    for (const r of results) {
        const params = `${Number(r.zScoreThreshold)} / ${r.movingAverages} / ${Number(r.profitPercent)}% / ${Number(r.stopLossPercent)}%`;
        console.log(
            `${r.baseAsset}/${r.quoteAsset}`.padEnd(10) + ' | ' +
            `${Number(r.alpha).toFixed(2)}%`.padEnd(10) + ' | ' +
            `${Number(r.sharpeRatio).toFixed(2)}`.padEnd(8) + ' | ' +
            `${Number(r.totalReturn).toFixed(2)}%`.padEnd(10) + ' | ' +
            `${r.totalTrades}`.padEnd(8) + ' | ' +
            params
        );
    }
    console.log('================================================================================');
  }

import { TradingPairsGenerator } from '../src/utils/TradingPairsGenerator';

// ... (existing code)

  async run() {
    await this.initialize();

    let pairs: { base: string, quote: string }[] = [];

    // Option 1: Prioritize TRADING_PAIRS from env (Fastest, Offline-friendly)
    if (process.env.TRADING_PAIRS) {
      const rawPairs = process.env.TRADING_PAIRS.split(',').map(s => s.trim()).filter(s => s.length > 0);
      const knownQuotes = ['USDT', 'USDC', 'BUSD', 'DAI', 'FDUSD', 'BTC', 'ETH', 'BNB'];
      
      pairs = rawPairs.map(raw => {
        const quote = knownQuotes.find(q => raw.endsWith(q));
        if (quote) {
          const base = raw.slice(0, -quote.length);
          return { base, quote };
        }
        return null; 
      }).filter((p): p is { base: string, quote: string } => p !== null && p.base.length > 0);

      this.dashboard.log(`Loaded ${pairs.length} pairs from TRADING_PAIRS env`);
    } 
    
    // Option 2: Dynamic discovery using TradingPairsGenerator (Comprehensive)
    if (pairs.length === 0) {
      const baseCoinsStr = process.env.BASE_COINS || '';
      const baseCoins = baseCoinsStr.split(',').map(s => s.trim()).filter(s => s.length > 0);
      
      if (baseCoins.length > 0) {
        this.dashboard.log(`Discovering pairs for ${baseCoins.length} base coins...`);
        const generator = new TradingPairsGenerator();
        try {
          const validPairStrings = await generator.generateTradingPairs(baseCoins);
          const details = await generator.getDetailedPairInfo(validPairStrings);
          
          pairs = details.map(d => ({
            base: d.baseAsset,
            quote: d.quoteAsset
          }));
          this.dashboard.log(`Discovered ${pairs.length} valid pairs from Binance`);
        } catch (error) {
           this.dashboard.log(`Error discovering pairs: ${error instanceof Error ? error.message : String(error)}`);
           // Fallback to basic construction if API fails
           const quoteAsset = 'USDT';
           pairs = baseCoins.map(base => ({ base, quote: quoteAsset }));
           this.dashboard.log(`Fallback: Constructed ${pairs.length} pairs (assuming USDT quote)`);
        }
      }
    }

    const totalTasks = pairs.length * (INITIAL_SAMPLES + REFINEMENT_SAMPLES);
    this.dashboard.setTotalTasks(totalTasks);
    this.dashboard.log(`Starting Optimization (Max Alpha). Total Runs: ${totalTasks}`);
    
    const pairPromises = pairs.map(p => this.optimizePair(p.base, p.quote));
    await Promise.all(pairPromises);

    this.dashboard.log('Optimization Complete');
    
    // Render final report
    readline.cursorTo(process.stdout, 0, 0);
    readline.clearScreenDown(process.stdout);
    await this.reportTopSets();

    await this.prisma.$disconnect();
    // Keep process alive briefly
    await new Promise(r => setTimeout(r, 1000));
  }
}

const optimizer = new ParameterOptimizer();
optimizer.run().catch(console.error);
