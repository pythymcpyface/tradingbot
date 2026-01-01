#!/usr/bin/env ts-node

/**
 * Fill Parameter Gaps Script
 *
 * Identifies missing parameter combinations in stable regions and runs
 * backtests to fill them. Each parameter set is tested across all trading
 * pairs with the full walk-forward analysis (12-month windows, 6-month steps).
 *
 * Usage:
 *   npm run fill:gaps                         # Run backtests for 10 missing param sets
 *   npm run fill:gaps -- --limit 20           # Run 20 parameter sets
 *   npm run fill:gaps -- --concurrency 5      # 5 parallel backtests
 *   npm run fill:gaps -- --pairs 10           # Test on top 10 pairs only
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

config();

interface ParameterSet {
  zScore: number;
  ma: number;
  profit: number;
  stop: number;
}

interface TradingPair {
  baseAsset: string;
  quoteAsset: string;
}

interface CLIOptions {
  limit: number;
  concurrency: number;
  pairsLimit: number;
  dryRun: boolean;
}

interface StableRegion {
  zScore: { min: number; max: number; step: number };
  ma: { min: number; max: number; step: number };
  profit: { min: number; max: number; step: number };
  stop: { min: number; max: number; step: number };
}

class ParameterGapFiller {
  private prisma: PrismaClient;
  private activeProcesses: ChildProcess[] = [];
  private completed = 0;
  private failed = 0;
  private total = 0;
  private startTime = Date.now();

  constructor() {
    this.prisma = new PrismaClient();
  }

  async initialize(): Promise<void> {
    await this.prisma.$connect();
    console.log('Connected to database');
  }

  parseArgs(): CLIOptions {
    const args = process.argv.slice(2);
    const options: CLIOptions = {
      limit: 10,
      concurrency: 3,
      pairsLimit: 0, // 0 = all pairs
      dryRun: false
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      const nextArg = args[i + 1];

      switch (arg) {
        case '--limit':
          options.limit = parseInt(nextArg) || 10;
          i++;
          break;
        case '--concurrency':
          options.concurrency = parseInt(nextArg) || 3;
          i++;
          break;
        case '--pairs':
          options.pairsLimit = parseInt(nextArg) || 0;
          i++;
          break;
        case '--dry-run':
          options.dryRun = true;
          break;
        case '--help':
        case '-h':
          this.printHelp();
          process.exit(0);
      }
    }

    return options;
  }

  printHelp(): void {
    console.log(`
Fill Parameter Gaps

Runs backtests for missing parameter combinations in stable regions.
Each parameter set is tested across all trading pairs with full walk-forward
analysis (12-month windows, 6-month steps across the 4-year date range).

Usage:
  npx ts-node scripts/fill-parameter-gaps.ts [options]

Options:
  --limit <N>        Number of parameter sets to test (default: 10)
  --concurrency <N>  Parallel backtest processes (default: 3)
  --pairs <N>        Limit to top N pairs by data coverage (default: all)
  --dry-run          Show what would be tested without running
  --help, -h         Show this help message

Examples:
  npm run fill:gaps
  npm run fill:gaps -- --limit 20 --concurrency 5
  npm run fill:gaps -- --pairs 10 --limit 50
`);
  }

  /**
   * Get all trading pairs with Glicko data
   */
  async getTradingPairs(limit: number): Promise<TradingPair[]> {
    interface SymbolResult {
      symbol: string;
      dataPoints: number;
    }

    // Get pairs ordered by data coverage (most data first)
    const symbols = await this.prisma.$queryRaw<SymbolResult[]>`
      SELECT
        symbol,
        COUNT(*)::int as "dataPoints"
      FROM klines
      GROUP BY symbol
      ORDER BY "dataPoints" DESC
    `;

    // Parse symbol into baseAsset/quoteAsset
    const quoteAssets = ['USDT', 'BTC', 'ETH', 'BNB'];
    const parsedPairs: TradingPair[] = [];

    for (const s of symbols) {
      for (const quote of quoteAssets) {
        if (s.symbol.endsWith(quote)) {
          const base = s.symbol.slice(0, -quote.length);
          if (base.length > 0) {
            parsedPairs.push({ baseAsset: base, quoteAsset: quote });
            break;
          }
        }
      }
    }

    return limit > 0 ? parsedPairs.slice(0, limit) : parsedPairs;
  }

  /**
   * Get missing parameter combinations in stable region
   */
  async getMissingParameters(region: StableRegion): Promise<ParameterSet[]> {
    // Generate all expected combinations
    const expected = new Map<string, ParameterSet>();

    for (let z = region.zScore.min; z <= region.zScore.max; z = Math.round((z + region.zScore.step) * 10) / 10) {
      for (let ma = region.ma.min; ma <= region.ma.max; ma += region.ma.step) {
        for (let p = region.profit.min; p <= region.profit.max; p = Math.round((p + region.profit.step) * 10) / 10) {
          for (let s = region.stop.min; s <= region.stop.max; s = Math.round((s + region.stop.step) * 10) / 10) {
            const key = `${z}_${ma}_${p}_${s}`;
            expected.set(key, { zScore: z, ma, profit: p, stop: s });
          }
        }
      }
    }

    // Get existing combinations
    interface ExistingParam {
      z: number;
      ma: number;
      profit: number;
      stop: number;
    }

    const existing = await this.prisma.$queryRaw<ExistingParam[]>`
      SELECT DISTINCT
        "zScoreThreshold"::float as z,
        "movingAverages" as ma,
        "profitPercent"::float as profit,
        "stopLossPercent"::float as stop
      FROM optimization_results
      WHERE "zScoreThreshold" BETWEEN ${region.zScore.min} AND ${region.zScore.max}
        AND "movingAverages" BETWEEN ${region.ma.min} AND ${region.ma.max}
        AND "profitPercent" BETWEEN ${region.profit.min} AND ${region.profit.max}
        AND "stopLossPercent" BETWEEN ${region.stop.min} AND ${region.stop.max}
    `;

    // Remove existing from expected
    existing.forEach(e => {
      const key = `${Math.round(e.z * 10) / 10}_${e.ma}_${Math.round(e.profit * 10) / 10}_${Math.round(e.stop * 10) / 10}`;
      expected.delete(key);
    });

    // Convert to array and sort by distance to stable center
    const missing = Array.from(expected.values());
    const centerZ = 3.5;
    const centerMA = 18;
    const centerProfit = 13;
    const centerStop = 2;

    missing.sort((a, b) => {
      const distA = Math.abs(a.zScore - centerZ) +
                    Math.abs(a.ma - centerMA) / 10 +
                    Math.abs(a.profit - centerProfit) / 5 +
                    Math.abs(a.stop - centerStop) / 5;
      const distB = Math.abs(b.zScore - centerZ) +
                    Math.abs(b.ma - centerMA) / 10 +
                    Math.abs(b.profit - centerProfit) / 5 +
                    Math.abs(b.stop - centerStop) / 5;
      return distA - distB;
    });

    return missing;
  }

  /**
   * Run a single backtest
   */
  runBacktest(params: ParameterSet, baseAsset: string, quoteAsset: string): Promise<boolean> {
    return new Promise((resolve) => {
      const startDate = '2021-12-08';
      const windowMonths = 12;

      const childProcess = spawn('npx', [
        'ts-node',
        'scripts/runAllWindowedBacktests.ts',
        startDate,
        windowMonths.toString(),
        baseAsset,
        quoteAsset,
        params.zScore.toString(),
        params.ma.toString(),
        params.profit.toString(),
        params.stop.toString()
      ], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.activeProcesses.push(childProcess);

      let stdout = '';

      childProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      const timeout = setTimeout(() => {
        childProcess.kill();
        this.activeProcesses = this.activeProcesses.filter(p => p !== childProcess);
        resolve(false);
      }, 180000); // 3 minute timeout

      childProcess.on('close', (code) => {
        clearTimeout(timeout);
        this.activeProcesses = this.activeProcesses.filter(p => p !== childProcess);
        resolve(code === 0);
      });

      childProcess.on('error', () => {
        clearTimeout(timeout);
        this.activeProcesses = this.activeProcesses.filter(p => p !== childProcess);
        resolve(false);
      });
    });
  }

  /**
   * Run backtests for all pairs with a single parameter set
   */
  async runParameterAcrossPairs(
    param: ParameterSet,
    pairs: TradingPair[],
    concurrency: number
  ): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;

    const queue = [...pairs];
    const running: Promise<void>[] = [];

    const runNext = async (): Promise<void> => {
      if (queue.length === 0) return;

      const pair = queue.shift()!;
      const result = await this.runBacktest(param, pair.baseAsset, pair.quoteAsset);

      if (result) {
        success++;
      } else {
        failed++;
      }

      // Progress update for pairs
      const done = success + failed;
      const total = pairs.length;
      process.stdout.write(`\r    Pairs: ${done}/${total} (${success} OK, ${failed} FAIL)`);

      if (queue.length > 0) {
        await runNext();
      }
    };

    // Start initial batch
    for (let i = 0; i < Math.min(concurrency, pairs.length); i++) {
      running.push(runNext());
    }

    await Promise.all(running);
    console.log(''); // New line after progress

    return { success, failed };
  }

  /**
   * Main execution
   */
  async run(): Promise<void> {
    try {
      await this.initialize();

      const options = this.parseArgs();

      console.log('\n=== Fill Parameter Gaps ===\n');

      // Define stable region
      const stableRegion: StableRegion = {
        zScore: { min: 2.8, max: 4.2, step: 0.1 },
        ma: { min: 14, max: 20, step: 2 },
        profit: { min: 10, max: 15, step: 0.5 },
        stop: { min: 1, max: 4, step: 0.5 }
      };

      console.log('Stable region:');
      console.log(`  zScore: ${stableRegion.zScore.min} - ${stableRegion.zScore.max}`);
      console.log(`  MA: ${stableRegion.ma.min} - ${stableRegion.ma.max}`);
      console.log(`  Profit: ${stableRegion.profit.min}% - ${stableRegion.profit.max}%`);
      console.log(`  Stop: ${stableRegion.stop.min}% - ${stableRegion.stop.max}%`);
      console.log('');

      // Get trading pairs
      const pairs = await this.getTradingPairs(options.pairsLimit);
      console.log(`Trading pairs: ${pairs.length}`);
      if (options.pairsLimit > 0) {
        console.log(`  (limited to top ${options.pairsLimit} by data coverage)`);
      }

      // Get missing parameters
      const missing = await this.getMissingParameters(stableRegion);
      console.log(`Missing parameter combinations: ${missing.length}`);
      console.log(`Will test: ${Math.min(options.limit, missing.length)} parameter sets`);
      console.log(`Concurrency: ${options.concurrency} parallel backtests`);
      console.log('');

      const toTest = missing.slice(0, options.limit);

      // Estimate time
      const backtestsPerParam = pairs.length;
      const totalBacktests = toTest.length * backtestsPerParam;
      const estimatedSeconds = totalBacktests * 30; // ~30s per backtest
      console.log(`Total backtests: ${totalBacktests} (${toTest.length} params x ${pairs.length} pairs)`);
      console.log(`Estimated time: ${Math.round(estimatedSeconds / 60)} minutes`);
      console.log('');

      if (options.dryRun) {
        console.log('DRY RUN - Would test these parameters:\n');
        toTest.forEach((p, i) => {
          console.log(`${i + 1}. z=${p.zScore} MA=${p.ma} P=${p.profit}% S=${p.stop}%`);
        });
        console.log(`\nAcross ${pairs.length} pairs:`);
        pairs.slice(0, 10).forEach(p => console.log(`  - ${p.baseAsset}/${p.quoteAsset}`));
        if (pairs.length > 10) console.log(`  ... and ${pairs.length - 10} more`);
        return;
      }

      if (toTest.length === 0) {
        console.log('No missing parameters to test!');
        return;
      }

      console.log('Starting backtests...\n');
      this.startTime = Date.now();

      let totalSuccess = 0;
      let totalFailed = 0;

      for (let i = 0; i < toTest.length; i++) {
        const param = toTest[i];
        const paramStr = `z=${param.zScore} MA=${param.ma} P=${param.profit}% S=${param.stop}%`;

        console.log(`[${i + 1}/${toTest.length}] Testing: ${paramStr}`);

        const result = await this.runParameterAcrossPairs(param, pairs, options.concurrency);
        totalSuccess += result.success;
        totalFailed += result.failed;

        // Show running totals
        const elapsed = (Date.now() - this.startTime) / 1000;
        const done = (i + 1) * pairs.length;
        const rate = done / elapsed;
        const remaining = (totalBacktests - done) / rate;
        console.log(`    Total progress: ${done}/${totalBacktests} | Rate: ${rate.toFixed(1)}/s | ETA: ${Math.round(remaining / 60)}m`);
        console.log('');
      }

      const totalTime = (Date.now() - this.startTime) / 1000;

      console.log('\n=== SUMMARY ===');
      console.log(`Parameter sets tested: ${toTest.length}`);
      console.log(`Total backtests: ${totalSuccess + totalFailed}`);
      console.log(`Successful: ${totalSuccess}`);
      console.log(`Failed: ${totalFailed}`);
      console.log(`Time: ${(totalTime / 60).toFixed(1)} minutes`);
      console.log(`Rate: ${((totalSuccess + totalFailed) / totalTime).toFixed(2)} backtests/sec`);

      // Show remaining gaps
      const remainingMissing = await this.getMissingParameters(stableRegion);
      console.log(`\nRemaining gaps in stable region: ${remainingMissing.length}`);

    } catch (error) {
      console.error('\nError:', error);
      throw error;
    } finally {
      this.activeProcesses.forEach(p => p.kill());
      await this.prisma.$disconnect();
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nInterrupted. Cleaning up...');
  process.exit(1);
});

// Execute
const filler = new ParameterGapFiller();
filler.run().catch(console.error);
