#!/usr/bin/env ts-node

/**
 * Clear BacktestOrders Table Script
 * 
 * This script removes all entries from the BacktestOrders table only.
 * 
 * Usage: npx ts-node scripts/clear-backtest-orders.ts
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

class BacktestOrdersCleaner {
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

  async clearBacktestOrders(): Promise<void> {
    console.log('🗑️ Clearing BacktestOrders table...');
    console.log('=' .repeat(50));

    try {
      const count = await this.prisma.backtestOrders.count();
      console.log(`📈 Found ${count} backtest orders to delete`);

      if (count > 0) {
        console.log('⚠️  WARNING: This will permanently delete ALL backtest orders!');
        console.log('⚠️  Press Ctrl+C to cancel, or wait 3 seconds to continue...');
        
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const result = await this.prisma.backtestOrders.deleteMany({});
        console.log(`✅ Successfully deleted ${result.count} backtest orders`);
      } else {
        console.log('ℹ️  No backtest orders found to delete');
      }

    } catch (error) {
      console.error('❌ Error clearing BacktestOrders:', error);
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
    console.log('🔄 Database connection closed');
  }
}

async function main() {
  const cleaner = new BacktestOrdersCleaner();

  try {
    await cleaner.initialize();
    await cleaner.clearBacktestOrders();
    console.log('🎉 BacktestOrders cleanup completed!');
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

export { BacktestOrdersCleaner };