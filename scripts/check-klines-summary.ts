#!/usr/bin/env ts-node

/**
 * Quick Klines Summary Script
 * 
 * This script provides a quick summary of what's actually in the klines table
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

async function main() {
  const prisma = new PrismaClient();

  try {
    await prisma.$connect();
    console.log('✅ Connected to database');

    // Get total count
    const totalRecords = await prisma.klines.count();
    console.log(`📊 Total klines records: ${totalRecords.toLocaleString()}`);

    if (totalRecords === 0) {
      console.log('❌ No klines data found in database');
      return;
    }

    // Get per-symbol summary
    const symbolSummary = await prisma.klines.groupBy({
      by: ['symbol'],
      _count: {
        id: true
      },
      _min: {
        openTime: true
      },
      _max: {
        openTime: true
      },
      orderBy: {
        _count: {
          id: 'desc'
        }
      }
    });

    console.log('\n📋 Per-Symbol Summary:');
    console.log('-'.repeat(70));
    console.log('Symbol       | Records    | Earliest            | Latest');
    console.log('-'.repeat(70));

    symbolSummary.forEach(summary => {
      const symbol = summary.symbol.padEnd(12);
      const count = summary._count.id.toLocaleString().padStart(10);
      const earliest = summary._min.openTime?.toISOString().split('T')[0] || 'N/A';
      const latest = summary._max.openTime?.toISOString().split('T')[0] || 'N/A';
      
      console.log(`${symbol} | ${count} | ${earliest}       | ${latest}`);
    });

    // Get date range statistics
    const dateStats = await prisma.klines.aggregate({
      _min: { openTime: true },
      _max: { openTime: true }
    });

    console.log('\n📅 Overall Date Range:');
    console.log(`  Earliest: ${dateStats._min.openTime}`);
    console.log(`  Latest: ${dateStats._max.openTime}`);

    // Check for specific intervals - sample a few records to estimate
    const sampleRecords = await prisma.klines.findMany({
      select: { openTime: true, symbol: true },
      orderBy: { openTime: 'asc' },
      take: 10
    });

    if (sampleRecords.length >= 2) {
      const timeDiff = sampleRecords[1].openTime.getTime() - sampleRecords[0].openTime.getTime();
      const intervalMinutes = timeDiff / (1000 * 60);
      console.log(`\n⏱️  Detected Interval: ~${intervalMinutes} minutes`);
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);