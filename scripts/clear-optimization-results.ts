#!/usr/bin/env ts-node

/**
 * Clear OptimizationResults Table Script
 * 
 * This script removes all entries from the OptimizationResults table only.
 * 
 * Usage: npx ts-node scripts/clear-optimization-results.ts
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

class OptimizationResultsCleaner {
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

  async clearOptimizationResults(): Promise<void> {
    console.log('🗑️ Clearing OptimizationResults table...');
    console.log('=' .repeat(50));

    try {
      const count = await this.prisma.optimizationResults.count();
      console.log(`📊 Found ${count} optimization results to delete`);

      if (count > 0) {
        console.log('⚠️  WARNING: This will permanently delete ALL optimization results!');
        console.log('⚠️  Press Ctrl+C to cancel, or wait 3 seconds to continue...');
        
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const result = await this.prisma.optimizationResults.deleteMany({});
        console.log(`✅ Successfully deleted ${result.count} optimization results`);
      } else {
        console.log('ℹ️  No optimization results found to delete');
      }

    } catch (error) {
      console.error('❌ Error clearing OptimizationResults:', error);
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
    console.log('🔄 Database connection closed');
  }
}

async function main() {
  const cleaner = new OptimizationResultsCleaner();

  try {
    await cleaner.initialize();
    await cleaner.clearOptimizationResults();
    console.log('🎉 OptimizationResults cleanup completed!');
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

export { OptimizationResultsCleaner };