#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';

async function investigateTradeStructure() {
  const prisma = new PrismaClient();
  await prisma.$connect();
  
  const runId = 'BNBUSDT_2021-07-19_2022-07-19_1756024934729';
  
  console.log('=== INVESTIGATING TRADE DATA STRUCTURE ===\n');
  
  const orders = await prisma.backtestOrders.findMany({
    where: { runId },
    orderBy: { timestamp: 'asc' }
  });
  
  console.log(`Found ${orders.length} orders:\n`);
  
  orders.forEach((order, i) => {
    console.log(`Order ${i + 1}:`);
    console.log(`  Timestamp: ${order.timestamp.toISOString()}`);
    console.log(`  Side: ${order.side}`);
    console.log(`  Price: $${parseFloat(order.price.toString()).toFixed(4)}`);
    console.log(`  Quantity: ${parseFloat(order.quantity.toString()).toFixed(4)}`);
    console.log(`  Reason: ${order.reason}`);
    console.log(`  P&L: ${order.profitLoss ? '$' + parseFloat(order.profitLoss.toString()).toFixed(2) : 'N/A'}`);
    console.log(`  P&L%: ${order.profitLossPercent ? parseFloat(order.profitLossPercent.toString()).toFixed(2) + '%' : 'N/A'}`);
    console.log('');
  });
  
  // Let's also check the market price at the entry time to see if it matches
  console.log('=== CHECKING MARKET PRICES AT ENTRY TIMES ===\n');
  
  for (const order of orders) {
    const marketPrice = await prisma.klines.findFirst({
      where: {
        symbol: 'BNBUSDT',
        openTime: {
          lte: order.timestamp
        }
      },
      orderBy: { openTime: 'desc' }
    });
    
    if (marketPrice) {
      const entryPrice = parseFloat(order.price.toString());
      const marketOpen = parseFloat(marketPrice.open.toString());
      const marketClose = parseFloat(marketPrice.close.toString());
      const marketHigh = parseFloat(marketPrice.high.toString());
      const marketLow = parseFloat(marketPrice.low.toString());
      
      console.log(`Entry at ${order.timestamp.toISOString()}:`);
      console.log(`  Order Price: $${entryPrice.toFixed(4)}`);
      console.log(`  Market OHLC: $${marketOpen.toFixed(4)} / $${marketHigh.toFixed(4)} / $${marketLow.toFixed(4)} / $${marketClose.toFixed(4)}`);
      console.log(`  Market Time: ${marketPrice.openTime.toISOString()}`);
      
      // Check if entry price is within the market range
      const withinRange = entryPrice >= marketLow && entryPrice <= marketHigh;
      console.log(`  Price within market range: ${withinRange}`);
      console.log('');
    }
  }
  
  await prisma.$disconnect();
}

investigateTradeStructure().catch(console.error);