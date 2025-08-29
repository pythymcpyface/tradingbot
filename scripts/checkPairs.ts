#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

async function checkPairs() {
  const prisma = new PrismaClient();
  
  try {
    await prisma.$connect();
    
    // Get all unique symbols
    const symbols = await prisma.klines.findMany({
      select: { symbol: true },
      distinct: ['symbol']
    });
    
    console.log(`Found ${symbols.length} unique trading pairs:`);
    
    const coins = ['BTC', 'ETH', 'ADA', 'AVAX', 'BNB', 'DOGE', 'LINK', 'POL', 'SOL', 'TRX', 'XLM', 'XRP', 'USDT'];
    
    for (const coin of coins) {
      const pairs = symbols.filter(s => 
        s.symbol.includes(coin)
      ).map(s => s.symbol);
      
      console.log(`\n${coin}: ${pairs.length} pairs`);
      console.log(`  ${pairs.join(', ')}`);
    }
    
  } finally {
    await prisma.$disconnect();
  }
}

checkPairs().catch(console.error);