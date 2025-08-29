#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';

async function checkAllTablesStatus() {
  const prisma = new PrismaClient();
  
  try {
    console.log('📊 Checking All Database Tables Status');
    console.log('=====================================\n');
    
    await prisma.$connect();
    console.log('✅ Database connection successful\n');

    // Define all backtest and trading related tables (using correct Prisma model names)
    const tablesToCheck = [
      { name: 'BacktestOrders', model: prisma.backtestOrders },
      { name: 'BacktestRuns', model: prisma.backtestRuns },
      { name: 'Klines', model: prisma.klines },
      { name: 'OptimizationResults', model: prisma.optimizationResults },
      { name: 'ProductionOrders', model: prisma.productionOrders },
      { name: 'GlickoRatings', model: prisma.glickoRatings }
    ];

    console.log('🗄️  TABLE STATUS REPORT:');
    console.log('━'.repeat(50));
    
    let totalRecords = 0;
    const tableStatus = [];

    for (const table of tablesToCheck) {
      try {
        const count = await table.model.count();
        totalRecords += count;
        
        const status = count === 0 ? '✅ CLEAN' : `📊 ${count.toLocaleString()} records`;
        const readyForNew = count === 0 ? '🆕 Ready' : '⚠️ Has data';
        
        tableStatus.push({
          name: table.name,
          count,
          status,
          ready: count === 0
        });

        console.log(`${table.name.padEnd(20)} │ ${status.padEnd(15)} │ ${readyForNew}`);
        
      } catch (error) {
        console.log(`${table.name.padEnd(20)} │ ❌ ERROR       │ Check schema`);
        console.log(`   Error: ${(error as Error).message}`);
      }
    }

    console.log('━'.repeat(50));
    console.log(`TOTAL RECORDS: ${totalRecords.toLocaleString()}\n`);

    // Summary for backtest readiness
    const backtestTables = tableStatus.filter(t => 
      t.name.includes('Backtest') || t.name === 'OptimizationResults'
    );
    
    const allBacktestTablesClean = backtestTables.every(t => t.ready);
    
    console.log('🧪 BACKTEST READINESS:');
    console.log('━'.repeat(30));
    
    if (allBacktestTablesClean) {
      console.log('✅ ALL BACKTEST TABLES CLEAN');
      console.log('🚀 Ready for new backtest runs');
      console.log('🔄 No historical data conflicts');
      console.log('📈 Fresh start for optimization');
    } else {
      console.log('⚠️  BACKTEST TABLES CONTAIN DATA:');
      backtestTables.forEach(table => {
        if (!table.ready) {
          console.log(`   • ${table.name}: ${table.count.toLocaleString()} records`);
        }
      });
      console.log('\n🤔 Options:');
      console.log('   1. Keep existing data (append new results)');
      console.log('   2. Clear specific tables: npx ts-node scripts/clear-backtest-orders.ts');
      console.log('   3. Full reset: npx ts-node scripts/clear-database.ts');
    }

    // Check market data availability
    console.log('\n📊 MARKET DATA STATUS:');
    console.log('━'.repeat(25));
    
    const klineCount = tableStatus.find(t => t.name === 'Klines')?.count || 0;
    
    if (klineCount > 0) {
      console.log(`✅ Market data available: ${klineCount.toLocaleString()} klines`);
      console.log('🚀 Ready for backtesting');
    } else {
      console.log('⚠️  No market data found');
      console.log('📥 Need to fetch klines: npx tsx scripts/getKlines.ts');
    }

    // Live trading readiness
    console.log('\n🔴 LIVE TRADING STATUS:');
    console.log('━'.repeat(22));
    
    const productionOrdersCount = tableStatus.find(t => t.name === 'ProductionOrders')?.count || 0;
    
    if (productionOrdersCount === 0) {
      console.log('✅ No active production orders');
      console.log('🆕 Clean slate for live trading');
    } else {
      console.log(`⚠️  Active production data: ${productionOrdersCount.toLocaleString()} orders`);
      console.log('🔍 Review before starting new live trading');
    }

  } catch (error) {
    console.error('❌ Error checking database:', (error as Error).message);
  } finally {
    await prisma.$disconnect();
  }
}

checkAllTablesStatus().catch(console.error);