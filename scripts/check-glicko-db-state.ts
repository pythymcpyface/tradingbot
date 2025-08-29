#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  
  try {
    await prisma.$connect();
    
    const count = await prisma.glickoRatings.count();
    console.log('Total records:', count);
    
    const uniqueSymbols = await prisma.glickoRatings.groupBy({
      by: ['symbol'],
      _count: true
    });
    
    console.log('Unique symbols:', uniqueSymbols.length);
    console.log('Records per symbol:');
    uniqueSymbols.forEach(s => {
      console.log(`  ${s.symbol}: ${s._count} records`);
    });
    
    const uniqueTimestamps = await prisma.glickoRatings.groupBy({
      by: ['timestamp'],
      _count: { symbol: true }
    });
    
    console.log('Unique timestamps:', uniqueTimestamps.length);
    
    // Get sample of recent records
    const recentRecords = await prisma.glickoRatings.findMany({
      orderBy: { timestamp: 'desc' },
      take: 10,
      select: {
        symbol: true,
        timestamp: true,
        rating: true
      }
    });
    
    console.log('\nSample recent records:');
    recentRecords.forEach(r => {
      console.log(`  ${r.symbol} at ${r.timestamp.toISOString()}: Rating ${Number(r.rating)}`);
    });
    
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);