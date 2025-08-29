#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';
import { TradingEngine } from '../src/node-api/services/TradingEngine';
import { BinanceService } from '../src/node-api/services/BinanceService';
import { RustCoreService } from '../src/node-api/services/RustCoreService';
import { Logger } from '../src/services/Logger';

/**
 * Test script to demonstrate comprehensive paper trading functionality
 * Shows how buy signals trigger OCO positions and Z-score reversals close them
 */

async function testCompletePaperTrading() {
  const prisma = new PrismaClient();
  
  try {
    console.log('🧪 Testing Complete Paper Trading System');
    console.log('===============================================');
    
    // Create services
    const binanceService = new BinanceService();
    const rustService = new RustCoreService();
    const logger = new Logger('test-paper-trading');
    
    // Create trading engine with paper trading enabled
    const tradingEngine = new TradingEngine(
      {
        enableLiveTrading: false, // Paper trading only
        maxPositions: 3,
        symbols: ['ETHUSDT', 'BTCUSDT', 'BNBUSDT'],
        riskLevel: 'medium'
      },
      prisma,
      binanceService,
      rustService,
      logger
    );

    // Load parameter sets for testing
    const parameterSets = [
      {
        symbol: 'ETHUSDT',
        zScoreThreshold: 0.1, // Very low threshold for testing
        profitPercent: 2.0,
        stopLossPercent: 1.0,
        allocationPercent: 10.0,
        movingAverages: 1,
        riskLevel: 'medium'
      },
      {
        symbol: 'BTCUSDT',
        zScoreThreshold: 0.2,
        profitPercent: 1.5,
        stopLossPercent: 1.5,
        allocationPercent: 15.0,
        movingAverages: 2,
        riskLevel: 'medium'
      }
    ];

    await tradingEngine.initialize(parameterSets);
    
    console.log('📊 Initial Paper Trading Status:');
    const initialStatus = tradingEngine.getPaperTradingStatus();
    console.log(`   Balance: $${initialStatus.balance.toFixed(2)}`);
    console.log(`   Positions: ${initialStatus.positions.length}`);
    console.log(`   Total Portfolio Value: $${initialStatus.totalValue.toFixed(2)}`);
    console.log('');

    // Set up event listeners to track paper trading activities
    tradingEngine.on('paperTrade', (event) => {
      console.log(`🔔 Paper Trade Event: ${event.action || event.signal} - ${event.symbol}`);
      if (event.position) {
        console.log(`   Entry Price: $${event.position.entryPrice?.toFixed(4) || 'N/A'}`);
        console.log(`   Quantity: ${event.position.quantity?.toFixed(6) || 'N/A'}`);
        if (event.pnl) {
          console.log(`   P&L: $${event.pnl.toFixed(2)} (${event.pnlPercent?.toFixed(2)}%)`);
        }
      }
      console.log('');
    });

    // Start monitoring (this will calculate Z-scores and detect signals)
    console.log('🚀 Starting Paper Trading Engine...');
    await tradingEngine.start();
    
    // Monitor for 2 cycles to demonstrate functionality
    let cycleCount = 0;
    const maxCycles = 2;
    
    const monitorInterval = setInterval(async () => {
      cycleCount++;
      console.log(`\n📈 Monitoring Cycle ${cycleCount}/${maxCycles}`);
      console.log('='.repeat(40));
      
      // Get current status
      const status = tradingEngine.getPaperTradingStatus();
      console.log(`💰 Paper Trading Status:`);
      console.log(`   Balance: $${status.balance.toFixed(2)}`);
      console.log(`   Active Positions: ${status.positions.length}`);
      console.log(`   Total Portfolio Value: $${status.totalValue.toFixed(2)}`);
      console.log(`   Unrealized P&L: $${status.totalUnrealizedPnL.toFixed(2)}`);
      
      // Show position details
      if (status.positions.length > 0) {
        console.log(`\n📊 Position Details:`);
        status.positions.forEach((pos, index) => {
          console.log(`   ${index + 1}. ${pos.symbol}:`);
          console.log(`      Entry: $${pos.entryPrice.toFixed(4)} | Qty: ${pos.quantity.toFixed(6)}`);
          console.log(`      Take Profit: $${pos.takeProfitPrice.toFixed(4)} | Stop Loss: $${pos.stopLossPrice.toFixed(4)}`);
          if (pos.unrealizedPnL) {
            const pnlStatus = pos.unrealizedPnL > 0 ? '📈' : '📉';
            console.log(`      ${pnlStatus} P&L: $${pos.unrealizedPnL.toFixed(2)} (${pos.unrealizedPnLPercent?.toFixed(2)}%)`);
          }
          console.log(`      Duration: ${Math.floor((Date.now() - pos.entryTime.getTime()) / 1000)}s`);
        });
      } else {
        console.log(`   No active positions`);
      }
      
      if (cycleCount >= maxCycles) {
        clearInterval(monitorInterval);
        console.log('\n🏁 Test Complete - Stopping Engine');
        await tradingEngine.stop();
        
        // Final status
        const finalStatus = tradingEngine.getPaperTradingStatus();
        console.log('\n📋 Final Paper Trading Results:');
        console.log('===============================================');
        console.log(`Final Balance: $${finalStatus.balance.toFixed(2)}`);
        console.log(`Final Portfolio Value: $${finalStatus.totalValue.toFixed(2)}`);
        console.log(`Performance: ${finalStatus.totalValue > 10000 ? '📈 Profit' : '📉 Loss'}: $${(finalStatus.totalValue - 10000).toFixed(2)}`);
        console.log(`Active Positions: ${finalStatus.positions.length}`);
        
        process.exit(0);
      }
    }, 30000); // Check every 30 seconds for testing
    
  } catch (error) {
    console.error('❌ Error testing paper trading:', error);
    process.exit(1);
  }
}

/**
 * Helper function to explain paper trading workflow
 */
function explainPaperTradingWorkflow() {
  console.log('\n📚 Paper Trading Workflow Explanation:');
  console.log('======================================');
  console.log('1. 🎯 BUY SIGNAL TRIGGERED:');
  console.log('   - Z-score moving average exceeds threshold');
  console.log('   - Creates virtual position with calculated quantity');
  console.log('   - Sets Take Profit and Stop Loss prices (OCO logic)');
  console.log('   - Deducts allocation from virtual balance');
  console.log('');
  console.log('2. 🔄 POSITION MONITORING:');
  console.log('   - Updates unrealized P&L every cycle');
  console.log('   - Checks if current price hits Take Profit or Stop Loss');
  console.log('   - Monitors Z-score for reversal conditions');
  console.log('');
  console.log('3. 🚪 POSITION EXIT CONDITIONS:');
  console.log('   - Take Profit: Price >= takeProfitPrice');
  console.log('   - Stop Loss: Price <= stopLossPrice');
  console.log('   - Z-Score Reversal: Z-score <= -threshold');
  console.log('   - Manual SELL signal: Z-score based sell signal');
  console.log('');
  console.log('4. 💰 P&L CALCULATION:');
  console.log('   - Exit Value = quantity × current_price');
  console.log('   - P&L = Exit Value - Entry Value');
  console.log('   - P&L% = (P&L / Entry Value) × 100');
  console.log('   - Virtual balance updated with exit value');
  console.log('');
}

// Run the test
explainPaperTradingWorkflow();
testCompletePaperTrading().catch(console.error);