#!/usr/bin/env ts-node

/**
 * Database Migration Script
 * 
 * This script migrates klines data from an existing PostgreSQL database
 * to the new trading bot database instance.
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { Client } from 'pg';

// Load environment variables
config();

interface OldKlineRecord {
  symbol: string;
  open_time: Date;
  close_time: Date;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  volume: string | number;
  quote_asset_volume: string | number;
  number_of_trades: number;
  taker_buy_base_asset_volume: string | number;
  taker_buy_quote_asset_volume: string | number;
  ignore: string | number;
}

class DatabaseMigrator {
  private newDb: PrismaClient;
  private oldDb: Client;
  
  constructor() {
    this.newDb = new PrismaClient();
    
    // Connect to old database
    this.oldDb = new Client({
      connectionString: process.env.OLD_DATABASE_URL
    });
  }

  async initialize(): Promise<void> {
    try {
      console.log('🔄 Connecting to databases...');
      
      // Connect to old database
      await this.oldDb.connect();
      console.log('✅ Connected to old database');
      
      // Test new database connection
      await this.newDb.$connect();
      console.log('✅ Connected to new database');
      
    } catch (error) {
      console.error('❌ Database connection failed:', error);
      throw error;
    }
  }

  async analyzeOldDatabase(): Promise<{
    totalRecords: number;
    symbols: string[];
    dateRange: { earliest: Date; latest: Date };
    tableStructure: any;
  }> {
    console.log('🔍 Analyzing old database structure...');
    
    try {
      // Get table structure - try common table names
      const possibleTableNames = ['klines', 'kline', 'candles', 'ohlcv', 'market_data'];
      let tableName = '';
      let tableStructure: any = null;
      
      for (const name of possibleTableNames) {
        try {
          const result = await this.oldDb.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = $1
            ORDER BY ordinal_position
          `, [name]);
          
          if (result.rows.length > 0) {
            tableName = name;
            tableStructure = result.rows;
            break;
          }
        } catch (error) {
          // Table doesn't exist, continue
          continue;
        }
      }
      
      if (!tableName) {
        throw new Error('Could not find klines table. Please specify the correct table name.');
      }
      
      console.log(`📊 Found table: ${tableName}`);
      console.log('Table structure:', tableStructure);
      
      // Get basic statistics
      const statsResult = await this.oldDb.query(`
        SELECT 
          COUNT(*) as total_records,
          COUNT(DISTINCT symbol) as unique_symbols,
          MIN(open_time) as earliest_date,
          MAX(close_time) as latest_date
        FROM ${tableName}
      `);
      
      const stats = statsResult.rows[0];
      
      // Get all unique symbols
      const symbolsResult = await this.oldDb.query(`
        SELECT DISTINCT symbol 
        FROM ${tableName} 
        ORDER BY symbol
      `);
      
      const symbols = symbolsResult.rows.map(row => row.symbol);
      
      const analysis = {
        totalRecords: parseInt(stats.total_records),
        symbols: symbols,
        dateRange: {
          earliest: new Date(stats.earliest_date),
          latest: new Date(stats.latest_date)
        },
        tableStructure: tableStructure
      };
      
      console.log('📈 Database Analysis:');
      console.log(`  - Total records: ${analysis.totalRecords.toLocaleString()}`);
      console.log(`  - Unique symbols: ${analysis.symbols.length}`);
      console.log(`  - Date range: ${analysis.dateRange.earliest.toISOString()} to ${analysis.dateRange.latest.toISOString()}`);
      console.log(`  - Symbols: ${symbols.slice(0, 10).join(', ')}${symbols.length > 10 ? '...' : ''}`);
      
      return analysis;
      
    } catch (error) {
      console.error('❌ Error analyzing old database:', error);
      throw error;
    }
  }

  async migrateKlinesData(
    tableName: string = 'klines',
    batchSize: number = 10000,
    targetSymbols?: string[]
  ): Promise<void> {
    console.log('🚀 Starting klines data migration...');
    
    try {
      // Build WHERE clause for symbol filtering
      let whereClause = '';
      let queryParams: any[] = [];
      
      if (targetSymbols && targetSymbols.length > 0) {
        whereClause = `WHERE symbol = ANY($1)`;
        queryParams = [targetSymbols];
      }
      
      // Get total count for progress tracking
      const countResult = await this.oldDb.query(`
        SELECT COUNT(*) as total 
        FROM ${tableName} ${whereClause}
      `, queryParams);
      
      const totalRecords = parseInt(countResult.rows[0].total);
      console.log(`📊 Total records to migrate: ${totalRecords.toLocaleString()}`);
      
      let offset = 0;
      let migratedCount = 0;
      let errorCount = 0;
      
      while (offset < totalRecords) {
        const startTime = Date.now();
        
        // Fetch batch from old database
        const batchResult = await this.oldDb.query(`
          SELECT 
            symbol,
            open_time,
            close_time,
            open,
            high,
            low,
            close,
            volume,
            quote_asset_volume,
            number_of_trades,
            taker_buy_base_asset_volume,
            taker_buy_quote_asset_volume,
            ignore
          FROM ${tableName}
          ${whereClause}
          ORDER BY symbol, open_time
          LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
        `, [...queryParams, batchSize, offset]);
        
        if (batchResult.rows.length === 0) {
          break;
        }
        
        // Transform and validate data
        const transformedData = batchResult.rows.map((row: OldKlineRecord) => ({
          symbol: row.symbol,
          openTime: new Date(row.open_time),
          closeTime: new Date(row.close_time),
          open: parseFloat(row.open.toString()),
          high: parseFloat(row.high.toString()),
          low: parseFloat(row.low.toString()),
          close: parseFloat(row.close.toString()),
          volume: parseFloat(row.volume.toString()),
          quoteAssetVolume: parseFloat(row.quote_asset_volume.toString()),
          numberOfTrades: row.number_of_trades,
          takerBuyBaseAssetVolume: parseFloat(row.taker_buy_base_asset_volume.toString()),
          takerBuyQuoteAssetVolume: parseFloat(row.taker_buy_quote_asset_volume.toString()),
          ignore: parseFloat(row.ignore.toString())
        }));
        
        // Insert batch into new database
        try {
          const result = await this.newDb.klines.createMany({
            data: transformedData,
            skipDuplicates: true
          });
          
          migratedCount += result.count;
          offset += batchResult.rows.length;
          
          const elapsed = Date.now() - startTime;
          const progress = (offset / totalRecords * 100).toFixed(1);
          const rate = Math.round(batchResult.rows.length / (elapsed / 1000));
          
          console.log(`📈 Progress: ${progress}% (${migratedCount.toLocaleString()}/${totalRecords.toLocaleString()}) - ${rate} records/sec`);
          
        } catch (error) {
          console.error(`❌ Error migrating batch at offset ${offset}:`, error);
          errorCount += batchResult.rows.length;
          offset += batchResult.rows.length;
        }
      }
      
      console.log('✅ Klines migration completed!');
      console.log(`📊 Summary:`);
      console.log(`  - Total processed: ${offset.toLocaleString()}`);
      console.log(`  - Successfully migrated: ${migratedCount.toLocaleString()}`);
      console.log(`  - Errors: ${errorCount.toLocaleString()}`);
      
    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    }
  }

  async validateMigration(): Promise<boolean> {
    console.log('🔍 Validating migrated data...');
    
    try {
      // Count records in new database
      const newCount = await this.newDb.klines.count();
      
      // Get sample statistics
      const stats = await this.newDb.klines.aggregate({
        _count: { symbol: true },
        _min: { openTime: true },
        _max: { closeTime: true }
      });
      
      const uniqueSymbols = await this.newDb.klines.findMany({
        select: { symbol: true },
        distinct: ['symbol']
      });
      
      console.log('✅ Migration validation:');
      console.log(`  - Total records: ${newCount.toLocaleString()}`);
      console.log(`  - Unique symbols: ${uniqueSymbols.length}`);
      console.log(`  - Date range: ${stats._min.openTime} to ${stats._max.closeTime}`);
      
      // Sample data quality check
      const sampleRecords = await this.newDb.klines.findMany({
        take: 5,
        orderBy: { openTime: 'desc' }
      });
      
      console.log('📋 Sample records:');
      sampleRecords.forEach((record, index) => {
        console.log(`  ${index + 1}. ${record.symbol} - ${record.openTime.toISOString()} - $${record.close}`);
      });
      
      return newCount > 0;
      
    } catch (error) {
      console.error('❌ Validation failed:', error);
      return false;
    }
  }

  async createIndexes(): Promise<void> {
    console.log('🔧 Creating database indexes for performance...');
    
    try {
      // The Prisma schema already includes @@index directives, but we can create additional ones
      await this.newDb.$executeRaw`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_klines_symbol_opentime_covering 
        ON "klines" (symbol, "openTime") 
        INCLUDE ("close", "volume", "takerBuyBaseAssetVolume");
      `;
      
      await this.newDb.$executeRaw`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_klines_opentime_desc 
        ON "klines" ("openTime" DESC);
      `;
      
      console.log('✅ Indexes created successfully');
      
    } catch (error) {
      console.error('⚠️ Some indexes may already exist or failed to create:', error);
    }
  }

  async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up connections...');
    
    try {
      await this.newDb.$disconnect();
      await this.oldDb.end();
      console.log('✅ Cleanup completed');
    } catch (error) {
      console.error('⚠️ Cleanup warning:', error);
    }
  }
}

// Main migration function
async function main() {
  const migrator = new DatabaseMigrator();
  
  try {
    console.log('🚀 Starting database migration process...');
    console.log('=' .repeat(50));
    
    await migrator.initialize();
    
    const analysis = await migrator.analyzeOldDatabase();
    
    // Prompt user to continue
    console.log('\n⚠️  Ready to migrate data. This process may take several minutes to hours depending on data size.');
    console.log('Press Ctrl+C to cancel or wait 5 seconds to continue...\n');
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Start migration
    await migrator.migrateKlinesData('klines', 10000);
    
    // Validate migration
    const isValid = await migrator.validateMigration();
    
    if (isValid) {
      await migrator.createIndexes();
      console.log('\n🎉 Migration completed successfully!');
      console.log('You can now stop your old database instance and start using the new one.');
    } else {
      console.log('\n❌ Migration validation failed. Please check the logs and try again.');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n💥 Migration failed with error:', error);
    process.exit(1);
  } finally {
    await migrator.cleanup();
  }
}

// Run migration if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { DatabaseMigrator };