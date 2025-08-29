#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';

async function testDatabaseConnection() {
  const prisma = new PrismaClient();
  
  try {
    console.log('🔍 Testing database connection...');
    await prisma.$connect();
    console.log('✅ Database connection successful!');
    
    // Try to count records in a table
    try {
      const count = await prisma.backtestOrders.count();
      console.log(`📊 Found ${count} backtest orders in database`);
      
      if (count > 0) {
        console.log('🗑️ Ready to run: npx ts-node scripts/clear-backtest-orders.ts');
      } else {
        console.log('ℹ️  BacktestOrders table is already empty');
      }
    } catch (tableError) {
      console.log('⚠️ Table access issue (may need migration):', (tableError as Error).message);
    }
    
  } catch (error) {
    console.error('❌ Database connection failed:', (error as Error).message);
    
    if ((error as Error).message.includes("Can't reach database server")) {
      console.log('\n🔧 Possible solutions:');
      console.log('1. Start database: docker-compose up -d postgres');
      console.log('2. Check port 5436 is available: lsof -i :5436');
      console.log('3. Verify database credentials in .env file');
    }
  } finally {
    await prisma.$disconnect();
  }
}

testDatabaseConnection().catch(console.error);