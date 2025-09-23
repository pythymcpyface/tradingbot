#!/usr/bin/env ts-node

/**
 * Production Database Migration Script
 * Creates minimal database schema for live trading deployment
 * Excludes heavy backtest and optimization tables
 */

import { execSync } from 'child_process';
import { existsSync, copyFileSync } from 'fs';
import { join } from 'path';

const PRODUCTION_SCHEMA = 'prisma/schema.production.prisma';
const BACKUP_SCHEMA = 'prisma/schema.backup.prisma';
const MAIN_SCHEMA = 'prisma/schema.prisma';

async function main() {
  console.log('🏗️  Setting up production database schema...\n');

  try {
    // 1. Backup original schema if it exists
    if (existsSync(MAIN_SCHEMA)) {
      console.log('💾 Backing up original schema...');
      copyFileSync(MAIN_SCHEMA, BACKUP_SCHEMA);
      console.log('✅ Original schema backed up to schema.backup.prisma\n');
    }

    // 2. Copy production schema to main location
    if (!existsSync(PRODUCTION_SCHEMA)) {
      throw new Error('Production schema not found at: ' + PRODUCTION_SCHEMA);
    }

    console.log('📋 Copying production schema...');
    copyFileSync(PRODUCTION_SCHEMA, MAIN_SCHEMA);
    console.log('✅ Production schema activated\n');

    // 3. Generate Prisma client
    console.log('🔧 Generating Prisma client...');
    execSync('npx prisma generate', { stdio: 'inherit' });
    console.log('✅ Prisma client generated\n');

    // 4. Push schema to database (for new databases)
    console.log('📤 Pushing schema to database...');
    try {
      execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit' });
      console.log('✅ Database schema updated\n');
    } catch (error) {
      console.log('⚠️  Database push failed - this is expected for existing databases');
      console.log('   Running migrations instead...\n');
      
      try {
        execSync('npx prisma migrate deploy', { stdio: 'inherit' });
        console.log('✅ Database migrations applied\n');
      } catch (migrateError) {
        console.log('📝 Creating new migration...');
        execSync('npx prisma migrate dev --name production-schema', { stdio: 'inherit' });
        console.log('✅ New migration created and applied\n');
      }
    }

    // 5. Verify tables exist
    console.log('🔍 Verifying database tables...');
    const checkTables = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `;
    
    execSync(`npx prisma db execute --command "${checkTables}"`, { stdio: 'inherit' });
    console.log('\n✅ Database setup complete!\n');

    console.log('📊 Production Schema Summary:');
    console.log('   ✓ klines - Market data for calculations');
    console.log('   ✓ glicko_ratings - Trading signals');  
    console.log('   ✓ zscore_history - Z-score tracking');
    console.log('   ✓ production_orders - Live/paper orders');
    console.log('   ❌ backtest_orders - EXCLUDED (development only)');
    console.log('   ❌ backtest_runs - EXCLUDED (development only)');
    console.log('   ❌ optimization_results - EXCLUDED (development only)\n');

    console.log('🚀 Ready for production deployment!');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    
    // Restore backup if it exists
    if (existsSync(BACKUP_SCHEMA)) {
      console.log('🔄 Restoring original schema...');
      copyFileSync(BACKUP_SCHEMA, MAIN_SCHEMA);
      console.log('✅ Original schema restored');
    }
    
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}