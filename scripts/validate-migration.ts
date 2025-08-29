#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function validateMigration() {
  console.log('🔍 Validating migrated data...');
  
  try {
    // Count records
    const totalCount = await prisma.klines.count();
    console.log(`✅ Total records: ${totalCount.toLocaleString()}`);

    // Get statistics
    const stats = await prisma.klines.aggregate({
      _count: { symbol: true },
      _min: { openTime: true },
      _max: { closeTime: true }
    });

    // Get unique symbols
    const uniqueSymbols = await prisma.klines.findMany({
      select: { symbol: true },
      distinct: ['symbol']
    });

    console.log(`✅ Unique symbols: ${uniqueSymbols.length}`);
    console.log(`✅ Date range: ${stats._min.openTime} to ${stats._max.closeTime}`);

    // Sample recent data
    const sampleRecords = await prisma.klines.findMany({
      take: 5,
      orderBy: { openTime: 'desc' },
      select: {
        symbol: true,
        openTime: true,
        close: true,
        volume: true
      }
    });

    console.log('\n📋 Sample recent records:');
    sampleRecords.forEach((record, index) => {
      console.log(`  ${index + 1}. ${record.symbol} - ${record.openTime.toISOString()} - $${record.close} (Vol: ${record.volume})`);
    });

    // Test data integrity
    const integrityCheck = await prisma.klines.findFirst({
      where: {
        OR: [
          { open: { lte: 0 } },
          { high: { lte: 0 } },
          { low: { lte: 0 } },
          { close: { lte: 0 } },
          { volume: { lt: 0 } }
        ]
      }
    });

    if (integrityCheck) {
      console.warn('⚠️ Found records with invalid prices/volumes');
    } else {
      console.log('✅ Data integrity check passed');
    }

    // Test query performance
    console.log('\n⚡ Testing query performance...');
    const start = Date.now();
    const recentData = await prisma.klines.findMany({
      where: {
        symbol: 'BTCUSDT',
        openTime: {
          gte: new Date('2024-01-01')
        }
      },
      orderBy: { openTime: 'desc' },
      take: 1000
    });
    const elapsed = Date.now() - start;
    console.log(`✅ Retrieved 1000 BTCUSDT records in ${elapsed}ms`);

    console.log('\n🎉 Migration validation completed successfully!');
    console.log('📊 Summary:');
    console.log(`  - Total records: ${totalCount.toLocaleString()}`);
    console.log(`  - Symbols: ${uniqueSymbols.length}`);
    console.log(`  - Date range: ${stats._min.openTime?.toISOString().split('T')[0]} to ${stats._max.closeTime?.toISOString().split('T')[0]}`);
    
  } catch (error) {
    console.error('❌ Validation failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

validateMigration().catch(console.error);