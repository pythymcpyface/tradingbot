#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';

async function debugExitSearch() {
  const prisma = new PrismaClient();
  await prisma.$connect();
  
  // Let's look at the first trade in detail
  const entryTime = new Date('2021-08-27T06:20:00.000Z');
  const entryPrice = 477.8000;
  const profitLossPercent = -15.09;
  const targetPrice = entryPrice * (1 + (profitLossPercent / 100));
  
  console.log(`=== DEBUGGING EXIT SEARCH ===`);
  console.log(`Entry: ${entryTime.toISOString()} at $${entryPrice.toFixed(4)}`);
  console.log(`Expected P&L: ${profitLossPercent.toFixed(2)}%`);
  console.log(`Target Price: $${targetPrice.toFixed(4)}`);
  console.log('');
  
  // Get market data for the first few days after entry
  const searchEndTime = new Date(entryTime.getTime() + (7 * 24 * 60 * 60 * 1000)); // 7 days
  
  const marketData = await prisma.klines.findMany({
    where: {
      symbol: 'BNBUSDT',
      openTime: {
        gt: entryTime,
        lte: searchEndTime
      }
    },
    orderBy: { openTime: 'asc' },
    take: 50  // First 50 candles
  });

  console.log(`Found ${marketData.length} candles in first 7 days:`);
  console.log('');
  
  marketData.forEach((candle, i) => {
    const high = parseFloat(candle.high.toString());
    const low = parseFloat(candle.low.toString());
    const close = parseFloat(candle.close.toString());
    
    // Check if target was reached
    const targetReached = low <= targetPrice;
    const marker = targetReached ? ' ⭐ TARGET REACHED' : '';
    
    console.log(`${i + 1}. ${candle.openTime.toISOString()} | H:$${high.toFixed(2)} L:$${low.toFixed(2)} C:$${close.toFixed(2)}${marker}`);
    
    if (targetReached) {
      const duration = (candle.openTime.getTime() - entryTime.getTime()) / (1000 * 60 * 60);
      console.log(`   → Exit found after ${duration.toFixed(1)} hours`);
      console.log('');
      return; // Found it
    }
  });
  
  console.log('');
  console.log('=== ANALYZING PRICE MOVEMENT ===');
  
  // Find the minimum price in the search period
  const minCandle = marketData.reduce((min, candle) => {
    const currentLow = parseFloat(candle.low.toString());
    const minLow = parseFloat(min.low.toString());
    return currentLow < minLow ? candle : min;
  }, marketData[0]);
  
  if (minCandle) {
    const minPrice = parseFloat(minCandle.low.toString());
    const actualDecline = ((minPrice - entryPrice) / entryPrice) * 100;
    
    console.log(`Minimum price reached: $${minPrice.toFixed(4)} on ${minCandle.openTime.toISOString()}`);
    console.log(`Actual decline: ${actualDecline.toFixed(2)}% (target was ${profitLossPercent.toFixed(2)}%)`);
    
    if (minPrice > targetPrice) {
      console.log(`❌ Target price $${targetPrice.toFixed(4)} was never reached (min was $${minPrice.toFixed(4)})`);
    } else {
      console.log(`✅ Target price was reached`);
    }
  }
  
  await prisma.$disconnect();
}

debugExitSearch().catch(console.error);