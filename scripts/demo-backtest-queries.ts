#!/usr/bin/env ts-node

/**
 * Demo: Backtest Query Patterns
 * 
 * This script demonstrates various ways to query backtest data by parameter sets,
 * dates, and performance metrics. It serves as practical examples for the 
 * BACKTEST_QUERY_GUIDE.md documentation.
 * 
 * Usage:
 *   npx ts-node scripts/demo-backtest-queries.ts
 */

import { PrismaClient, OrderSide, ExitReason } from '@prisma/client';
import { config } from 'dotenv';

config();

interface BacktestQueryParams {
  baseAsset?: string;
  quoteAsset?: string;
  zScoreThreshold?: { min?: number; max?: number };
  profitPercent?: { min?: number; max?: number };
  stopLossPercent?: { min?: number; max?: number };
  movingAverages?: number | number[];
  dateRange?: { start: Date; end: Date };
  minTotalReturn?: number;
  minSharpeRatio?: number;
  minWinRatio?: number;
  limit?: number;
  offset?: number;
}

class BacktestQueryDemo {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async initialize(): Promise<void> {
    await this.prisma.$connect();
    console.log('✅ Connected to database');
  }

  /**
   * Demo 1: Query by specific parameter set
   */
  async demoSpecificParameterQuery(): Promise<void> {
    console.log('\n🎯 Demo 1: Query by Specific Parameter Set');
    console.log('=' .repeat(60));
    
    const results = await this.prisma.optimizationResults.findMany({
      where: {
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        zScoreThreshold: 2.0,
        profitPercent: 1.5,
        stopLossPercent: 2.0,
        movingAverages: 20
      },
      include: {
        backtestRun: {
          include: {
            orders: {
              take: 5,  // Just show first 5 orders
              orderBy: { timestamp: 'asc' }
            }
          }
        }
      },
      orderBy: { totalReturn: 'desc' },
      take: 3
    });

    console.log(`Found ${results.length} results for BTC/USDT with parameters:`);
    console.log('- Z-Score: 2.0, Profit: 1.5%, Stop: 2.0%, MA: 20\n');

    results.forEach((result, index) => {
      console.log(`${index + 1}. Run ID: ${result.runId}`);
      console.log(`   Performance: ${Number(result.totalReturn).toFixed(2)}% return, ` +
                  `${Number(result.sharpeRatio).toFixed(2)} Sharpe, ` +
                  `${result.totalTrades} trades`);
      console.log(`   Period: ${result.startTime.toISOString().split('T')[0]} to ` +
                  `${result.endTime.toISOString().split('T')[0]}`);
      console.log(`   Sample Orders: ${result.backtestRun.orders.length} shown (of total)`);
      result.backtestRun.orders.slice(0, 3).forEach((order, orderIndex) => {
        console.log(`     ${orderIndex + 1}. ${order.side} ${Number(order.quantity).toFixed(4)} @ ` +
                    `${Number(order.price).toFixed(2)} (${order.reason})`);
      });
      console.log();
    });
  }

  /**
   * Demo 2: Query by parameter ranges
   */
  async demoParameterRangeQuery(): Promise<void> {
    console.log('\n📊 Demo 2: Query by Parameter Ranges');
    console.log('=' .repeat(60));
    
    const results = await this.prisma.optimizationResults.findMany({
      where: {
        baseAsset: 'ETH',
        zScoreThreshold: { gte: 1.5, lte: 2.5 },
        profitPercent: { gte: 1.0, lte: 2.0 },
        totalReturn: { gte: 5.0 },  // At least 5% return
        totalTrades: { gte: 10 }    // At least 10 trades
      },
      select: {
        runId: true,
        baseAsset: true,
        quoteAsset: true,
        zScoreThreshold: true,
        profitPercent: true,
        stopLossPercent: true,
        movingAverages: true,
        totalReturn: true,
        sharpeRatio: true,
        winRatio: true,
        totalTrades: true
      },
      orderBy: { totalReturn: 'desc' },
      take: 5
    });

    console.log(`Found ${results.length} ETH strategies with 5%+ returns:`);
    console.log('Z-Score: 1.5-2.5, Profit: 1.0-2.0%, Min 10 trades\n');

    results.forEach((result, index) => {
      console.log(`${index + 1}. ${result.baseAsset}/${result.quoteAsset} - ${Number(result.totalReturn).toFixed(2)}% return`);
      console.log(`   Parameters: Z=${Number(result.zScoreThreshold)}, P=${Number(result.profitPercent)}%, ` +
                  `S=${Number(result.stopLossPercent)}%, MA=${result.movingAverages}`);
      console.log(`   Metrics: Sharpe=${Number(result.sharpeRatio).toFixed(2)}, ` +
                  `Win Rate=${(Number(result.winRatio) * 100).toFixed(1)}%, ` +
                  `Trades=${result.totalTrades}`);
      console.log();
    });
  }

