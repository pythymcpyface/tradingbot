#!/usr/bin/env ts-node

/**
 * Clear BacktestRuns Table Script
 * 
 * This script removes all entries from the BacktestRuns table only.
 * Note: This will also cascade delete related BacktestOrders and OptimizationResults
 * due to foreign key relationships.
 * 
 * Usage: npx ts-node scripts/clear-backtest-runs.ts
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

class BacktestRunsCleaner {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async initialize(): Promise<void> {
    try {
      await this.prisma.$connect();
      console.log('✅ Connected to database');
    } catch (error) {
      console.error('❌ Database connection failed:', error);
      throw error;
    }
  }

  async clearBacktestRuns(): Promise<void> {
    console.log('🗑️ Clearing BacktestRuns table...');
    console.log('=' .repeat(50));

    try {
      const runsCount = await this.prisma.backtestRuns.count();
      const ordersCount = await this.prisma.backtestOrders.count();
      const optimizationCount = await this.prisma.optimizationResults.count();
      
      console.log(`🏃 Found ${runsCount} backtest runs to delete`);
      console.log(`📈 Found ${ordersCount} related backtest orders that will be cascade deleted`);
      console.log(`📊 Found ${optimizationCount} related optimization results that will be cascade deleted`);

      if (runsCount > 0) {
        console.log('⚠️  WARNING: This will permanently delete ALL backtest runs!');
        console.log('⚠️  This will also delete ALL related backtest orders and optimization results!');
        console.log('⚠️  Press Ctrl+C to cancel, or wait 5 seconds to continue...');
        
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        const result = await this.prisma.backtestRuns.deleteMany({});
        console.log(`✅ Successfully deleted ${result.count} backtest runs`);
        console.log(`✅ Cascade deleted related orders and optimization results`);
      } else {
        console.log('ℹ️  No backtest runs found to delete');
      }

    } catch (error) {
      console.error('❌ Error clearing BacktestRuns:', error);
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
    console.log('🔄 Database connection closed');
  }
}

async function main() {
  const cleaner = new BacktestRunsCleaner();

  try {
    await cleaner.initialize();
    await cleaner.clearBacktestRuns();
    console.log('🎉 BacktestRuns cleanup completed!');
  } catch (error) {
    console.error('\n❌ Cleanup failed:', error);
    process.exit(1);
  } finally {
    await cleaner.cleanup();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { BacktestRunsCleaner };