#!/usr/bin/env ts-node

/**
 * Grid Search Parameter Stability Analysis
 *
 * Tests parameter stability by running backtests on neighboring parameter
 * combinations around top consistent performers.
 *
 * Goal: Identify parameters that are on a "plateau" (stable) vs "cliff" (fragile)
 *
 * Usage:
 *   npm run grid:stability                    # Test top 5 consistent parameters
 *   npm run grid:stability -- --top 10        # Test top 10
 *   npm run grid:stability -- --radius 2      # Larger search radius
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { config } from 'dotenv';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

config();

interface ParameterSet {
  zScoreThreshold: number;
  movingAverages: number;
  profitPercent: number;
  stopLossPercent: number;
}

interface ConsistencyResult extends ParameterSet {
  windowCount: number;
  avgAlpha: number;
  consistencyScore: number | null;
  windowWinRate: number;
}

interface GridResult {
  params: ParameterSet;
  avgAlpha: number;
  windowCount: number;
  isCenter: boolean;
}

interface StabilityReport {
  center: ParameterSet;
  centerAlpha: number;
  neighborResults: GridResult[];
  stabilityScore: number;  // min(neighbor_alpha) / center_alpha
  avgNeighborAlpha: number;
  worstNeighborAlpha: number;
  bestNeighborAlpha: number;
  neighborsAboveZero: number;
  totalNeighbors: number;
  recommendation: 'STABLE' | 'MODERATE' | 'FRAGILE';
}

interface CLIOptions {
  top: number;
  radius: number;
  concurrency: number;
}

class GridSearchStability {
  private prisma: PrismaClient;
  private activeProcesses: ChildProcess[] = [];

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
      top: 5,
      radius: 1,
      concurrency: 3
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      const nextArg = args[i + 1];

      switch (arg) {
        case '--top':
          options.top = parseInt(nextArg) || 5;
          i++;
          break;
        case '--radius':
          options.radius = parseInt(nextArg) || 1;
          i++;
          break;
        case '--concurrency':
          options.concurrency = parseInt(nextArg) || 3;
          i++;
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
Grid Search Parameter Stability Analysis

Usage:
  npx ts-node scripts/grid-search-stability.ts [options]

Options:
  --top <N>          Number of top consistent parameters to test (default: 5)
  --radius <N>       Search radius multiplier (default: 1)
                     radius=1: zScore +/-0.2, MA +/-2, profit/stop +/-1%
                     radius=2: zScore +/-0.4, MA +/-4, profit/stop +/-2%
  --concurrency <N>  Parallel backtest processes (default: 3)
  --help, -h         Show this help message

Examples:
  npm run grid:stability
  npm run grid:stability -- --top 10 --radius 2
`);
  }

  /**
   * Get top consistent parameters from database
   */
  async getTopConsistentParams(limit: number): Promise<ConsistencyResult[]> {
    const results = await this.prisma.$queryRaw<ConsistencyResult[]>`
      SELECT
        "zScoreThreshold"::float as "zScoreThreshold",
        "movingAverages",
        "profitPercent"::float as "profitPercent",
        "stopLossPercent"::float as "stopLossPercent",
        COUNT(*)::int as "windowCount",
        AVG("alpha"::float)::float as "avgAlpha",
        (AVG("alpha"::float) / NULLIF(STDDEV("alpha"::float), 0))::float as "consistencyScore",
        (SUM(CASE WHEN "alpha" > 0 THEN 1 ELSE 0 END)::float / COUNT(*))::float as "windowWinRate"
      FROM optimization_results
      WHERE "totalTrades" >= 5
      GROUP BY "zScoreThreshold", "movingAverages", "profitPercent", "stopLossPercent"
      HAVING COUNT(*) >= 3 AND AVG("alpha"::float) > 0
      ORDER BY AVG("alpha"::float) / NULLIF(STDDEV("alpha"::float), 0) DESC NULLS LAST
      LIMIT ${limit}
    `;

    return results;
  }

  /**
   * Generate grid of neighboring parameters
   */
  generateNeighborGrid(center: ParameterSet, radius: number): ParameterSet[] {
    const neighbors: ParameterSet[] = [];

    // Grid increments (scaled by radius)
    const zScoreStep = 0.2 * radius;
    const maStep = 2 * radius;
    const profitStep = 1.0 * radius;
    const stopStep = 1.0 * radius;

    // Generate neighbors for each dimension independently (not full cartesian product)
    // This reduces from 3^4=81 to 4*3=12 tests per center

    // zScore neighbors
    for (const delta of [-1, 0, 1]) {
      const zScore = Math.round((center.zScoreThreshold + delta * zScoreStep) * 10) / 10;
      if (zScore >= 1.5 && zScore <= 4.5 && delta !== 0) {
        neighbors.push({
          ...center,
          zScoreThreshold: zScore
        });
      }
    }

    // MA neighbors
    for (const delta of [-1, 0, 1]) {
      const ma = center.movingAverages + delta * maStep;
      if (ma >= 2 && ma <= 20 && delta !== 0) {
        neighbors.push({
          ...center,
          movingAverages: ma
        });
      }
    }

    // Profit neighbors
    for (const delta of [-1, 0, 1]) {
      const profit = Math.round((center.profitPercent + delta * profitStep) * 10) / 10;
      if (profit >= 1 && profit <= 15 && delta !== 0) {
        neighbors.push({
          ...center,
          profitPercent: profit
        });
      }
    }

    // Stop neighbors
    for (const delta of [-1, 0, 1]) {
      const stop = Math.round((center.stopLossPercent + delta * stopStep) * 10) / 10;
      if (stop >= 1 && stop <= 10 && delta !== 0) {
        neighbors.push({
          ...center,
          stopLossPercent: stop
        });
      }
    }

    return neighbors;
  }

  /**
   * Check if results already exist for a parameter set (exact match)
   */
  async getExistingResults(params: ParameterSet): Promise<{ avgAlpha: number; windowCount: number } | null> {
    const results = await this.prisma.$queryRaw<{ avgAlpha: number; windowCount: number }[]>`
      SELECT
        AVG("alpha"::float)::float as "avgAlpha",
        COUNT(*)::int as "windowCount"
      FROM optimization_results
      WHERE "zScoreThreshold" = ${params.zScoreThreshold}
        AND "movingAverages" = ${params.movingAverages}
        AND "profitPercent" = ${params.profitPercent}
        AND "stopLossPercent" = ${params.stopLossPercent}
        AND "totalTrades" >= 5
      GROUP BY "zScoreThreshold", "movingAverages", "profitPercent", "stopLossPercent"
      HAVING COUNT(*) >= 3
    `;

    return results.length > 0 ? results[0] : null;
  }

  /**
   * Find nearby parameters within a tolerance range
   */
  async findNearbyResults(center: ParameterSet, radius: number): Promise<GridResult[]> {
    const zTolerance = 0.3 * radius;
    const maTolerance = 4 * radius;
    const profitTolerance = 2.0 * radius;
    const stopTolerance = 2.0 * radius;

    interface NearbyResult {
      zScoreThreshold: number;
      movingAverages: number;
      profitPercent: number;
      stopLossPercent: number;
      avgAlpha: number;
      windowCount: number;
    }

    const results = await this.prisma.$queryRaw<NearbyResult[]>`
      SELECT
        "zScoreThreshold"::float as "zScoreThreshold",
        "movingAverages",
        "profitPercent"::float as "profitPercent",
        "stopLossPercent"::float as "stopLossPercent",
        AVG("alpha"::float)::float as "avgAlpha",
        COUNT(*)::int as "windowCount"
      FROM optimization_results
      WHERE "zScoreThreshold" BETWEEN ${center.zScoreThreshold - zTolerance} AND ${center.zScoreThreshold + zTolerance}
        AND "movingAverages" BETWEEN ${center.movingAverages - maTolerance} AND ${center.movingAverages + maTolerance}
        AND "profitPercent" BETWEEN ${center.profitPercent - profitTolerance} AND ${center.profitPercent + profitTolerance}
        AND "stopLossPercent" BETWEEN ${center.stopLossPercent - stopTolerance} AND ${center.stopLossPercent + stopTolerance}
        AND "totalTrades" >= 5
        AND NOT (
          "zScoreThreshold" = ${center.zScoreThreshold}
          AND "movingAverages" = ${center.movingAverages}
          AND "profitPercent" = ${center.profitPercent}
          AND "stopLossPercent" = ${center.stopLossPercent}
        )
      GROUP BY "zScoreThreshold", "movingAverages", "profitPercent", "stopLossPercent"
      HAVING COUNT(*) >= 3
      ORDER BY ABS("zScoreThreshold" - ${center.zScoreThreshold}) +
               ABS("movingAverages" - ${center.movingAverages})/10.0 +
               ABS("profitPercent" - ${center.profitPercent})/5.0 +
               ABS("stopLossPercent" - ${center.stopLossPercent})/5.0
      LIMIT 20
    `;

    return results.map(r => ({
      params: {
        zScoreThreshold: r.zScoreThreshold,
        movingAverages: r.movingAverages,
        profitPercent: r.profitPercent,
        stopLossPercent: r.stopLossPercent
      },
      avgAlpha: r.avgAlpha,
      windowCount: r.windowCount,
      isCenter: false
    }));
  }

  /**
   * Run backtest for a parameter set
   */
  async runBacktest(params: ParameterSet): Promise<{ avgAlpha: number; windowCount: number } | null> {
    // First check if we already have results
    const existing = await this.getExistingResults(params);
    if (existing) {
      return existing;
    }

    // Need to run backtest - use a representative pair (ETH/USDT has good data)
    return new Promise((resolve) => {
      const startDate = '2021-12-08';
      const windowMonths = 12;

      const childProcess = spawn('npx', [
        'ts-node',
        'scripts/runAllWindowedBacktests.ts',
        startDate,
        windowMonths.toString(),
        'ETH',  // Use ETH as representative
        'USDT',
        params.zScoreThreshold.toString(),
        params.movingAverages.toString(),
        params.profitPercent.toString(),
        params.stopLossPercent.toString()
      ], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.activeProcesses.push(childProcess);

      let stdout = '';
      let stderr = '';

      childProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      childProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      const timeout = setTimeout(() => {
        childProcess.kill();
        resolve(null);
      }, 120000); // 2 minute timeout

      childProcess.on('close', async (code) => {
        clearTimeout(timeout);
        this.activeProcesses = this.activeProcesses.filter(p => p !== childProcess);

        if (code === 0) {
          // Parse results from stdout or check database
          const results = await this.getExistingResults(params);
          resolve(results);
        } else {
          resolve(null);
        }
      });
    });
  }

  /**
   * Analyze stability for a center parameter set
   */
  async analyzeStability(center: ConsistencyResult, radius: number): Promise<StabilityReport> {
    // Find nearby results using fuzzy matching
    const neighborResults = await this.findNearbyResults(center, radius);

    console.log(`  Found ${neighborResults.length} nearby parameter sets in database`);

    if (neighborResults.length > 0) {
      // Show closest neighbors
      const closest = neighborResults.slice(0, 3);
      closest.forEach(n => {
        const diff = `dZ=${(n.params.zScoreThreshold - center.zScoreThreshold).toFixed(1)} dMA=${n.params.movingAverages - center.movingAverages} dP=${(n.params.profitPercent - center.profitPercent).toFixed(1)} dS=${(n.params.stopLossPercent - center.stopLossPercent).toFixed(1)}`;
        console.log(`    Neighbor: alpha=${n.avgAlpha.toFixed(1)}% (${diff})`);
      });
    }

    // Calculate stability metrics
    const validNeighbors = neighborResults.filter(n => n.avgAlpha !== null);
    const neighborAlphas = validNeighbors.map(n => n.avgAlpha);

    const avgNeighborAlpha = neighborAlphas.length > 0
      ? neighborAlphas.reduce((a, b) => a + b, 0) / neighborAlphas.length
      : 0;
    const worstNeighborAlpha = neighborAlphas.length > 0
      ? Math.min(...neighborAlphas)
      : 0;
    const bestNeighborAlpha = neighborAlphas.length > 0
      ? Math.max(...neighborAlphas)
      : 0;
    const neighborsAboveZero = neighborAlphas.filter(a => a > 0).length;

    // Stability score: worst neighbor / center (higher is more stable)
    const stabilityScore = center.avgAlpha > 0
      ? worstNeighborAlpha / center.avgAlpha
      : 0;

    // Recommendation based on stability
    let recommendation: 'STABLE' | 'MODERATE' | 'FRAGILE';
    if (stabilityScore >= 0.5 && neighborsAboveZero >= validNeighbors.length * 0.8) {
      recommendation = 'STABLE';
    } else if (stabilityScore >= 0.2 && neighborsAboveZero >= validNeighbors.length * 0.5) {
      recommendation = 'MODERATE';
    } else {
      recommendation = 'FRAGILE';
    }

    return {
      center: {
        zScoreThreshold: center.zScoreThreshold,
        movingAverages: center.movingAverages,
        profitPercent: center.profitPercent,
        stopLossPercent: center.stopLossPercent
      },
      centerAlpha: center.avgAlpha,
      neighborResults,
      stabilityScore,
      avgNeighborAlpha,
      worstNeighborAlpha,
      bestNeighborAlpha,
      neighborsAboveZero,
      totalNeighbors: validNeighbors.length,
      recommendation
    };
  }

  /**
   * Export results to JSON
   */
  exportResults(reports: StabilityReport[]): string {
    const analysisDir = path.join(process.cwd(), 'analysis');
    if (!fs.existsSync(analysisDir)) {
      fs.mkdirSync(analysisDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `grid-stability-${timestamp}.json`;
    const filepath = path.join(analysisDir, filename);

    const exportData = {
      generatedAt: new Date().toISOString(),
      reports: reports.map(r => ({
        ...r,
        neighborResults: r.neighborResults.map(n => ({
          zScore: n.params.zScoreThreshold,
          ma: n.params.movingAverages,
          profit: n.params.profitPercent,
          stop: n.params.stopLossPercent,
          avgAlpha: n.avgAlpha,
          windows: n.windowCount
        }))
      }))
    };

    fs.writeFileSync(filepath, JSON.stringify(exportData, null, 2));
    return filepath;
  }

  /**
   * Main execution
   */
  async run(): Promise<void> {
    try {
      await this.initialize();

      const options = this.parseArgs();

      console.log('\n=== Grid Search Parameter Stability Analysis ===\n');
      console.log(`Testing top ${options.top} consistent parameters`);
      console.log(`Search radius: ${options.radius} (zScore +/-${0.2 * options.radius}, MA +/-${2 * options.radius})\n`);

      // Get top consistent parameters
      const topParams = await this.getTopConsistentParams(options.top);

      if (topParams.length === 0) {
        console.log('No consistent parameters found. Run optimization first.');
        return;
      }

      console.log(`Found ${topParams.length} top consistent parameters\n`);

      // Analyze stability for each
      const reports: StabilityReport[] = [];

      for (let i = 0; i < topParams.length; i++) {
        const param = topParams[i];
        console.log(`[${i + 1}/${topParams.length}] Analyzing zScore=${param.zScoreThreshold}, MA=${param.movingAverages}, Profit=${param.profitPercent}%, Stop=${param.stopLossPercent}%`);
        console.log(`  Center: avgAlpha=${param.avgAlpha.toFixed(2)}%, consistency=${param.consistencyScore?.toFixed(2) || 'N/A'}`);

        const report = await this.analyzeStability(param, options.radius);
        reports.push(report);

        console.log(`  Result: ${report.recommendation} (stability=${report.stabilityScore.toFixed(2)}, ${report.neighborsAboveZero}/${report.totalNeighbors} neighbors positive)\n`);
      }

      // Summary
      console.log('=== STABILITY SUMMARY ===\n');
      console.log('Rank | Parameters                    | Center Alpha | Stability | Neighbors+ | Status');
      console.log('-'.repeat(95));

      reports.forEach((r, i) => {
        const params = `z=${r.center.zScoreThreshold} MA=${r.center.movingAverages} P=${r.center.profitPercent}% S=${r.center.stopLossPercent}%`;
        const status = r.recommendation === 'STABLE' ? 'STABLE' :
                       r.recommendation === 'MODERATE' ? 'MODERATE' : 'FRAGILE';
        console.log(
          `  ${String(i + 1).padStart(2)}  | ${params.padEnd(29)} | ${r.centerAlpha.toFixed(1).padStart(10)}% | ${r.stabilityScore.toFixed(2).padStart(9)} | ${r.neighborsAboveZero}/${r.totalNeighbors}`.padEnd(10) + ` | ${status}`
        );
      });

      // Recommendations
      const stable = reports.filter(r => r.recommendation === 'STABLE');
      const moderate = reports.filter(r => r.recommendation === 'MODERATE');
      const fragile = reports.filter(r => r.recommendation === 'FRAGILE');

      console.log('\n=== RECOMMENDATIONS ===\n');

      if (stable.length > 0) {
        console.log(`STABLE (${stable.length}): Safe to use in production`);
        stable.forEach(r => {
          console.log(`  - zScore=${r.center.zScoreThreshold}, MA=${r.center.movingAverages}, Profit=${r.center.profitPercent}%, Stop=${r.center.stopLossPercent}%`);
        });
      }

      if (moderate.length > 0) {
        console.log(`\nMODERATE (${moderate.length}): Use with caution, monitor performance`);
        moderate.forEach(r => {
          console.log(`  - zScore=${r.center.zScoreThreshold}, MA=${r.center.movingAverages}, Profit=${r.center.profitPercent}%, Stop=${r.center.stopLossPercent}%`);
        });
      }

      if (fragile.length > 0) {
        console.log(`\nFRAGILE (${fragile.length}): Avoid - likely overfit`);
        fragile.forEach(r => {
          console.log(`  - zScore=${r.center.zScoreThreshold}, MA=${r.center.movingAverages}, Profit=${r.center.profitPercent}%, Stop=${r.center.stopLossPercent}%`);
        });
      }

      // Export
      const jsonPath = this.exportResults(reports);
      console.log(`\nResults exported to: ${jsonPath}`);

    } catch (error) {
      console.error('Error in grid search:', error);
      throw error;
    } finally {
      // Kill any remaining processes
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
const analyzer = new GridSearchStability();
analyzer.run().catch(console.error);
