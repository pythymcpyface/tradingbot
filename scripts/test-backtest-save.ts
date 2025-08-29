#!/usr/bin/env ts-node

/**
 * Test Backtest Data Save
 * 
 * Quick test to verify backtest data can be saved correctly
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

async function testBacktestSave() {
  const prisma = new PrismaClient();
  
  try {
    await prisma.$connect();
    console.log('✅ Connected to database');

    // Test creating a simple backtest run
    const testRun = await prisma.backtestRuns.create({
      data: {
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        zScoreThreshold: 2.0,
        movingAverages: 20,
        profitPercent: 5.0,
        stopLossPercent: 2.5,
        startTime: new Date('2025-07-12'),
        endTime: new Date('2025-08-11'),
        windowSize: 20
      }
    });

    console.log('✅ Created test backtest run:', testRun.id);

    // Test creating a backtest order
    const testOrder = await prisma.backtestOrders.create({
      data: {
        runId: testRun.id,
        symbol: 'BTCUSDT',
        side: 'BUY',
        quantity: 0.1,
        price: 50000,
        timestamp: new Date('2025-07-12'),
        reason: 'EXIT_PROFIT',
        profitLoss: 100,
        profitLossPercent: 2.0
      }
    });

    console.log('✅ Created test backtest order:', testOrder.id);

    // Test creating optimization results
    const testOptimization = await prisma.optimizationResults.create({
      data: {
        runId: testRun.id,
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        zScoreThreshold: 2.0,
        movingAverages: 20,
        profitPercent: 5.0,
        stopLossPercent: 2.5,
        startTime: new Date('2025-07-12'),
        endTime: new Date('2025-08-11'),
        totalReturn: 5.5,
        annualizedReturn: 67.2,
        sharpeRatio: 1.2,
        sortinoRatio: 1.5,
        alpha: 2.3,
        maxDrawdown: -3.2,
        winRatio: 65.0,
        totalTrades: 25,
        profitFactor: 1.8,
        avgTradeDuration: 48.5
      }
    });

    console.log('✅ Created test optimization result:', testOptimization.id);

    // Clean up test data
    await prisma.backtestOrders.delete({ where: { id: testOrder.id } });
    await prisma.optimizationResults.delete({ where: { id: testOptimization.id } });
    await prisma.backtestRuns.delete({ where: { id: testRun.id } });

    console.log('🧹 Cleaned up test data');
    console.log('✅ All database save operations work correctly!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testBacktestSave().catch(console.error);