#!/usr/bin/env ts-node

/**
 * Check Interval Details Script
 * 
 * This script analyzes the actual intervals in the klines data
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

async function main() {
  const prisma = new PrismaClient();

  try {
    await prisma.$connect();
    console.log('✅ Connected to database');

    // Get sample records for each symbol to analyze intervals
    const symbols = ['BTCUSDT', 'ETHUSDT'];
    
    for (const symbol of symbols) {
      console.log(`\n🔍 Analyzing ${symbol}:`);
      
      const records = await prisma.klines.findMany({
        where: { symbol },
        select: { openTime: true, closeTime: true },
        orderBy: { openTime: 'asc' },
        take: 5
      });

      if (records.length >= 2) {
        console.log(`  📅 First 5 records:`);
        records.forEach((record, index) => {
          const openTime = record.openTime.toISOString();
          const closeTime = record.closeTime.toISOString();
          console.log(`    ${index + 1}. Open: ${openTime}, Close: ${closeTime}`);
          
          if (index > 0) {
            const intervalMs = record.openTime.getTime() - records[index - 1].openTime.getTime();
            const intervalMinutes = intervalMs / (1000 * 60);
            console.log(`       → Interval from previous: ${intervalMinutes} minutes`);
          }
        });

        // Check total count and time span
        const count = await prisma.klines.count({ where: { symbol } });
        const dateRange = await prisma.klines.aggregate({
          where: { symbol },
          _min: { openTime: true },
          _max: { openTime: true }
        });

        if (dateRange._min.openTime && dateRange._max.openTime) {
          const totalTimeMs = dateRange._max.openTime.getTime() - dateRange._min.openTime.getTime();
          const totalMinutes = totalTimeMs / (1000 * 60);
          const expectedRecords5m = totalMinutes / 5; // For 5-minute intervals
          const expectedRecords1m = totalMinutes / 1; // For 1-minute intervals

          console.log(`  📊 Statistics:`);
          console.log(`    Records: ${count}`);
          console.log(`    Time span: ${totalMinutes.toFixed(1)} minutes`);
          console.log(`    Expected for 1m: ${expectedRecords1m.toFixed(0)} records`);
          console.log(`    Expected for 5m: ${expectedRecords5m.toFixed(0)} records`);
          console.log(`    Actual interval appears to be: ${(totalMinutes / count).toFixed(1)} minutes`);
        }
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);