  /**
   * Demo 3: Query by date range
   */
  async demoDateRangeQuery(): Promise<void> {
    console.log('\n📅 Demo 3: Query by Date Range');
    console.log('=' .repeat(60));
    
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const results = await this.prisma.backtestRuns.findMany({
      where: {
        createdAt: { gte: sixMonthsAgo },  // Created in last 6 months
        baseAsset: { in: ['BTC', 'ETH', 'SOL'] }
      },
      include: {
        optimizationResults: {
          select: {
            totalReturn: true,
            sharpeRatio: true,
            totalTrades: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    console.log(`Found ${results.length} backtest runs created in the last 6 months:`);
    console.log(`(Assets: BTC, ETH, SOL)\n`);

    results.forEach((run, index) => {
      const performance = run.optimizationResults[0];
      console.log(`${index + 1}. ${run.baseAsset}/${run.quoteAsset} - Created ${run.createdAt.toDateString()}`);
      console.log(`   Parameters: Z=${Number(run.zScoreThreshold)}, P=${Number(run.profitPercent)}%, ` +
                  `S=${Number(run.stopLossPercent)}%, MA=${run.movingAverages}`);
      console.log(`   Backtest Period: ${run.startTime.toISOString().split('T')[0]} to ` +
                  `${run.endTime.toISOString().split('T')[0]}`);
      if (performance) {
        console.log(`   Performance: ${Number(performance.totalReturn).toFixed(2)}% return, ` +
                    `${Number(performance.sharpeRatio).toFixed(2)} Sharpe, ${performance.totalTrades} trades`);
      }
      console.log();
    });
  }

  /**
   * Demo 4: Get all trades for a specific backtest run
   */
  async demoGetTradesForRun(): Promise<void> {
    console.log('\n🔍 Demo 4: Get All Trades for Specific Run');
    console.log('=' .repeat(60));
    
    // First, find a run with some trades
    const runWithTrades = await this.prisma.backtestRuns.findFirst({
      include: {
        orders: true,
        optimizationResults: true
      },
      where: {
        orders: {
          some: {}  // Has at least one order
        }
      }
    });

    if (!runWithTrades) {
      console.log('No backtest runs with orders found.');
      return;
    }

    console.log(`Analyzing Run ID: ${runWithTrades.id}`);
    console.log(`Asset Pair: ${runWithTrades.baseAsset}/${runWithTrades.quoteAsset}`);
    console.log(`Parameters: Z=${Number(runWithTrades.zScoreThreshold)}, ` +
                `P=${Number(runWithTrades.profitPercent)}%, ` +
                `S=${Number(runWithTrades.stopLossPercent)}%, ` +
                `MA=${runWithTrades.movingAverages}`);
    
    if (runWithTrades.optimizationResults[0]) {
      const perf = runWithTrades.optimizationResults[0];
      console.log(`Performance: ${Number(perf.totalReturn).toFixed(2)}% return, ` +
                  `${Number(perf.sharpeRatio).toFixed(2)} Sharpe ratio`);
    }
    
    console.log(`\nFirst 10 trades (of ${runWithTrades.orders.length} total):`);
    console.log('Time                | Side | Price    | Qty      | Reason      | P&L      | P&L%');
    console.log('-' .repeat(85));

    runWithTrades.orders
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .slice(0, 10)
      .forEach(order => {
        const time = order.timestamp.toISOString().replace('T', ' ').slice(0, 19);
        const price = Number(order.price).toFixed(2).padStart(8);
        const qty = Number(order.quantity).toFixed(4).padStart(8);
        const pnl = order.profitLoss ? Number(order.profitLoss).toFixed(2).padStart(8) : '    -   ';
        const pnlPct = order.profitLossPercent ? Number(order.profitLossPercent).toFixed(2).padStart(5) + '%' : '     ';
        
        console.log(`${time} | ${order.side.padEnd(4)} | ${price} | ${qty} | ` +
                    `${order.reason.padEnd(11)} | ${pnl} | ${pnlPct}`);
      });
  }

  /**
   * Demo 5: Advanced filtering - find best parameter combinations
   */
  async demoBestParameterCombinations(): Promise<void> {
    console.log('\n🏆 Demo 5: Best Parameter Combinations');
    console.log('=' .repeat(60));
    
    const results = await this.prisma.optimizationResults.findMany({
      where: {
        AND: [
          { totalReturn: { gte: 5.0 } },      // At least 5% return
          { sharpeRatio: { gte: 1.0 } },      // Sharpe >= 1.0
          { totalTrades: { gte: 15 } },       // At least 15 trades
          { maxDrawdown: { gte: -20.0 } },    // Max drawdown <= 20%
          { winRatio: { gte: 0.5 } }          // Win rate >= 50%
        ]
      },
      select: {
        baseAsset: true,
        quoteAsset: true,
        zScoreThreshold: true,
        profitPercent: true,
        stopLossPercent: true,
        movingAverages: true,
        totalReturn: true,
        sharpeRatio: true,
        maxDrawdown: true,
        winRatio: true,
        totalTrades: true,
        calmarRatio: true
      },
      orderBy: [
        { totalReturn: 'desc' },
        { sharpeRatio: 'desc' }
      ],
      take: 8
    });

    console.log(`Found ${results.length} high-quality parameter combinations:`);
    console.log('Criteria: 5%+ return, 1.0+ Sharpe, 15+ trades, -20% max drawdown, 50%+ win rate\n');

    console.log('Pair     | Parameters (Z/P/S/MA) | Return | Sharpe | MaxDD  | WinRate | Trades | Calmar');
    console.log('-' .repeat(95));

    results.forEach(result => {
      const pair = `${result.baseAsset}/${result.quoteAsset}`.padEnd(8);
      const params = `${Number(result.zScoreThreshold)}/${Number(result.profitPercent)}/${Number(result.stopLossPercent)}/${result.movingAverages}`.padEnd(13);
      const totalReturn = (Number(result.totalReturn).toFixed(1) + '%').padStart(6);
      const sharpe = Number(result.sharpeRatio).toFixed(2).padStart(6);
      const maxDD = (Number(result.maxDrawdown).toFixed(1) + '%').padStart(6);
      const winRate = (Number(result.winRatio) * 100).toFixed(1) + '%';
      const trades = result.totalTrades.toString().padStart(6);
      const calmar = result.calmarRatio ? Number(result.calmarRatio).toFixed(2).padStart(6) : '   -  ';

      console.log(`${pair} | ${params} | ${totalReturn} | ${sharpe} | ${maxDD} | ${winRate.padStart(7)} | ${trades} | ${calmar}`);
    });
  }

  /**
   * Demo 6: Asset comparison - same parameters across different assets
   */
  async demoAssetComparison(): Promise<void> {
    console.log('\n⚖️  Demo 6: Asset Comparison (Same Parameters)');
    console.log('=' .repeat(60));
    
    // Find a parameter set that exists for multiple assets
    const commonParams = {
      zScoreThreshold: 2.0,
      profitPercent: 1.5,
      stopLossPercent: 2.0,
      movingAverages: 20
    };

    const results = await this.prisma.optimizationResults.findMany({
      where: {
        ...commonParams,
        quoteAsset: 'USDT',
        totalTrades: { gte: 5 }
      },
      select: {
        baseAsset: true,
        totalReturn: true,
        sharpeRatio: true,
        maxDrawdown: true,
        winRatio: true,
        totalTrades: true,
        startTime: true,
        endTime: true
      },
      orderBy: { totalReturn: 'desc' }
    });

    console.log(`Comparing assets with identical parameters:`);
    console.log(`Z-Score: ${commonParams.zScoreThreshold}, Profit: ${commonParams.profitPercent}%, ` +
                `Stop: ${commonParams.stopLossPercent}%, MA: ${commonParams.movingAverages}\n`);

    if (results.length === 0) {
      console.log('No results found with these parameters.');
      return;
    }

    console.log('Asset | Return | Sharpe | MaxDD  | WinRate | Trades | Test Period');
    console.log('-' .repeat(75));

    results.forEach(result => {
      const asset = result.baseAsset.padEnd(5);
      const totalReturn = (Number(result.totalReturn).toFixed(1) + '%').padStart(6);
      const sharpe = Number(result.sharpeRatio).toFixed(2).padStart(6);
      const maxDD = (Number(result.maxDrawdown).toFixed(1) + '%').padStart(6);
      const winRate = (Number(result.winRatio) * 100).toFixed(1) + '%';
      const trades = result.totalTrades.toString().padStart(6);
      const period = `${result.startTime.toISOString().split('T')[0]} to ${result.endTime.toISOString().split('T')[0]}`;

      console.log(`${asset} | ${totalReturn} | ${sharpe} | ${maxDD} | ${winRate.padStart(7)} | ${trades} | ${period}`);
    });
  }

  /**
   * Main demo execution
   */
  async runAllDemos(): Promise<void> {
    try {
      await this.initialize();

      await this.demoSpecificParameterQuery();
      await this.demoParameterRangeQuery();
      await this.demoDateRangeQuery();
      await this.demoGetTradesForRun();
      await this.demoBestParameterCombinations();
      await this.demoAssetComparison();

      console.log('\n✅ All demos completed successfully!');
      console.log('\nThese examples demonstrate the query patterns documented in:');
      console.log('📖 docs/BACKTEST_QUERY_GUIDE.md');

    } catch (error) {
      console.error('\n❌ Demo failed:', error);
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
    console.log('\n🧹 Database connection closed');
  }
}

/**
 * Main execution function
 */
async function main() {
  const demo = new BacktestQueryDemo();

  try {
    await demo.runAllDemos();
  } catch (error) {
    console.error('Demo execution failed:', error);
    process.exit(1);
  } finally {
    await demo.cleanup();
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { BacktestQueryDemo };