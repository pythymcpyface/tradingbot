#!/usr/bin/env ts-node

/**
 * Clear Database Script
 * 
 * This script removes all entries from all tables in the database.
 * It respects foreign key constraints by deleting in the correct order.
 * 
 * Usage: npx ts-node scripts/clear-database.ts
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

class DatabaseCleaner {
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

  /**
   * Clear all database tables in the correct order to respect foreign key constraints
   */
  async clearAllTables(): Promise<void> {
    console.log('🗑️ Starting database cleanup...');
    console.log('=' .repeat(50));

    try {
      // Delete in order to respect foreign key constraints
      // Child tables first, then parent tables

      console.log('📊 Clearing OptimizationResults...');
      const optimizationCount = await this.prisma.optimizationResults.deleteMany({});
      console.log(`   ✅ Deleted ${optimizationCount.count} optimization results`);

      console.log('📈 Clearing BacktestOrders...');
      const ordersCount = await this.prisma.backtestOrders.deleteMany({});
      console.log(`   ✅ Deleted ${ordersCount.count} backtest orders`);

      console.log('🏃 Clearing BacktestRuns...');
      const runsCount = await this.prisma.backtestRuns.deleteMany({});
      console.log(`   ✅ Deleted ${runsCount.count} backtest runs`);

      console.log('💰 Clearing ProductionOrders...');
      const productionCount = await this.prisma.productionOrders.deleteMany({});
      console.log(`   ✅ Deleted ${productionCount.count} production orders`);

      console.log('⭐ Clearing GlickoRatings...');
      const ratingsCount = await this.prisma.glickoRatings.deleteMany({});
      console.log(`   ✅ Deleted ${ratingsCount.count} Glicko ratings`);

      console.log('📊 Clearing Klines...');
      const klinesCount = await this.prisma.klines.deleteMany({});
      console.log(`   ✅ Deleted ${klinesCount.count} klines`);

      console.log('\n🎉 Database cleanup completed successfully!');
      console.log(`📈 Summary:`);
      console.log(`   - OptimizationResults: ${optimizationCount.count} deleted`);
      console.log(`   - BacktestOrders: ${ordersCount.count} deleted`);
      console.log(`   - BacktestRuns: ${runsCount.count} deleted`);
      console.log(`   - ProductionOrders: ${productionCount.count} deleted`);
      console.log(`   - GlickoRatings: ${ratingsCount.count} deleted`);
      console.log(`   - Klines: ${klinesCount.count} deleted`);

    } catch (error) {
      console.error('❌ Error during database cleanup:', error);
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
    console.log('🔄 Database connection closed');
  }
}

/**
 * Main execution function
 */
async function main() {
  const cleaner = new DatabaseCleaner();

  try {
    await cleaner.initialize();
    
    // Confirm deletion with user
    console.log('⚠️  WARNING: This will permanently delete ALL data from ALL tables!');
    console.log('⚠️  This action cannot be undone!');
    console.log('⚠️  Press Ctrl+C to cancel, or wait 5 seconds to continue...');
    
    // 5 second delay to allow user to cancel
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    await cleaner.clearAllTables();
    
  } catch (error) {
    console.error('\n❌ Database cleanup failed:', error);
    process.exit(1);
  } finally {
    await cleaner.cleanup();
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { DatabaseCleaner };