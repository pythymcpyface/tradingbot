#!/usr/bin/env ts-node

/**
 * Start Live Trading with Parameter Sets
 * 
 * This script starts live trading using the parameter sets defined in config/live-params.json
 * It handles the 33.3% allocation strategy safely and provides detailed monitoring.
 */

import { config } from 'dotenv';
import TradingEngine, { TradingConfig } from '../src/node-api/services/TradingEngine';
import BinanceService from '../src/node-api/services/BinanceService';
import { RustCoreService } from '../src/node-api/services/RustCoreService';
import { TradingParameterSet } from '../src/types';
import fs from 'fs';
import path from 'path';

config();

interface LiveParamsFile {
  parameterSets: TradingParameterSet[];
}

/**
 * Write trading status to file for web dashboard
 */
function writeStatusFile(status: 'running' | 'stopped', parameterSets: TradingParameterSet[], isPaperTrading: boolean) {
  const statusFile = path.join(__dirname, '../.trading-status.json');
  const statusData = {
    status,
    mode: 'standalone',
    isPaperTrading,
    pid: process.pid,
    startTime: new Date().toISOString(),
    parameterSets,
    lastUpdate: new Date().toISOString()
  };
  
  try {
    fs.writeFileSync(statusFile, JSON.stringify(statusData, null, 2));
  } catch (error) {
    console.warn('⚠️ Failed to write status file:', (error as Error).message);
  }
}

/**
 * Load parameter sets from config/live-params.json
 */
function loadParameterSets(): TradingParameterSet[] {
  const configPath = path.join(__dirname, '../config/live-params.json');
  
  if (!fs.existsSync(configPath)) {
    console.error('❌ Config file not found: config/live-params.json');
    process.exit(1);
  }
  
  try {
    const configData = fs.readFileSync(configPath, 'utf8');
    const parsedConfig: LiveParamsFile = JSON.parse(configData);
    
    if (!parsedConfig.parameterSets || !Array.isArray(parsedConfig.parameterSets)) {
      throw new Error('Invalid config format: parameterSets must be an array');
    }
    
    return parsedConfig.parameterSets.filter(p => p.enabled !== false);
  } catch (error) {
    console.error('❌ Failed to load parameter sets:', (error as Error).message);
    process.exit(1);
  }
}

/**
 * Validate parameter sets allocation
 */
function validateAllocationStrategy(parameterSets: TradingParameterSet[]): void {
  const totalAllocation = parameterSets.reduce((sum, p) => sum + (p.allocationPercent || 0), 0);
  
  console.log('\n📊 Allocation Analysis:');
  parameterSets.forEach(p => {
    console.log(`   ${p.symbol}: ${p.allocationPercent}% (Z≥${p.zScoreThreshold}, TP:+${p.profitPercent}%, SL:-${p.stopLossPercent}%)`);
  });
  console.log(`   Total Allocation: ${totalAllocation.toFixed(1)}%`);
  
  if (Math.abs(totalAllocation - 100) > 0.1) {
    console.warn(`⚠️  Total allocation is ${totalAllocation.toFixed(1)}% (not 100%)`);
  }
  
  // Check for duplicate symbols
  const symbols = parameterSets.map(p => p.symbol);
  const duplicates = symbols.filter((s, i) => symbols.indexOf(s) !== i);
  if (duplicates.length > 0) {
    console.error('❌ Duplicate symbols found:', duplicates);
    process.exit(1);
  }
}

/**
 * Check account balance and calculate position sizes
 */
async function analyzeAccountBalance(binanceService: BinanceService, parameterSets: TradingParameterSet[]): Promise<void> {
  try {
    const account = await binanceService.getAccountInfo();
    const usdtBalance = account.balances.find((b: any) => b.asset === 'USDT');
    const availableUsdt = parseFloat(usdtBalance?.free || '0');
    
    console.log('\n💰 Account Analysis:');
    console.log(`   USDT Balance: $${availableUsdt.toFixed(2)}`);
    
    if (availableUsdt < 50) {
      console.error('❌ Insufficient USDT balance for trading (minimum $50 recommended)');
      process.exit(1);
    }
    
    console.log('\n🎯 Position Size Preview:');
    for (const params of parameterSets) {
      const allocationAmount = availableUsdt * (params.allocationPercent! / 100);
      console.log(`   ${params.symbol}: $${allocationAmount.toFixed(2)} (${params.allocationPercent}%)`);
      
      if (allocationAmount < 10) {
        console.warn(`⚠️  ${params.symbol} allocation below Binance minimum ($10)`);
      }
    }
    
  } catch (error) {
    console.error('❌ Failed to get account info:', (error as Error).message);
    process.exit(1);
  }
}

