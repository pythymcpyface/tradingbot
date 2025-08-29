#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  
  try {
    await prisma.$connect();
    
    const timestampCounts = await prisma.glickoRatings.groupBy({
      by: ['timestamp'],
      _count: { symbol: true },
      orderBy: { timestamp: 'asc' }
    });
    
    console.log('Total unique timestamps:', timestampCounts.length);
    
    console.log('\nFirst 10 timestamps with record counts:');
    timestampCounts.slice(0, 10).forEach(t => {
      console.log(`${t.timestamp.toISOString()}: ${t._count} symbols`);
    });
    
    console.log('\nLast 10 timestamps with record counts:');
    timestampCounts.slice(-10).forEach(t => {
      console.log(`${t.timestamp.toISOString()}: ${t._count} symbols`);
    });
    
    console.log('\nTimestamp frequency analysis:');
    const hourlyGaps = [];
    for (let i = 1; i < Math.min(100, timestampCounts.length); i++) {
      const prevTime = new Date(timestampCounts[i-1].timestamp).getTime();
      const currTime = new Date(timestampCounts[i].timestamp).getTime();
      const hoursDiff = (currTime - prevTime) / (1000 * 60 * 60);
      hourlyGaps.push(hoursDiff);
    }
    
    if (hourlyGaps.length > 0) {
      console.log('Average gap between timestamps (hours):', (hourlyGaps.reduce((a,b) => a+b, 0) / hourlyGaps.length).toFixed(2));
      console.log('Min gap:', Math.min(...hourlyGaps).toFixed(2), 'hours');
      console.log('Max gap:', Math.max(...hourlyGaps).toFixed(2), 'hours');
    }
    
    // Check for patterns in the data
    const sampleRecords = await prisma.glickoRatings.findMany({
      where: { symbol: 'BTC' },
      orderBy: { timestamp: 'asc' },
      take: 20,
      select: { timestamp: true, rating: true }
    });
    
    console.log('\nSample BTC records (first 20):');
    sampleRecords.forEach((r, i) => {
      const prevTime = i > 0 ? sampleRecords[i-1].timestamp.getTime() : null;
      const currTime = r.timestamp.getTime();
      const gap = prevTime ? ((currTime - prevTime) / (1000 * 60 * 60)).toFixed(1) : 'N/A';
      console.log(`  ${r.timestamp.toISOString()}: Rating ${Number(r.rating).toFixed(1)} (gap: ${gap}h)`);
    });
    
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);