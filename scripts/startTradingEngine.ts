#!/usr/bin/env ts-node

/**
 * Start Live Trading Engine Script
 * 
 * This script initializes and starts the live trading engine with Glicko-2 based signals.
 * It connects to the Binance API using credentials from .env and begins automated trading.
 * 
 * Usage: npm run startTrading [--paper] [--symbols="BTC,ETH,ADA"] [--parameterSets=path/to/params.json] [--useOptimizedParams] [--metric=sharpeRatio]
 * 
 * Flags:
 *   --paper: Enable paper trading mode (no real orders)
 *   --symbols: Override default symbols from .env
 *   --parameterSets: Load parameter sets from JSON file
 *   --useOptimizedParams: Load optimized parameters from database
 *   --metric: Database metric to optimize for (sharpeRatio, calmarRatio, totalReturn, alpha)
 */

import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import TradingEngine, { TradingConfig } from '../src/node-api/services/TradingEngine';
import BinanceService from '../src/node-api/services/BinanceService';
import { RustCoreService } from '../src/node-api/services/RustCoreService';
import { ParameterSetManager } from '../src/services/ParameterSetManager';
import { TradingParameterSet } from '../src/types';

config();

interface StartupConfig {
  symbols: string[];
  paperTrading: boolean;
  config: TradingConfig;
  parameterSets?: TradingParameterSet[];
  useParameterSets: boolean;
  parameterOptions: {
    parameterSetsFile: string | null;
    useOptimizedParams: boolean;
    metric: string;
  };
}

/**
 * Parse command line arguments
 */
function parseArguments(): StartupConfig {
  const args = process.argv.slice(2);
  
  let paperTrading = false;
  let customSymbols: string[] | null = null;
  let parameterSetsFile: string | null = null;
  let useOptimizedParams = false;
  let metric: string = 'sharpeRatio';
  
  for (const arg of args) {
    if (arg === '--paper') {
      paperTrading = true;
    } else if (arg.startsWith('--symbols=')) {
      const symbolsStr = arg.split('=')[1];
      customSymbols = symbolsStr.split(',').map(s => s.trim());
    } else if (arg.startsWith('--parameterSets=')) {
      parameterSetsFile = arg.split('=')[1];
    } else if (arg === '--useOptimizedParams') {
      useOptimizedParams = true;
    } else if (arg.startsWith('--metric=')) {
      metric = arg.split('=')[1];
    }
  }
  
  // Determine if using parameter sets
  const useParameterSets = !!(parameterSetsFile || useOptimizedParams);
  
  let symbols: string[] = [];
  let parameterSets: TradingParameterSet[] | undefined;
  
  if (useParameterSets) {
    // Parameter sets will provide symbols, so we'll handle this later
    symbols = [];
  } else {
    // Get symbols from environment or use custom symbols
    const envSymbols = process.env.BASE_COINS?.split(',').map(s => s.trim()) || [];
    symbols = customSymbols || envSymbols;
    
    if (symbols.length === 0) {
      console.error('❌ No symbols specified. Set BASE_COINS in .env or use --symbols flag');
      process.exit(1);
    }
    
    // Convert base coins to USDT trading pairs for signal monitoring
    symbols = symbols
      .filter(symbol => symbol !== 'USDT') // Don't trade USDT/USDT
      .map(symbol => `${symbol}USDT`);
  }
  
  const config: TradingConfig = {
    zScoreThreshold: parseFloat(process.env.Z_SCORE_THRESHOLD || '3.0'),
    movingAveragesPeriod: parseInt(process.env.MOVING_AVERAGES || '200'),
    profitPercent: parseFloat(process.env.PROFIT_PERCENT || '5.0'),
    stopLossPercent: parseFloat(process.env.STOP_LOSS_PERCENT || '2.5'),
    maxPositions: parseInt(process.env.MAX_POSITIONS || '5'),
    allocationPerPosition: parseFloat(process.env.ALLOCATION_PER_POSITION || '10.0'),
    symbols: symbols,
    enableLiveTrading: !paperTrading,
    riskManagement: {
      maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS || '100'),
      maxDrawdown: parseFloat(process.env.MAX_DRAWDOWN || '10.0'),
      cooldownPeriod: parseInt(process.env.COOLDOWN_PERIOD || '60')
    }
  };
  
  return { 
    symbols, 
    paperTrading, 
    config, 
    useParameterSets,
    parameterOptions: {
      parameterSetsFile,
      useOptimizedParams,
      metric
    }
  };
}