/**
 * Setup enhanced event listeners for allocation monitoring
 */
function setupEventListeners(tradingEngine: TradingEngine): void {
  tradingEngine.on('started', () => {
    console.log('🚀 Live trading engine started successfully!');
    console.log('📊 Monitoring for Z-score signals with allocation management...');
  });
  
  tradingEngine.on('stopped', () => {
    console.log('🛑 Trading engine stopped');
  });
  
  tradingEngine.on('orderExecuted', (order) => {
    console.log(`💼 Order executed: ${order.side} ${order.symbol} - Qty: ${order.executedQty}`);
    
    // Show allocation status after each trade
    setTimeout(() => {
      const status = tradingEngine.getAllocationStatus();
      console.log(`💼 Allocation: ${status.allocationPercentage.toFixed(1)}% used ($${status.totalReserved.toFixed(2)}/$${status.totalBalance.toFixed(2)})`);
    }, 1000);
  });
  
  tradingEngine.on('signalsChecked', (data) => {
    const timestamp = new Date().toLocaleString();
    console.log(`📊 [${timestamp}] Signals: ${data.totalSignals} total, ${data.strongSignals} strong`);
  });
  
  tradingEngine.on('zScoreReversal', (data) => {
    const timestamp = new Date().toLocaleString();
    console.log(`🔄 [${timestamp}] Z-Score Reversal: ${data.symbol} position closed`);
    
    // Show updated allocation status
    setTimeout(() => {
      const status = tradingEngine.getAllocationStatus();
      console.log(`💼 Funds released - Allocation: ${status.allocationPercentage.toFixed(1)}% used`);
    }, 1000);
  });
  
  tradingEngine.on('riskLimitHit', (type) => {
    console.warn(`⚠️ Risk limit hit: ${type}`);
  });
  
  tradingEngine.on('emergencyStop', () => {
    console.error('🚨 EMERGENCY STOP TRIGGERED');
  });
  
  tradingEngine.on('tradingError', (error) => {
    console.error(`❌ Trading error:`, error.message);
  });
}

/**
 * Setup graceful shutdown
 */
