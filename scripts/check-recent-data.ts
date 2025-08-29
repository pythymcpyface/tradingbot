#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

async function checkRecentData() {
  const prisma = new PrismaClient();
  
  try {
    await prisma.$connect();
    
    console.log('🔍 Recent Data Analysis');
    console.log('='.repeat(60));
    
    // Get the most recent record overall
    const mostRecent = await prisma.klines.findFirst({
      orderBy: { openTime: 'desc' },
      select: { symbol: true, openTime: true }
    });
    
    console.log(`Most recent record: ${mostRecent?.symbol} at ${mostRecent?.openTime?.toISOString()}`);
    
    // Check when data actually ends for key pairs
    const symbols = ['BTCUSDT', 'ETHUSDT', 'ADABNB', 'LINKETH', 'XLMBTC', 'TRXBNB', 'TRXBTC'];
    
    console.log('\n📅 Actual Latest Data by Symbol:');
    console.log('-'.repeat(50));
    
    for (const symbol of symbols) {
      const latest = await prisma.klines.findFirst({
        where: { symbol },
        orderBy: { openTime: 'desc' },
        select: { openTime: true }
      });
      
      if (latest) {
        const daysAgo = Math.floor((Date.now() - latest.openTime.getTime()) / (24 * 60 * 60 * 1000));
        console.log(`${symbol.padEnd(12)}: ${latest.openTime.toISOString().split('T')[0]} (${daysAgo} days ago)`);
      } else {
        console.log(`${symbol.padEnd(12)}: No data`);
      }
    }
    
    // Check data distribution by month for TRXBNB and TRXBTC
    console.log('\n📊 TRXBNB Monthly Data Distribution (2024):');
    console.log('-'.repeat(40));
    
    const trxbnbMonthly = await prisma.$queryRaw`
      SELECT 
        DATE_TRUNC('month', "openTime") as month,
        COUNT(*) as record_count
      FROM klines 
      WHERE symbol = 'TRXBNB' 
        AND "openTime" >= '2024-01-01'
        AND "openTime" < '2025-01-01'
      GROUP BY DATE_TRUNC('month', "openTime")
      ORDER BY month
    `;
    
    (trxbnbMonthly as any[]).forEach(row => {
      const month = new Date(row.month).toISOString().slice(0, 7);
      const expectedRecords = 30 * 24 * 12; // Rough estimate
      const percentage = ((Number(row.record_count) / expectedRecords) * 100).toFixed(1);
      console.log(`${month}: ${row.record_count} records (${percentage}%)`);
    });
    
    console.log('\n📊 TRXBTC Monthly Data Distribution (2024):');
    console.log('-'.repeat(40));
    
    const trxbtcMonthly = await prisma.$queryRaw`
      SELECT 
        DATE_TRUNC('month', "openTime") as month,
        COUNT(*) as record_count
      FROM klines 
      WHERE symbol = 'TRXBTC' 
        AND "openTime" >= '2024-01-01'
        AND "openTime" < '2025-01-01'
      GROUP BY DATE_TRUNC('month', "openTime")
      ORDER BY month
    `;
    
    (trxbtcMonthly as any[]).forEach(row => {
      const month = new Date(row.month).toISOString().slice(0, 7);
      const expectedRecords = 30 * 24 * 12; // Rough estimate
      const percentage = ((Number(row.record_count) / expectedRecords) * 100).toFixed(1);
      console.log(`${month}: ${row.record_count} records (${percentage}%)`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkRecentData().catch(console.error);