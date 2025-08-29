#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Adds unique constraints to prevent future duplicate parameter sets
 */
async function addUniqueConstraints(): Promise<void> {
  console.log('🔧 Adding unique constraints to prevent future duplicates...');

  try {
    // Add unique constraint to BacktestRuns for parameter combinations
    await prisma.$executeRaw`
      ALTER TABLE "BacktestRuns" 
      ADD CONSTRAINT unique_parameter_set 
      UNIQUE (
        "baseAsset", 
        "quoteAsset", 
        "zScoreThreshold", 
        "movingAverages", 
        "profitPercent", 
        "stopLossPercent", 
        "startTime", 
        "endTime", 
        COALESCE("windowSize", 12)
      );
    `;

    console.log('✅ Added unique constraint to BacktestRuns table');

    // Add partial unique index for cases where windowSize is NULL
    await prisma.$executeRaw`
      CREATE UNIQUE INDEX unique_parameter_set_null_window
      ON "BacktestRuns" (
        "baseAsset", 
        "quoteAsset", 
        "zScoreThreshold", 
        "movingAverages", 
        "profitPercent", 
        "stopLossPercent", 
        "startTime", 
        "endTime"
      )
      WHERE "windowSize" IS NULL;
    `;

    console.log('✅ Added partial unique index for NULL windowSize cases');

    console.log('\n📋 Database constraints summary:');
    console.log('   • Unique constraint on BacktestRuns parameter combinations');
    console.log('   • Partial unique index for NULL windowSize cases');
    console.log('   • Future duplicate parameter sets will be prevented');

  } catch (error: any) {
    if (error.code === '23505' || error.message.includes('already exists')) {
      console.log('⚠️  Unique constraints already exist, skipping...');
    } else {
      console.error('❌ Error adding unique constraints:', error);
      throw error;
    }
  }
}

async function main(): Promise<void> {
  try {
    await addUniqueConstraints();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}

export { addUniqueConstraints };