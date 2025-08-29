#!/usr/bin/env ts-node

/**
 * Clear Klines Table Script
 * 
 * This script removes all entries from the Klines table only.
 * 
 * Usage: npx ts-node scripts/clear-klines.ts
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

class KlinesCleaner {
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

  async clearKlines(): Promise<void> {
    console.log('🗑️ Clearing Klines table...');
    console.log('=' .repeat(50));

    try {
      const count = await this.prisma.klines.count();
      console.log(`📊 Found ${count} klines to delete`);

      if (count > 0) {
        console.log('⚠️  WARNING: This will permanently delete ALL price data (klines)!');
        console.log('⚠️  This will affect backtesting capabilities until price data is reloaded!');
        console.log('⚠️  Press Ctrl+C to cancel, or wait 5 seconds to continue...');
        
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        const result = await this.prisma.klines.deleteMany({});
        console.log(`✅ Successfully deleted ${result.count} klines`);
      } else {
        console.log('ℹ️  No klines found to delete');
      }

    } catch (error) {
      console.error('❌ Error clearing Klines:', error);
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
    console.log('🔄 Database connection closed');
  }
}

async function main() {
  const cleaner = new KlinesCleaner();

  try {
    await cleaner.initialize();
    await cleaner.clearKlines();
    console.log('🎉 Klines cleanup completed!');
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

export { KlinesCleaner };