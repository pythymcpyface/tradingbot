#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';
import { TradingEngine } from '../src/node-api/services/TradingEngine';
import { BinanceService } from '../src/node-api/services/BinanceService';
import { RustCoreService } from '../src/node-api/services/RustCoreService';
import { Logger } from '../src/services/Logger';

/**
 * Test script to demonstrate real Binance OCO order functionality
 * 
 * WORKFLOW:
 * 1. BUY Signal Triggered -> Market Buy Order -> Immediate OCO Sell Order
 * 2. OCO Order Active -> Monitor Z-Score for Reversal
 * 3. Z-Score Reversal -> Cancel OCO -> Market Sell
 * 
 * IMPORTANT: This uses TESTNET by default for safety!
 */

async function testLiveOcoTrading() {
  const prisma = new PrismaClient();
  
  try {
    console.log('🧪 Testing Live OCO Trading System');
    console.log('=====================================');
    console.log('⚠️  WARNING: This will place REAL orders on Binance TESTNET');
    console.log('   Make sure you have testnet API keys configured');
    console.log('');
    
    // Create services with testnet configuration
    const binanceService = new BinanceService(
      {
        apiKey: process.env.BINANCE_TESTNET_API_KEY || '',
        apiSecret: process.env.BINANCE_TESTNET_API_SECRET || '',
        testnet: true, // SAFETY: Use testnet
        paperTrading: false // Real orders on testnet
      },
      prisma
    );
    
    const rustService = new RustCoreService();
    const logger = new Logger('test-live-oco');
    
    // Create trading engine with LIVE trading enabled
    const tradingEngine = new TradingEngine(
      {
        enableLiveTrading: true, // REAL ORDERS (on testnet)
        maxPositions: 2,
        symbols: ['ETHUSDT', 'BTCUSDT'],
        riskLevel: 'medium'
      },
      prisma,
      binanceService,
      rustService,
      logger
    );

    // Load test parameter sets with low thresholds for quick signals
    const parameterSets = [
      {
        symbol: 'ETHUSDT',
        zScoreThreshold: 0.1, // Very low threshold for testing
        profitPercent: 1.0,   // 1% take profit
        stopLossPercent: 0.5, // 0.5% stop loss
        allocationPercent: 5.0, // Only 5% allocation for testing
        movingAverages: 1,
        riskLevel: 'medium'
      },
      {
        symbol: 'BTCUSDT',
        zScoreThreshold: 0.2,
        profitPercent: 0.8,
        stopLossPercent: 0.4,
        allocationPercent: 3.0, // Small allocation
        movingAverages: 2,
        riskLevel: 'medium'
      }
    ];

    await tradingEngine.initialize(parameterSets);
    
    // Get initial account balance
    const initialAccount = await binanceService.getAccountInfo();
    const initialUsdt = initialAccount.balances.find((b: any) => b.asset === 'USDT');
    console.log(`💰 Initial TESTNET Balance: ${initialUsdt?.free} USDT`);
    console.log('');

    // Set up comprehensive event listeners
    tradingEngine.on('liveTradeExecuted', (event) => {
      console.log('\n🔥 LIVE TRADE EXECUTED:');
      console.log(`   Symbol: ${event.symbol}`);
      console.log(`   Action: ${event.action}`);
      if (event.buyOrder) {
        console.log(`   Buy Order ID: ${event.buyOrder.orderId}`);
        console.log(`   Executed Quantity: ${event.buyOrder.executedQty}`);
        console.log(`   Average Price: $${(parseFloat(event.buyOrder.cummulativeQuoteQty) / parseFloat(event.buyOrder.executedQty)).toFixed(4)}`);
      }
      if (event.ocoOrder) {
        console.log(`   OCO Order List ID: ${event.ocoOrder.orderListId}`);
        console.log(`   Take Profit Price: $${event.position.takeProfitPrice.toFixed(4)}`);
        console.log(`   Stop Loss Price: $${event.position.stopLossPrice.toFixed(4)}`);
      }
      console.log('');
    });

    tradingEngine.on('zScoreReversal', (event) => {
      console.log('\n🔄 Z-SCORE REVERSAL DETECTED:');
      console.log(`   Symbol: ${event.symbol}`);
      console.log(`   OCO Order Cancelled: ${event.position.ocoOrderId}`);
      if (event.sellOrder) {
        console.log(`   Market Sell Order ID: ${event.sellOrder.orderId}`);
        console.log(`   Quantity Sold: ${event.sellOrder.executedQty}`);
        console.log(`   Average Sell Price: $${(parseFloat(event.sellOrder.cummulativeQuoteQty) / parseFloat(event.sellOrder.executedQty)).toFixed(4)}`);
      }
      console.log('');
    });

    // Monitor OCO order status
    const monitorOcoOrders = setInterval(async () => {
      try {
        const activePositions = tradingEngine.getActivePositions();
        if (activePositions.size > 0) {
          console.log(`\n📊 Active Positions: ${activePositions.size}`);
          for (const [symbol, position] of activePositions) {
            const currentPrice = await binanceService.getCurrentPrice(symbol);
            const unrealizedPnL = (currentPrice - position.entryPrice) * position.quantity;
            const pnlPercent = (unrealizedPnL / (position.entryPrice * position.quantity)) * 100;
            
            console.log(`   ${symbol}:`);
            console.log(`     Entry: $${position.entryPrice.toFixed(4)} | Current: $${currentPrice.toFixed(4)}`);
            console.log(`     Quantity: ${position.quantity.toFixed(6)}`);
            console.log(`     P&L: $${unrealizedPnL.toFixed(2)} (${pnlPercent > 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)`);
            console.log(`     Take Profit: $${position.takeProfitPrice.toFixed(4)}`);
            console.log(`     Stop Loss: $${position.stopLossPrice.toFixed(4)}`);
            console.log(`     OCO Order: ${position.ocoOrderId}`);
            
            // Check if close to OCO triggers
            if (currentPrice >= position.takeProfitPrice * 0.995) {
              console.log(`     🎯 NEAR TAKE PROFIT! Current: $${currentPrice.toFixed(4)}, Target: $${position.takeProfitPrice.toFixed(4)}`);
            }
            if (currentPrice <= position.stopLossPrice * 1.005) {
              console.log(`     🛑 NEAR STOP LOSS! Current: $${currentPrice.toFixed(4)}, Target: $${position.stopLossPrice.toFixed(4)}`);
            }
          }
        } else {
          console.log('\n📊 No active positions');
        }
      } catch (error) {
        console.error('Error monitoring positions:', error);
      }
    }, 30000); // Every 30 seconds

    // Start the trading engine
    console.log('🚀 Starting Live Trading Engine with OCO Orders...');
    await tradingEngine.start();
    
    console.log('\n✅ Live OCO Trading System Active!');
    console.log('📊 Monitoring for Glicko-2 based signals...');
    console.log('🎯 When BUY signal triggers:');
    console.log('   1. Market buy order executed immediately');
    console.log('   2. OCO sell order placed with take profit & stop loss');
    console.log('   3. Z-score reversal monitoring begins');
    console.log('   4. If Z-score reverses: OCO cancelled → Market sell executed');
    console.log('');
    console.log('🛑 Press Ctrl+C to stop and clean up positions');
    console.log('');

    // Handle graceful shutdown
    const cleanup = async () => {
      console.log('\n🛑 Shutting down trading system...');
      
      clearInterval(monitorOcoOrders);
      
      // Cancel all active OCO orders
      const activePositions = tradingEngine.getActivePositions();
      for (const [symbol, position] of activePositions) {
        try {
          console.log(`Cancelling OCO order for ${symbol}: ${position.ocoOrderId}`);
          await binanceService.cancelOrder(symbol, position.ocoOrderId);
          
          // Place market sell to close position
          console.log(`Closing position for ${symbol} with market sell...`);
          const sellOrder = await binanceService.placeOrder({
            symbol: symbol,
            side: 'SELL',
            type: 'MARKET',
            quantity: position.quantity.toString()
          });
          console.log(`✅ Position closed: ${sellOrder.orderId}`);
          
        } catch (error) {
          console.error(`Error closing position for ${symbol}:`, error);
        }
      }
      
      await tradingEngine.stop();
      
      // Final account balance
      const finalAccount = await binanceService.getAccountInfo();
      const finalUsdt = finalAccount.balances.find((b: any) => b.asset === 'USDT');
      console.log(`\n💰 Final TESTNET Balance: ${finalUsdt?.free} USDT`);
      console.log(`   Change: ${(parseFloat(finalUsdt?.free || '0') - parseFloat(initialUsdt?.free || '0')).toFixed(2)} USDT`);
      
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    
  } catch (error) {
    console.error('❌ Error in live OCO trading test:', error);
    process.exit(1);
  }
}

/**
 * Display OCO functionality explanation
 */
function explainOcoFunctionality() {
  console.log('\n📚 OCO (One-Cancels-Other) Functionality Explained:');
  console.log('===================================================');
  console.log('');
  console.log('🔄 TRADE LIFECYCLE:');
  console.log('1. Z-Score Signal Generated (above threshold)');
  console.log('2. 🔥 Market BUY order placed instantly');
  console.log('3. 🎯 OCO SELL order placed immediately after buy fills');
  console.log('   - Take Profit: Limit sell at +profit% from entry');
  console.log('   - Stop Loss: Stop-limit sell at -stoploss% from entry');
  console.log('4. 👁️  System monitors Z-score for reversal');
  console.log('5. IF Z-score reverses (crosses negative threshold):');
  console.log('   - 🚫 Cancel OCO order');
  console.log('   - 💥 Execute Market SELL immediately');
  console.log('');
  console.log('📊 OCO ORDER STRUCTURE:');
  console.log('- Contains TWO orders that cancel each other');
  console.log('- Order A: LIMIT sell at take profit price');
  console.log('- Order B: STOP-LIMIT sell at stop loss price');
  console.log('- When either executes, the other is automatically cancelled');
  console.log('');
  console.log('🎯 Z-SCORE REVERSAL OVERRIDE:');
  console.log('- Monitors moving average Z-score every 5 minutes');
  console.log('- If Z-score <= -threshold: Strategy invalidated');
  console.log('- Cancels OCO and forces immediate market exit');
  console.log('- Prevents losses from late OCO execution');
  console.log('');
  console.log('⚠️  TESTNET SAFETY:');
  console.log('- Uses Binance testnet for safe testing');
  console.log('- No real money at risk');
  console.log('- All API calls are identical to live trading');
  console.log('');
}

// Check for required environment variables
if (!process.env.BINANCE_TESTNET_API_KEY || !process.env.BINANCE_TESTNET_API_SECRET) {
  console.error('❌ Missing required environment variables:');
  console.error('   BINANCE_TESTNET_API_KEY');
  console.error('   BINANCE_TESTNET_API_SECRET');
  console.error('');
  console.error('Get testnet API keys from: https://testnet.binance.vision/');
  process.exit(1);
}

explainOcoFunctionality();
testLiveOcoTrading().catch(console.error);