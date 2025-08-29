#!/usr/bin/env ts-node

/**
 * Clear GlickoRatings Table Script
 * 
 * This script removes all entries from the GlickoRatings table only.
 * 
 * Usage: npx ts-node scripts/clear-glicko-ratings.ts
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

class GlickoRatingsCleaner {
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

  async clearGlickoRatings(): Promise<void> {
    console.log('🗑️ Clearing GlickoRatings table...');
    console.log('=' .repeat(50));

    try {
      const count = await this.prisma.glickoRatings.count();
      console.log(`⭐ Found ${count} Glicko ratings to delete`);

      if (count > 0) {
        console.log('⚠️  WARNING: This will permanently delete ALL Glicko ratings!');
        console.log('⚠️  This will affect backtesting capabilities until ratings are regenerated!');
        console.log('⚠️  Press Ctrl+C to cancel, or wait 5 seconds to continue...');
        
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        const result = await this.prisma.glickoRatings.deleteMany({});
        console.log(`✅ Successfully deleted ${result.count} Glicko ratings`);
      } else {
        console.log('ℹ️  No Glicko ratings found to delete');
      }

    } catch (error) {
      console.error('❌ Error clearing GlickoRatings:', error);
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
    console.log('🔄 Database connection closed');
  }
}

async function main() {
  const cleaner = new GlickoRatingsCleaner();

  try {
    await cleaner.initialize();
    await cleaner.clearGlickoRatings();
    console.log('🎉 GlickoRatings cleanup completed!');
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

export { GlickoRatingsCleaner };