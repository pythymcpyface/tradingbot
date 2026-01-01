#!/usr/bin/env ts-node

/**
 * Parameter Consistency Analysis
 *
 * Identifies the most reliable parameter sets by analyzing performance
 * consistency across multiple backtest windows.
 *
 * Key metrics:
 * - Consistency Score: mean(alpha) / std(alpha) - higher is better
 * - Window Win Rate: % of windows with positive alpha (beat benchmark)
 * - Worst Window: Minimum alpha across all windows (downside protection)
 *
 * Usage:
 *   npm run analyze:consistency                           # All assets, default settings
 *   npm run analyze:consistency -- --asset ETH            # Filter by base asset
 *   npm run analyze:consistency -- --limit 30             # Show top 30
 *   npm run analyze:consistency -- --minWindows 5         # Require 5+ windows
 *   npm run analyze:consistency -- --sortBy windowWinRate # Sort by win rate
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

config();

interface ConsistencyResult {
  zScoreThreshold: number;
  movingAverages: number;
  profitPercent: number;
  stopLossPercent: number;
  windowCount: number;
  avgAlpha: number;
  stdAlpha: number;
  consistencyScore: number | null;
  worstWindow: number;
  bestWindow: number;
  avgReturn: number;
  avgSharpe: number;
  avgDrawdown: number;
  minTrades: number;
  windowWinRate: number;
  baseAsset?: string;
  quoteAsset?: string;
}

interface CLIOptions {
  asset?: string;
  limit: number;
  minWindows: number;
  sortBy: 'consistencyScore' | 'avgAlpha' | 'windowWinRate' | 'worstWindow';
  minTrades: number;
}

class ParameterConsistencyAnalyzer {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async initialize(): Promise<void> {
    await this.prisma.$connect();
    console.log('Connected to database');
  }

  /**
   * Parse CLI arguments
   */
  parseArgs(): CLIOptions {
    const args = process.argv.slice(2);
    const options: CLIOptions = {
      limit: 50,
      minWindows: 3,
      sortBy: 'consistencyScore',
      minTrades: 5
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      const nextArg = args[i + 1];

      switch (arg) {
        case '--asset':
          options.asset = nextArg?.toUpperCase();
          i++;
          break;
        case '--limit':
          options.limit = parseInt(nextArg) || 50;
          i++;
          break;
        case '--minWindows':
          options.minWindows = parseInt(nextArg) || 3;
          i++;
          break;
        case '--minTrades':
          options.minTrades = parseInt(nextArg) || 5;
          i++;
          break;
        case '--sortBy':
          if (['consistencyScore', 'avgAlpha', 'windowWinRate', 'worstWindow'].includes(nextArg)) {
            options.sortBy = nextArg as CLIOptions['sortBy'];
          }
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
Parameter Consistency Analysis

Usage:
  npx ts-node scripts/analyze-parameter-consistency.ts [options]

Options:
  --asset <SYMBOL>     Filter by base asset (e.g., ETH, BTC)
  --limit <N>          Number of results to show (default: 50)
  --minWindows <N>     Minimum windows required (default: 3)
  --minTrades <N>      Minimum trades per window (default: 5)
  --sortBy <METRIC>    Sort by: consistencyScore, avgAlpha, windowWinRate, worstWindow
  --help, -h           Show this help message

Examples:
  npm run analyze:consistency
  npm run analyze:consistency -- --asset ETH --limit 20
  npm run analyze:consistency -- --sortBy windowWinRate --minWindows 5
`);
  }

  /**
   * Query and calculate consistency metrics
   */
  async analyzeConsistency(options: CLIOptions): Promise<ConsistencyResult[]> {
    const assetFilter = options.asset
      ? Prisma.sql`AND "baseAsset" = ${options.asset}`
      : Prisma.empty;

    // Order by clause based on sortBy option
    let orderByClause: Prisma.Sql;
    switch (options.sortBy) {
      case 'avgAlpha':
        orderByClause = Prisma.sql`ORDER BY AVG("alpha"::float) DESC NULLS LAST`;
        break;
      case 'windowWinRate':
        orderByClause = Prisma.sql`ORDER BY SUM(CASE WHEN "alpha" > 0 THEN 1 ELSE 0 END)::float / COUNT(*) DESC NULLS LAST`;
        break;
      case 'worstWindow':
        orderByClause = Prisma.sql`ORDER BY MIN("alpha"::float) DESC NULLS LAST`;
        break;
      case 'consistencyScore':
      default:
        orderByClause = Prisma.sql`ORDER BY AVG("alpha"::float) / NULLIF(STDDEV("alpha"::float), 0) DESC NULLS LAST`;
        break;
    }

    const results = await this.prisma.$queryRaw<ConsistencyResult[]>`
      SELECT
        "zScoreThreshold"::float as "zScoreThreshold",
        "movingAverages",
        "profitPercent"::float as "profitPercent",
        "stopLossPercent"::float as "stopLossPercent",
        COUNT(*)::int as "windowCount",
        AVG("alpha"::float)::float as "avgAlpha",
        STDDEV("alpha"::float)::float as "stdAlpha",
        (AVG("alpha"::float) / NULLIF(STDDEV("alpha"::float), 0))::float as "consistencyScore",
        MIN("alpha"::float)::float as "worstWindow",
        MAX("alpha"::float)::float as "bestWindow",
        AVG("totalReturn"::float)::float as "avgReturn",
        AVG("sharpeRatio"::float)::float as "avgSharpe",
        AVG("maxDrawdown"::float)::float as "avgDrawdown",
        MIN("totalTrades")::int as "minTrades",
        (SUM(CASE WHEN "alpha" > 0 THEN 1 ELSE 0 END)::float / COUNT(*))::float as "windowWinRate"
      FROM optimization_results
      WHERE "totalTrades" >= ${options.minTrades}
      ${assetFilter}
      GROUP BY "zScoreThreshold", "movingAverages", "profitPercent", "stopLossPercent"
      HAVING COUNT(*) >= ${options.minWindows} AND AVG("alpha"::float) > 0
      ${orderByClause}
      LIMIT ${options.limit}
    `;

    return results;
  }

  /**
   * Get summary statistics
   */
  async getSummaryStats(options: CLIOptions): Promise<{ totalWindows: number; pairs: string[]; dateRange: { min: Date; max: Date } }> {
    const assetFilter = options.asset
      ? Prisma.sql`WHERE "baseAsset" = ${options.asset}`
      : Prisma.empty;

    const stats = await this.prisma.$queryRaw<[{ count: number; minDate: Date; maxDate: Date }]>`
      SELECT
        COUNT(*)::int as count,
        MIN("startTime") as "minDate",
        MAX("endTime") as "maxDate"
      FROM optimization_results
      ${assetFilter}
    `;

    const pairs = await this.prisma.$queryRaw<{ pair: string }[]>`
      SELECT DISTINCT "baseAsset" || '/' || "quoteAsset" as pair
      FROM optimization_results
      ${assetFilter}
    `;

    return {
      totalWindows: stats[0]?.count || 0,
      pairs: pairs.map(p => p.pair),
      dateRange: {
        min: stats[0]?.minDate || new Date(),
        max: stats[0]?.maxDate || new Date()
      }
    };
  }

  /**
   * Format table output
   */
  formatTable(results: ConsistencyResult[]): void {
    // Header
    const header = [
      'Rank'.padStart(4),
      'zScore'.padStart(7),
      'MA'.padStart(4),
      'Profit'.padStart(7),
      'Stop'.padStart(6),
      'Windows'.padStart(7),
      'AvgAlpha'.padStart(10),
      'Consistency'.padStart(11),
      'WinRate'.padStart(8),
      'Worst'.padStart(8),
      'Best'.padStart(8),
      'AvgSharpe'.padStart(10)
    ].join(' | ');

    console.log(header);
    console.log('-'.repeat(header.length));

    // Rows
    results.forEach((r, i) => {
      const row = [
        String(i + 1).padStart(4),
        r.zScoreThreshold.toFixed(2).padStart(7),
        String(r.movingAverages).padStart(4),
        `${r.profitPercent.toFixed(1)}%`.padStart(7),
        `${r.stopLossPercent.toFixed(1)}%`.padStart(6),
        String(r.windowCount).padStart(7),
        `${r.avgAlpha.toFixed(1)}%`.padStart(10),
        (r.consistencyScore?.toFixed(2) || 'N/A').padStart(11),
        `${(r.windowWinRate * 100).toFixed(0)}%`.padStart(8),
        `${r.worstWindow.toFixed(1)}%`.padStart(8),
        `${r.bestWindow.toFixed(1)}%`.padStart(8),
        r.avgSharpe.toFixed(2).padStart(10)
      ].join(' | ');

      console.log(row);
    });
  }

  /**
   * Export results to JSON
   */
  exportToJson(results: ConsistencyResult[], options: CLIOptions): string {
    const analysisDir = path.join(process.cwd(), 'analysis');
    if (!fs.existsSync(analysisDir)) {
      fs.mkdirSync(analysisDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().split('T')[0];
    const assetSuffix = options.asset ? `-${options.asset}` : '';
    const filename = `consistency-report${assetSuffix}-${timestamp}.json`;
    const filepath = path.join(analysisDir, filename);

    const exportData = {
      generatedAt: new Date().toISOString(),
      options,
      results: results.map((r, i) => ({
        rank: i + 1,
        parameters: {
          zScoreThreshold: r.zScoreThreshold,
          movingAverages: r.movingAverages,
          profitPercent: r.profitPercent,
          stopLossPercent: r.stopLossPercent
        },
        consistency: {
          windowCount: r.windowCount,
          avgAlpha: r.avgAlpha,
          stdAlpha: r.stdAlpha,
          consistencyScore: r.consistencyScore,
          windowWinRate: r.windowWinRate,
          worstWindow: r.worstWindow,
          bestWindow: r.bestWindow
        },
        performance: {
          avgReturn: r.avgReturn,
          avgSharpe: r.avgSharpe,
          avgDrawdown: r.avgDrawdown,
          minTrades: r.minTrades
        }
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

      console.log('\n=== Parameter Consistency Analysis ===\n');
      console.log(`Options: sortBy=${options.sortBy}, minWindows=${options.minWindows}, limit=${options.limit}`);
      if (options.asset) {
        console.log(`Filtering by asset: ${options.asset}`);
      }

      // Get summary stats
      const stats = await this.getSummaryStats(options);
      console.log(`\nData: ${stats.totalWindows} total window results`);
      console.log(`Pairs: ${stats.pairs.join(', ')}`);
      console.log(`Date range: ${stats.dateRange.min.toISOString().split('T')[0]} to ${stats.dateRange.max.toISOString().split('T')[0]}`);
      console.log('');

      // Run analysis
      const results = await this.analyzeConsistency(options);

      if (results.length === 0) {
        console.log('No parameter sets found matching the criteria.');
        console.log('Try lowering --minWindows or --minTrades thresholds.');
        return;
      }

      console.log(`Found ${results.length} parameter sets meeting criteria:\n`);

      // Display table
      this.formatTable(results);

      // Export to JSON
      const jsonPath = this.exportToJson(results, options);
      console.log(`\nResults exported to: ${jsonPath}`);

      // Summary insights
      console.log('\n=== Key Insights ===');

      const perfectWinRate = results.filter(r => r.windowWinRate === 1).length;
      console.log(`Parameter sets with 100% window win rate: ${perfectWinRate}`);

      const highConsistency = results.filter(r => (r.consistencyScore || 0) > 2).length;
      console.log(`Parameter sets with consistency score > 2.0: ${highConsistency}`);

      if (results.length > 0) {
        const top = results[0];
        console.log(`\nTop consistent parameters:`);
        console.log(`  zScore: ${top.zScoreThreshold}, MA: ${top.movingAverages}, Profit: ${top.profitPercent}%, Stop: ${top.stopLossPercent}%`);
        console.log(`  Avg Alpha: ${top.avgAlpha.toFixed(2)}%, Consistency: ${top.consistencyScore?.toFixed(2) || 'N/A'}, Win Rate: ${(top.windowWinRate * 100).toFixed(0)}%`);
      }

      console.log('\nAnalysis complete.');

    } catch (error) {
      console.error('Error in analysis:', error);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }
}

// Execute
const analyzer = new ParameterConsistencyAnalyzer();
analyzer.run().catch(console.error);
