#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function createIndexes() {
  console.log('🔧 Creating database indexes for performance...');
  
  try {
    await prisma.$executeRaw`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_klines_symbol_opentime_covering 
      ON "klines" (symbol, "openTime") 
      INCLUDE ("close", "volume", "takerBuyBaseAssetVolume");
    `;
    
    await prisma.$executeRaw`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_klines_opentime_desc 
      ON "klines" ("openTime" DESC);
    `;
    
    console.log('✅ Indexes created successfully');
  } catch (error: any) {
    console.error('⚠️ Some indexes may already exist:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

createIndexes().catch(console.error);