/**
 * Validate environment variables
 */
function validateEnvironment(): void {
  const required = ['BINANCE_API_KEY', 'BINANCE_API_SECRET', 'DATABASE_URL'];
  
  for (const envVar of required) {
    if (!process.env[envVar]) {
      console.error(`❌ Missing required environment variable: ${envVar}`);
      process.exit(1);
    }
  }
}

/**
 * Check if recent Glicko ratings are available
 */
async function checkGlickoData(prisma: PrismaClient, symbols: string[]): Promise<boolean> {
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
  
  // Convert trading symbols back to base coins for Glicko lookup
  const baseCoins = symbols.map(symbol => symbol.replace('USDT', ''));
  
  const recentRatings = await prisma.glickoRatings.findMany({
    where: {
      symbol: { in: baseCoins },
      timestamp: { gte: thirtyMinutesAgo }
    }
  });
  
  if (recentRatings.length === 0) {
    console.warn('⚠️ No recent Glicko ratings found (within last 30 minutes)');
    console.warn('   Consider running: npm run calculateGlickoRatings');
    return false;
  }
  
  console.log(`✅ Found ${recentRatings.length} recent Glicko ratings`);
  return true;
}

/**
 * Setup graceful shutdown handlers
 */
function setupShutdownHandlers(tradingEngine: TradingEngine): void {
  const shutdown = async (signal: string) => {
    console.log(`\n🛑 Received ${signal}, shutting down trading engine gracefully...`);
    
    try {
      await tradingEngine.stop();
      console.log('✅ Trading engine stopped successfully');
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
 * Display trading configuration
 */
function displayConfig(config: TradingConfig, paperTrading: boolean): void {
  console.log('📋 Trading Configuration:');
  console.log(`  Mode: ${paperTrading ? '📝 PAPER TRADING' : '💰 LIVE TRADING'}`);
  console.log(`  Symbols: ${config.symbols.join(', ')}`);
  console.log(`  Z-Score Threshold: ±${config.zScoreThreshold}`);
  console.log(`  Moving Average Period: ${config.movingAveragesPeriod}`);
  console.log(`  Profit Target: +${config.profitPercent}%`);
  console.log(`  Stop Loss: -${config.stopLossPercent}%`);
  console.log(`  Max Positions: ${config.maxPositions}`);
  console.log(`  Allocation per Position: ${config.allocationPerPosition}%`);
  console.log(`  Max Daily Loss: $${config.riskManagement.maxDailyLoss}`);
  console.log(`  Max Drawdown: ${config.riskManagement.maxDrawdown}%`);
  console.log(`  Cooldown Period: ${config.riskManagement.cooldownPeriod} minutes`);
}

/**
 * Setup event listeners for trading engine
 */
function setupEventListeners(tradingEngine: TradingEngine): void {
  tradingEngine.on('started', () => {
    console.log('🚀 Trading engine started successfully!');
  });
  
  tradingEngine.on('stopped', () => {
    console.log('🛑 Trading engine stopped');
  });
  
  tradingEngine.on('orderExecuted', (order) => {
    console.log(`💼 Order executed: ${order.side} ${order.symbol} - Qty: ${order.executedQty}`);
  });
  
  tradingEngine.on('signalsChecked', (data) => {
    const timestamp = new Date().toLocaleString();
    console.log(`📊 [${timestamp}] Signals: ${data.totalSignals} total, ${data.strongSignals} strong`);
  });
  
  tradingEngine.on('paperTrade', (signal) => {
    const timestamp = new Date().toLocaleString();
    console.log(`📝 [${timestamp}] PAPER: ${signal.signal} ${signal.symbol} (z=${signal.zScore.toFixed(2)})`);
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
  
  tradingEngine.on('signalError', (error) => {
    console.error(`❌ Signal error:`, error.message);
  });
}

/**
 * Load parameter sets using ParameterSetManager
 */
async function loadParameterSets(prisma: PrismaClient, parameterOptions: any): Promise<TradingParameterSet[]> {
  const parameterManager = new ParameterSetManager(prisma);
  const options = parameterOptions;
  
  if (options.parameterSetsFile) {
    console.log(`📁 Loading parameter sets from file: ${options.parameterSetsFile}`);
    return await parameterManager.loadParameterSets({
      source: 'file',
      filePath: options.parameterSetsFile
    });
  } else if (options.useOptimizedParams) {
    console.log(`📈 Loading optimized parameters from database (metric: ${options.metric})`);
    return await parameterManager.loadParameterSets({
      source: 'database',
      databaseQuery: {
        metric: options.metric as any,
        minTrades: 5,
        limit: 50
      }
    });
  }
  
  return [];
}

/**
 * Main execution function
 */
async function main() {
  console.log('🎯 Starting Live Trading Engine...');
  console.log('=' .repeat(70));
  
  try {
    // Validate environment
    validateEnvironment();
    
    // Parse arguments
    const { symbols: initialSymbols, paperTrading, config, useParameterSets, parameterOptions } = parseArguments();
    
    // Initialize services
    console.log('\n🔧 Initializing services...');
    
    const prisma = new PrismaClient();
    await prisma.$connect();
    console.log('✅ Connected to database');
    
    let finalSymbols = initialSymbols;
    let parameterSets: TradingParameterSet[] = [];
    
    // Load parameter sets if requested
    if (useParameterSets) {
      parameterSets = await loadParameterSets(prisma, parameterOptions);
      finalSymbols = parameterSets.filter(p => p.enabled).map(p => p.symbol);
      console.log(`📊 Loaded ${parameterSets.length} parameter sets for ${finalSymbols.length} symbols`);
    }
    
    // Update config with final symbols
    config.symbols = finalSymbols;
    
    // Display configuration
    displayConfig(config, paperTrading);
    
    // Check for recent Glicko data
    const hasRecentData = await checkGlickoData(prisma, finalSymbols);
    if (!hasRecentData && !paperTrading) {
      console.log('\n⚠️ WARNING: No recent Glicko data found. Consider running in paper mode first.');
    }
    
    // Initialize Rust core
    const rustCore = new RustCoreService();
    await rustCore.initialize();
    console.log('✅ Rust core service initialized');
    
    // Initialize Binance service
    const binanceService = new BinanceService(
      {
        apiKey: process.env.BINANCE_API_KEY!,
        apiSecret: process.env.BINANCE_API_SECRET!,
        testnet: process.env.BINANCE_TESTNET === 'true',
        paperTrading: paperTrading
      },
      prisma
    );
    console.log('✅ Binance service configured');
    
    // Create and configure trading engine
    const tradingEngine = new TradingEngine(prisma, binanceService, rustCore, config);
    
    // Pass parameter sets to trading engine if using them
    if (useParameterSets && parameterSets.length > 0) {
      (tradingEngine as any).setParameterSets(parameterSets);
      console.log(`⚙️ Trading engine configured with ${parameterSets.length} parameter sets`);
    }
    
    // Setup event listeners
    setupEventListeners(tradingEngine);
    
    // Setup shutdown handlers
    setupShutdownHandlers(tradingEngine);
    
    // Start the trading engine
    console.log('\n🚀 Starting trading engine...');
    await tradingEngine.start();
    
    console.log('\n✅ Trading engine is now running!');
    console.log('📊 Monitoring for Glicko-2 based trading signals...');
    
    // Display log file locations
    const dateStr = new Date().toISOString().split('T')[0];
    console.log('\n📄 Log files:');
    console.log(`   All logs: ./logs/${dateStr}_all.log`);
    console.log(`   Signals:  ./logs/${dateStr}_signals.log`);
    console.log(`   Trades:   ./logs/${dateStr}_paper_trade.log`);
    console.log(`   Errors:   ./logs/${dateStr}_errors.log`);
    
    console.log('\n🛑 Press Ctrl+C to stop gracefully');
    
    // Keep the process alive
    await new Promise(() => {});
    
  } catch (error) {
    console.error('\n❌ Failed to start trading engine:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { main };