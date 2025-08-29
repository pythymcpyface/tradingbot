#!/usr/bin/env ts-node

/**
 * Clear ProductionOrders Table Script
 * 
 * This script removes all entries from the ProductionOrders table only.
 * 
 * Usage: npx ts-node scripts/clear-production-orders.ts
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

class ProductionOrdersCleaner {
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

  async clearProductionOrders(): Promise<void> {
    console.log('🗑️ Clearing ProductionOrders table...');
    console.log('=' .repeat(50));

    try {
      const count = await this.prisma.productionOrders.count();
      console.log(`💰 Found ${count} production orders to delete`);

      if (count > 0) {
        console.log('⚠️  WARNING: This will permanently delete ALL production orders!');
        console.log('⚠️  This affects REAL trading data - proceed with caution!');
        console.log('⚠️  Press Ctrl+C to cancel, or wait 5 seconds to continue...');
        
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        const result = await this.prisma.productionOrders.deleteMany({});
        console.log(`✅ Successfully deleted ${result.count} production orders`);
      } else {
        console.log('ℹ️  No production orders found to delete');
      }

    } catch (error) {
      console.error('❌ Error clearing ProductionOrders:', error);
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
    console.log('🔄 Database connection closed');
  }
}

async function main() {
  const cleaner = new ProductionOrdersCleaner();

  try {
    await cleaner.initialize();
    await cleaner.clearProductionOrders();
    console.log('🎉 ProductionOrders cleanup completed!');
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

export { ProductionOrdersCleaner };