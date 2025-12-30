#!/usr/bin/env ts-node

/**
 * Advanced Parameter Optimization Script (EDA Approach)
 * 
 * This script performs a parallelized, iterative optimization of trading parameters
 * using an Estimation of Distribution Algorithm (EDA) approach.
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
const BACKTEST_TIMEOUT = 60000; // 60s hard timeout (increased slightly)
const MIN_DATAPOINTS = 100;

// Ranges (Updated Defaults)
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

    console.log(`🚀 OPTIMIZATION DASHBOARD`);
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
      const now = new Date();
      const windowMonths = Math.ceil((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30));

      const paramStr = `Z=${params.zScore} MA=${params.ma} P=${params.profit} S=${params.stop}`;
      this.dashboard.updateWorker(workerId, {
        status: 'RUNNING',
        pair: `${baseAsset}/${quoteAsset}`,
        params: paramStr,
        progress: 0,
        startTime: Date.now()
      });

      const args = [
        'scripts/runWindowedBacktest.ts',
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
        
        // Parse Progress
        const progressMatch = str.match(/PROGRESS: (\d+)/);
        if (progressMatch) {
          this.dashboard.updateWorker(workerId, { progress: parseInt(progressMatch[1]) });
        }
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          try {
            const returnMatch = stdout.match(/Total Return: (-?\d+\.?\d*)%/);
            const sharpeMatch = stdout.match(/Sharpe Ratio: (-?\d+\.?\d*)/);
            const tradesMatch = stdout.match(/Total Trades: (\d+)/);

            if (returnMatch && sharpeMatch) {
              resolve({
                params,
                metrics: {
                  totalReturn: parseFloat(returnMatch[1]),
                  sharpeRatio: parseFloat(sharpeMatch[1]),
                  trades: tradesMatch ? parseInt(tradesMatch[1]) : 0
                },
                runId: 'unknown'
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

    // Analyze Phase 1
    const sorted = phase1Results.sort((a, b) => b.metrics.sharpeRatio - a.metrics.sharpeRatio);
    const topPerformers = sorted.slice(0, Math.max(3, Math.floor(phase1Results.length * 0.2)));
    const best = topPerformers[0];
    this.dashboard.log(`Phase 1 Best (${baseAsset}): Sharpe=${best.metrics.sharpeRatio.toFixed(2)}`);

    // Phase 2
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
    const all = [...phase1Results, ...phase2Results].sort((a, b) => b.metrics.sharpeRatio - a.metrics.sharpeRatio);
    this.dashboard.log(`Optimized ${baseAsset}: Best Sharpe=${all[0].metrics.sharpeRatio.toFixed(3)}`);
  }

  async run() {
    await this.initialize();

    const baseCoinsStr = process.env.BASE_COINS || '';
    const baseCoins = baseCoinsStr.split(',').map(s => s.trim()).filter(s => s.length > 0);
    const quoteAsset = 'USDT';

    const totalTasks = baseCoins.length * (INITIAL_SAMPLES + REFINEMENT_SAMPLES);
    this.dashboard.setTotalTasks(totalTasks);
    this.dashboard.log(`Starting Optimization for ${baseCoins.length} pairs. Total Runs: ${totalTasks}`);

    // Since our pool is global, we can just fire them all off.
    // However, Node might choke on hundreds of Promises. Let's limit active PAIRS too?
    // Actually, the `getWorkerSlot` semaphore limits the *execution*.
    // Creating 1000 promises that wait for a slot is fine in Node.
    
    const pairPromises = baseCoins.map(coin => this.optimizePair(coin, quoteAsset));
    await Promise.all(pairPromises);

    this.dashboard.log('Optimization Complete');
    await this.prisma.$disconnect();
    // Keep process alive briefly to show final state
    await new Promise(r => setTimeout(r, 2000));
  }
}

const optimizer = new ParameterOptimizer();
optimizer.run().catch(console.error);