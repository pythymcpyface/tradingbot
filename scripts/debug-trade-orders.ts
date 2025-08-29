#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';

async function debugTradeOrders() {
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    
    // Find the specific backtest run
    const runId = 'BNBUSDT_2021-07-19_2022-07-19_1756023402221';
    
    console.log(`🔍 Debugging orders for run: ${runId}\n`);
    
    const orders = await prisma.backtestOrders.findMany({
      where: { runId },
      orderBy: { timestamp: 'asc' },
      select: {
        id: true,
        side: true,
        timestamp: true,
        price: true,
        quantity: true,
        reason: true,
        profitLoss: true,
        profitLossPercent: true
      }
    });
    
    console.log(`Found ${orders.length} orders:`);
    console.log('');
    console.log('ID                       | Side | Timestamp                | Price      | Reason        | P&L%');
    console.log('-'.repeat(90));
    
    orders.forEach(order => {
      const timestamp = new Date(order.timestamp).toISOString();
      const price = parseFloat(order.price.toString()).toFixed(4);
      const pnl = order.profitLossPercent ? parseFloat(order.profitLossPercent.toString()).toFixed(2) : 'N/A';
      
      console.log(`${order.id} | ${order.side.padEnd(4)} | ${timestamp} | $${price.padEnd(8)} | ${(order.reason || 'N/A').padEnd(12)} | ${pnl}%`);
    });
    
    // Count by side
    const buys = orders.filter(o => o.side === 'BUY').length;
    const sells = orders.filter(o => o.side === 'SELL').length;
    
    console.log('');
    console.log(`📊 Order Summary:`);
    console.log(`   BUY orders: ${buys}`);
    console.log(`   SELL orders: ${sells}`);
    console.log(`   Complete trades: ${Math.min(buys, sells)}`);
    
    // Check if trades are stored differently - maybe as paired records?
    if (sells === 0 && buys > 0) {
      console.log('\n💡 Possible Issues:');
      console.log('   - SELL orders might be stored separately');
      console.log('   - Trade completion might be recorded differently');
      console.log('   - Check if entry/exit are stored as single records with different fields');
    }
    
  } finally {
    await prisma.$disconnect();
  }
}

debugTradeOrders().catch(console.error);