function setupShutdownHandlers(tradingEngine: TradingEngine): void {
  const shutdown = async (signal: string) => {
    console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
    
    try {
      // Show final allocation status
      console.log('\n📊 Final Allocation Status:');
      const status = tradingEngine.getAllocationStatus();
      console.log(JSON.stringify(status, null, 2));
      
      // Stop trading engine
      await tradingEngine.stop();
      
      // Write stopped status
      writeStatusFile('stopped', [], false);
      
      console.log('✅ Shutdown completed successfully');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  };
  
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

/**
 * Main execution
 */
async function main() {
  console.log('🎯 Starting Live Trading with Parameter Sets...');
  console.log('=' .repeat(70));
  
  try {
    // Check if paper trading mode
    const isPaperTrading = process.argv.includes('--paper');
    if (isPaperTrading) {
      console.log('📝 PAPER TRADING MODE - No real money at risk');
    } else {
      console.log('💰 LIVE TRADING MODE - Real money will be used!');
    }
    
    // Validate environment
    const requiredEnvVars = ['BINANCE_API_KEY', 'BINANCE_API_SECRET'];
    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        console.error(`❌ Missing required environment variable: ${envVar}`);
        process.exit(1);
      }
    }
    
    // Load and validate parameter sets
    console.log('\n🔧 Loading configuration...');
    const parameterSets = loadParameterSets();
    console.log(`✅ Loaded ${parameterSets.length} parameter sets`);
    
    validateAllocationStrategy(parameterSets);
    
    // Database connected for z-score history storage
    console.log('✅ Database connection established for z-score storage');
    
    // Initialize Binance service (without database dependency)
    const binanceService = new BinanceService(
      {
        apiKey: process.env.BINANCE_API_KEY!,
        apiSecret: process.env.BINANCE_API_SECRET!,
        testnet: process.env.BINANCE_TESTNET === 'true',
        paperTrading: isPaperTrading
      }
    );
    console.log('✅ Binance service configured');
    
    // Analyze account balance (only for live trading)
    if (!isPaperTrading) {
      await analyzeAccountBalance(binanceService, parameterSets);
    }
    
    // Initialize Rust core
    const rustCore = new RustCoreService();
    await rustCore.initialize();
    console.log('✅ Rust core service initialized');
    
    // Create trading configuration
    const symbols = parameterSets.map(p => p.symbol);
    const config: TradingConfig = {
      zScoreThreshold: 3.0, // Default (overridden by parameter sets)
      movingAveragesPeriod: 200, // Default (overridden by parameter sets)
      profitPercent: 5.0, // Default (overridden by parameter sets)
      stopLossPercent: 2.5, // Default (overridden by parameter sets)
      maxPositions: parameterSets.length, // Allow all parameter sets to trade
      allocationPerPosition: 0, // Not used with parameter sets
      symbols: symbols,
      enableLiveTrading: !isPaperTrading,
      riskManagement: {
        maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS || '1000'),
        maxDrawdown: parseFloat(process.env.MAX_DRAWDOWN || '20.0'),
        cooldownPeriod: parseInt(process.env.COOLDOWN_PERIOD || '60')
      }
    };
    
    // Create trading engine (without database dependency)
    const tradingEngine = new TradingEngine(binanceService, rustCore, config);
    
    // Set parameter sets
    (tradingEngine as any).setParameterSets(parameterSets);
    console.log(`⚙️ Trading engine configured with ${parameterSets.length} parameter sets`);
    
    // Setup monitoring
    setupEventListeners(tradingEngine);
    setupShutdownHandlers(tradingEngine);
    
    // Final confirmation for live trading
    if (!isPaperTrading) {
      console.log('\n⚠️  LIVE TRADING CONFIRMATION ⚠️');
      console.log('   This will trade with real money on Binance');
      console.log('   Press Ctrl+C within 10 seconds to cancel...');
      
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
    
    // Write status file
    writeStatusFile('running', parameterSets, isPaperTrading);
    
    // Start the trading engine
    console.log('\n🚀 Starting trading engine...');
    await tradingEngine.start();
    
    // Display monitoring info
    const dateStr = new Date().toISOString().split('T')[0];
    console.log('\n📄 Log files:');
    console.log(`   All logs: ./logs/${dateStr}_all.log`);
    console.log(`   Signals:  ./logs/${dateStr}_signals.log`);
    console.log(`   Positions: ./logs/${dateStr}_positions.log`);
    console.log(`   Errors:   ./logs/${dateStr}_errors.log`);
    
    console.log('\n🛑 Press Ctrl+C to stop gracefully');
    
    // Monitor for stop signal from web interface
    const stopSignalFile = path.join(__dirname, '../.stop-trading.signal');
    setInterval(() => {
      if (fs.existsSync(stopSignalFile)) {
        console.log('\n🛑 Stop signal received from web interface - shutting down gracefully...');
        
        // Clean up signal file
        try {
          fs.unlinkSync(stopSignalFile);
        } catch (error) {
          console.warn('Warning: Could not remove stop signal file:', error);
        }
        
        // Trigger graceful shutdown
        process.kill(process.pid, 'SIGINT');
      }
    }, 5000); // Check every 5 seconds
    
    // Show allocation status every 30 minutes
    setInterval(() => {
      const status = tradingEngine.getAllocationStatus();
      console.log(`\n💼 Allocation Status: ${status.allocationPercentage.toFixed(1)}% used (${status.reservations.length} active positions)`);
      if (status.reservations.length > 0) {
        status.reservations.forEach((r: any) => {
          console.log(`   ${r.symbol}: $${r.reservedAmount.toFixed(2)} reserved`);
        });
      }
    }, 30 * 60 * 1000); // Every 30 minutes
    
    // Keep process alive
    await new Promise(() => {});
    
  } catch (error) {
    console.error('\n❌ Failed to start live trading:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { main };