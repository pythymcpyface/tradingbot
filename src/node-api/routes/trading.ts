import { Router } from 'express';
import BinanceService from '../services/BinanceService';
import TradingEngine, { TradingConfig } from '../services/TradingEngine';
import { rustCore, prisma } from '../index';

const router = Router();

// Global trading engine instance
let tradingEngine: TradingEngine | null = null;
let binanceService: BinanceService | null = null;

/**
 * Store z-score data to database (same as standalone script)
 */
async function storeZScoreData(
  symbol: string, 
  timestamp: Date,
  zScore: number, 
  rating: number, 
  movingAverageZScore: number | undefined,
  zScoreThreshold: number,
  movingAveragesPeriod: number,
  isEnabledForTrading: boolean
) {
  try {
    // Validate numeric values - skip if essential values are invalid
    if (isNaN(rating) || !isFinite(rating)) {
      console.warn(`⚠️  Skipping z-score data for ${symbol}: invalid rating (${rating})`);
      return;
    }
    
    if (isNaN(zScore) || !isFinite(zScore)) {
      console.warn(`⚠️  Skipping z-score data for ${symbol}: invalid zScore (${zScore})`);
      return;
    }

    await prisma.zScoreHistory.upsert({
      where: {
        symbol_timestamp: {
          symbol,
          timestamp
        }
      },
      update: {
        zScore,
        rating,
        movingAverageZScore: isNaN(movingAverageZScore!) ? null : movingAverageZScore,
        zScoreThreshold,
        movingAveragesPeriod,
        isEnabledForTrading
      },
      create: {
        symbol,
        timestamp,
        zScore,
        rating,
        movingAverageZScore: isNaN(movingAverageZScore!) ? null : movingAverageZScore,
        zScoreThreshold,
        movingAveragesPeriod,
        isEnabledForTrading
      }
    });
  } catch (error) {
    console.error(`❌ Failed to store z-score data for ${symbol}:`, error);
  }
}

// Auto-initialize Binance service if environment variables are available
async function initializeBinanceIfPossible() {
  if (binanceService || !process.env.BINANCE_API_KEY || !process.env.BINANCE_API_SECRET) {
    return;
  }

  try {
    binanceService = new BinanceService({
      apiKey: process.env.BINANCE_API_KEY,
      apiSecret: process.env.BINANCE_API_SECRET,
      testnet: process.env.BINANCE_TESTNET === 'true',
      paperTrading: false
    });
    
    await binanceService.initialize();
    console.log('✅ Binance service auto-initialized for web API');
  } catch (error) {
    console.error('❌ Failed to auto-initialize Binance service:', error);
    binanceService = null;
  }
}

// Initialize on module load
initializeBinanceIfPossible();

// Z-score data storage for real-time graph
interface ZScoreDataPoint {
  timestamp: Date;
  zScore: number;
  symbol: string;
  rating: number;
  movingAverageZScore?: number;
}

const zScoreHistory: Map<string, ZScoreDataPoint[]> = new Map();
const MAX_HISTORY_POINTS = 200; // Keep last 200 data points per symbol

// Function to add z-score data point
function addZScoreData(symbol: string, zScore: number, rating: number, movingAverageZScore?: number) {
  if (!zScoreHistory.has(symbol)) {
    zScoreHistory.set(symbol, []);
  }
  
  const history = zScoreHistory.get(symbol)!;
  const dataPoint: ZScoreDataPoint = {
    timestamp: new Date(),
    zScore,
    symbol,
    rating,
    movingAverageZScore
  };
  
  history.push(dataPoint);
  
  // Keep only recent data points
  if (history.length > MAX_HISTORY_POINTS) {
    history.shift();
  }
}

// Function to detect if standalone live trading script is running
async function detectStandaloneLiveTrading(): Promise<{ isRunning: boolean; pid?: number; startTime?: string; isPaperTrading?: boolean; parameterSets?: any[] }> {
  try {
    const fs = require('fs');
    const path = require('path');
    
    // Check for status file first
    const statusFile = path.join(__dirname, '../../../.trading-status.json');
    if (fs.existsSync(statusFile)) {
      try {
        const statusData = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
        
        // In a container, we can't check host processes, so trust the status file
        // Check if we're in a container by looking for /.dockerenv
        const isInContainer = fs.existsSync('/.dockerenv');
        
        if (statusData.pid && !isInContainer) {
          const { exec } = require('child_process');
          const util = require('util');
          const execPromise = util.promisify(exec);
          
          try {
            await execPromise(`ps -p ${statusData.pid}`);
            return {
              isRunning: statusData.status === 'running',
              pid: statusData.pid,
              startTime: statusData.startTime,
              isPaperTrading: statusData.isPaperTrading,
              parameterSets: statusData.parameterSets
            };
          } catch {
            // Process no longer running, clean up status file
            fs.unlinkSync(statusFile);
          }
        } else {
          // Trust status file when in container or no PID
          return {
            isRunning: statusData.status === 'running',
            pid: statusData.pid,
            startTime: statusData.startTime,
            isPaperTrading: statusData.isPaperTrading,
            parameterSets: statusData.parameterSets
          };
        }
      } catch (error) {
        console.warn('Error reading status file:', error);
      }
    }
    
    // Fallback to process detection
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    // Check for running startLiveTrading processes
    const { stdout } = await execPromise('ps aux | grep -E "startLiveTrading" | grep -v grep');
    const lines = stdout.trim().split('\n').filter((line: string) => line.length > 0);
    
    if (lines.length > 0) {
      const processLine = lines[0];
      const parts = processLine.trim().split(/\s+/);
      const pid = parseInt(parts[1]);
      const startTime = parts[8]; // Process start time
      const isPaperTrading = processLine.includes('--paper');
      
      return {
        isRunning: true,
        pid,
        startTime,
        isPaperTrading
      };
    }
    
    return { isRunning: false };
  } catch (error) {
    console.warn('Could not detect standalone trading process:', error);
    return { isRunning: false };
  }
}

/**
 * POST /api/trading/initialize - Initialize trading services
 */
router.post('/initialize', async (req, res) => {
  try {
    const { apiKey, apiSecret, testnet = true } = req.body;

    if (!apiKey || !apiSecret) {
      return res.status(400).json({
        error: 'API key and secret are required'
      });
    }

    // Initialize Binance service
    binanceService = new BinanceService(
      { apiKey, apiSecret, testnet }
    );

    await binanceService.initialize();

    res.json({
      message: 'Trading services initialized successfully',
      testnet,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error initializing trading services:', error);
    res.status(500).json({ error: 'Failed to initialize trading services' });
  }
});

/**
 * Load parameter sets from config/live-params.json (same as standalone script)
 */
function loadParameterSets(): any[] {
  const fs = require('fs');
  const path = require('path');
  const configPath = path.join(__dirname, '../../../config/live-params.json');
  
  if (!fs.existsSync(configPath)) {
    console.warn('⚠️ Config file not found: config/live-params.json, using defaults');
    return [];
  }
  
  try {
    const configData = fs.readFileSync(configPath, 'utf8');
    const parsedConfig = JSON.parse(configData);
    
    if (!parsedConfig.parameterSets || !Array.isArray(parsedConfig.parameterSets)) {
      console.warn('⚠️ Invalid config format: parameterSets must be an array');
      return [];
    }
    
    return parsedConfig.parameterSets.filter((p: any) => p.enabled !== false);
  } catch (error) {
    console.error('❌ Failed to load parameter sets:', (error as Error).message);
    return [];
  }
}

/**
 * POST /api/trading/start - Start the trading engine
 */
router.post('/start', async (req, res) => {
  try {
    if (!binanceService) {
      return res.status(400).json({
        error: 'Trading services not initialized. Call /initialize first.'
      });
    }

    // Load parameter sets (same as standalone script)
    const parameterSets = loadParameterSets();
    console.log(`📋 Loaded ${parameterSets.length} parameter sets for web interface trading`);

    // Extract symbols from parameter sets
    const symbols = parameterSets.length > 0 
      ? parameterSets.map((p: any) => p.symbol)
      : req.body.symbols || ['BTCUSDT', 'ETHUSDT'];

    const config: TradingConfig = {
      zScoreThreshold: req.body.zScoreThreshold || 3.0,
      movingAveragesPeriod: req.body.movingAveragesPeriod || 200,
      profitPercent: req.body.profitPercent || 5.0,
      stopLossPercent: req.body.stopLossPercent || 2.5,
      maxPositions: parameterSets.length > 0 ? parameterSets.length : (req.body.maxPositions || 5),
      allocationPerPosition: parameterSets.length > 0 ? 0 : (req.body.allocationPerPosition || 0.1), // Not used with parameter sets
      symbols: symbols,
      enableLiveTrading: req.body.enableLiveTrading || false,
      riskManagement: {
        maxDailyLoss: req.body.maxDailyLoss || 1000,
        maxDrawdown: req.body.maxDrawdown || 20.0,
        cooldownPeriod: req.body.cooldownPeriod || 60
      }
    };

    // Create trading engine if it doesn't exist
    if (!tradingEngine) {
      tradingEngine = new TradingEngine(binanceService, rustCore, config);
      
      // Set parameter sets if available (same as standalone script)
      if (parameterSets.length > 0) {
        (tradingEngine as any).setParameterSets(parameterSets);
        console.log(`⚙️ Trading engine configured with ${parameterSets.length} parameter sets`);
      }
      
      // Set up event listeners
      tradingEngine.on('orderExecuted', (order) => {
        console.log('Order executed:', order.symbol, order.side);
      });

      tradingEngine.on('signalsChecked', (data) => {
        console.log(`Signals checked: ${data.strongSignals}/${data.totalSignals} strong signals`);
      });

      tradingEngine.on('riskLimitHit', (type) => {
        console.log(`Risk limit hit: ${type}`);
      });

      // Store z-score data to database (critical for chart display)
      tradingEngine.on('zScoreCalculated', async (data) => {
        await storeZScoreData(
          data.symbol,
          data.timestamp,
          data.zScore,
          data.rating,
          data.movingAverageZScore,
          data.zScoreThreshold,
          data.movingAveragesPeriod,
          data.isEnabledForTrading
        );
      });
    }

    await tradingEngine.start();

    res.json({
      message: 'Trading engine started successfully',
      config,
      parameterSets: parameterSets.length,
      symbols: symbols,
      state: tradingEngine.getState(),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error starting trading engine:', error);
    res.status(500).json({ error: 'Failed to start trading engine' });
  }
});

/**
 * POST /api/trading/stop - Stop the trading engine
 */
router.post('/stop', async (req, res) => {
  try {
    // Check for standalone trading process first
    const standaloneTrading = await detectStandaloneLiveTrading();
    
    if (standaloneTrading.isRunning) {
      // Stop standalone trading process
      try {
        const fs = require('fs');
        const { exec } = require('child_process');
        const util = require('util');
        const execPromise = util.promisify(exec);
        
        if (standaloneTrading.pid) {
          // Create a stop signal file that the trading process will monitor
          const fs = require('fs');
          const stopSignalFile = require('path').join('/app/shared', '.stop-trading.signal');
          const statusFile = require('path').join(__dirname, '../../../.trading-status.json');
          
          // Write stop signal
          fs.writeFileSync(stopSignalFile, JSON.stringify({
            timestamp: new Date().toISOString(),
            requestedBy: 'web-interface',
            pid: standaloneTrading.pid
          }));
          
          // Update status to indicate stopping
          if (fs.existsSync(statusFile)) {
            const currentStatus = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
            currentStatus.status = 'stopping';
            currentStatus.lastUpdate = new Date().toISOString();
            fs.writeFileSync(statusFile, JSON.stringify(currentStatus, null, 2));
          }
          
          return res.json({
            message: 'Stop signal sent to standalone trading process',
            pid: standaloneTrading.pid,
            note: 'The trading process will stop gracefully when it detects the signal',
            timestamp: new Date().toISOString()
          });
        }
      } catch (killError) {
        console.error('Error stopping standalone process:', killError);
        return res.status(500).json({ 
          error: 'Failed to stop standalone trading process',
          details: killError instanceof Error ? killError.message : String(killError)
        });
      }
    }
    
    // Check for API-managed trading engine
    if (!tradingEngine) {
      return res.status(400).json({
        error: 'No trading engine running (neither standalone nor API-managed)'
      });
    }

    await tradingEngine.stop();

    res.json({
      message: 'API trading engine stopped successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error stopping trading engine:', error);
    res.status(500).json({ error: 'Failed to stop trading engine' });
  }
});

/**
 * POST /api/trading/emergency-stop - Emergency stop all trading
 */
router.post('/emergency-stop', async (req, res) => {
  try {
    if (!tradingEngine) {
      return res.status(400).json({
        error: 'Trading engine not running'
      });
    }

    await tradingEngine.emergencyStop();

    res.json({
      message: 'Emergency stop executed successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error executing emergency stop:', error);
    res.status(500).json({ error: 'Failed to execute emergency stop' });
  }
});

/**
 * GET /api/trading/status - Get trading engine status
 */
router.get('/status', async (req, res) => {
  try {
    // Check for standalone live trading process
    const standaloneTrading = await detectStandaloneLiveTrading();
    
    if (!tradingEngine) {
      // No web API trading engine, but check for standalone process
      if (standaloneTrading.isRunning) {
        const tradingMode = standaloneTrading.isPaperTrading ? 'Paper Trading' : 'Live Trading';
        const parameterCount = standaloneTrading.parameterSets?.length || 0;
        
        return res.json({
          status: 'running',
          mode: 'standalone',
          binanceConnected: binanceService?.isReady() || false,
          message: `${tradingMode} active via standalone script (PID: ${standaloneTrading.pid})`,
          hasLiveData: binanceService?.isReady() || false,
          processInfo: standaloneTrading,
          isPaperTrading: standaloneTrading.isPaperTrading,
          parameterSets: standaloneTrading.parameterSets,
          activeParameters: parameterCount
        });
      } else {
        return res.json({
          status: 'stopped',
          binanceConnected: binanceService?.isReady() || false,
          message: 'Trading engine not initialized - Binance data available',
          hasLiveData: binanceService?.isReady() || false
        });
      }
    }

    const state = tradingEngine.getState();
    const config = tradingEngine.getConfig();
    const positions = await tradingEngine.getActivePositions();

    res.json({
      status: state.isRunning ? 'running' : 'stopped',
      state,
      config,
      positions,
      binanceConnected: binanceService?.isReady() || false,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting trading status:', error);
    res.status(500).json({ error: 'Failed to get trading status' });
  }
});

/**
 * PUT /api/trading/config - Update trading configuration
 */
router.put('/config', async (req, res) => {
  try {
    if (!tradingEngine) {
      return res.status(400).json({
        error: 'Trading engine not initialized'
      });
    }

    const updates = req.body;
    tradingEngine.updateConfig(updates);

    res.json({
      message: 'Trading configuration updated successfully',
      config: tradingEngine.getConfig(),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error updating trading config:', error);
    res.status(500).json({ error: 'Failed to update trading configuration' });
  }
});

/**
 * GET /api/trading/signals - Get current trading signals
 */
router.get('/signals', async (req, res) => {
  try {
    const { symbols, threshold = '2.0', movingAverages = '200' } = req.query;

    let symbolList: string[] = [];
    if (symbols) {
      symbolList = (symbols as string).split(',').map(s => s.trim());
    } else if (tradingEngine) {
      symbolList = tradingEngine.getConfig().symbols;
    } else {
      symbolList = ['BTCUSDT', 'ETHUSDT']; // Default symbols
    }

    // NOTE: Database-independent mode - return current trading engine signals if available
    let strongSignals: any[] = [];
    let zScores: any[] = [];
    
    if (tradingEngine) {
      // Get current signals from the trading engine (real-time calculated)
      strongSignals = tradingEngine.getState().activeSignals || [];
      // Convert to expected format
      zScores = strongSignals.map(signal => ({
        symbol: signal.symbol,
        zScore: signal.zScore,
        rating: signal.currentRating,
        timestamp: signal.timestamp
      }));
    } else {
      console.warn('Trading engine not initialized - returning empty signals');
    }

    res.json({
      allSignals: zScores,
      strongSignals,
      parameters: {
        threshold: parseFloat(threshold as string),
        movingAverages: parseInt(movingAverages as string)
      },
      currentState: tradingEngine?.getState().activeSignals || [],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting trading signals:', error);
    res.status(500).json({ error: 'Failed to get trading signals' });
  }
});

/**
 * POST /api/trading/manual-order - Place a manual order
 */
router.post('/manual-order', async (req, res) => {
  try {
    if (!binanceService) {
      return res.status(400).json({
        error: 'Binance service not initialized'
      });
    }

    const {
      symbol,
      side,
      type,
      quantity,
      quoteOrderQty,
      price,
      stopPrice,
      stopLimitPrice,
      timeInForce
    } = req.body;

    if (!symbol || !side || !type) {
      return res.status(400).json({
        error: 'symbol, side, and type are required'
      });
    }

    const order = await binanceService.placeOrder({
      symbol,
      side,
      type,
      quantity,
      quoteOrderQty,
      price,
      stopPrice,
      stopLimitPrice,
      timeInForce
    });

    res.json({
      message: 'Order placed successfully',
      order,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error placing manual order:', error);
    res.status(500).json({ error: 'Failed to place manual order' });
  }
});

/**
 * GET /api/trading/prices/:symbol - Get current price for a symbol
 */
router.get('/prices/:symbol', async (req, res) => {
  try {
    if (!binanceService) {
      return res.status(400).json({
        error: 'Binance service not initialized'
      });
    }

    const { symbol } = req.params;
    const price = await binanceService.getCurrentPrice(symbol);

    res.json({
      symbol,
      price,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting current price:', error);
    res.status(500).json({ error: 'Failed to get current price' });
  }
});

/**
 * GET /api/trading/prices - Get current prices for multiple symbols
 */
router.get('/prices', async (req, res) => {
  try {
    if (!binanceService) {
      return res.status(400).json({
        error: 'Binance service not initialized'
      });
    }

    const { symbols } = req.query;
    let symbolList: string[] | undefined;
    
    if (symbols) {
      symbolList = (symbols as string).split(',').map(s => s.trim());
    }

    const prices = await binanceService.getCurrentPrices(symbolList);
    const pricesObj = Object.fromEntries(prices);

    res.json({
      prices: pricesObj,
      count: prices.size,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting current prices:', error);
    res.status(500).json({ error: 'Failed to get current prices' });
  }
});

/**
 * GET /api/trading/positions - Get current positions
 */
router.get('/positions', async (req, res) => {
  try {
    let positions = [];
    
    if (tradingEngine) {
      // Use trading engine if available
      const positionsMap = await tradingEngine.getActivePositions();
      positions = Array.from(positionsMap.values());
    } else if (binanceService) {
      // Fallback to direct Binance API
      const accountInfo = await binanceService.getAccountInfo();
      positions = accountInfo.balances
        .filter((balance: any) => parseFloat(balance.free) > 0 || parseFloat(balance.locked) > 0)
        .map((balance: any) => ({
          symbol: balance.asset + 'USDT',
          quantity: parseFloat(balance.free) + parseFloat(balance.locked),
          avgPrice: 0, // Would need to calculate from trade history
          currentPrice: 0,
          asset: balance.asset,
          free: parseFloat(balance.free),
          locked: parseFloat(balance.locked)
        }));
    } else {
      return res.status(400).json({
        error: 'No trading services available'
      });
    }

    res.json({
      positions,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting positions:', error);
    res.status(500).json({ error: 'Failed to get positions' });
  }
});

/**
 * POST /api/trading/sync-klines - Sync klines data from Binance
 */
router.post('/sync-klines', async (req, res) => {
  try {
    if (!binanceService) {
      return res.status(400).json({
        error: 'Binance service not initialized'
      });
    }

    const { 
      symbols, 
      startTime, 
      endTime = Date.now(),
      interval = '1h'
    } = req.body;

    if (!symbols || !Array.isArray(symbols)) {
      return res.status(400).json({
        error: 'symbols array is required'
      });
    }

    if (!startTime) {
      return res.status(400).json({
        error: 'startTime is required'
      });
    }

    let totalSynced = 0;

    for (const symbol of symbols) {
      try {
        const klines = await binanceService.getKlines(
          symbol,
          interval,
          new Date(startTime).getTime(),
          new Date(endTime).getTime()
        );

        // NOTE: Database-independent mode - just count the fetched data
        totalSynced += klines?.length || 0;
        console.log(`Fetched ${klines?.length || 0} klines for ${symbol} (database-independent mode)`);

      } catch (error) {
        console.error(`Error syncing klines for ${symbol}:`, error);
      }
    }

    res.json({
      message: 'Klines sync completed',
      totalSynced,
      symbols,
      timeRange: {
        start: new Date(startTime),
        end: new Date(endTime)
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error syncing klines:', error);
    res.status(500).json({ error: 'Failed to sync klines' });
  }
});

/**
 * GET /api/trading/z-scores - Get historical z-score data for graphing
 */
router.get('/z-scores', async (req, res) => {
  try {
    const { symbols, hours = '1', enabledOnly = 'false' } = req.query;
    const hoursBack = parseInt(hours as string);
    const cutoffTime = new Date(Date.now() - (hoursBack * 60 * 60 * 1000));
    const showEnabledOnly = enabledOnly === 'true';
    
    let symbolList: string[] = [];
    
    if (symbols) {
      // Use specified symbols
      symbolList = (symbols as string).split(',').map(s => s.trim());
    } else {
      // Get all symbols that have z-score data in database
      const uniqueSymbols = await prisma.zScoreHistory.findMany({
        select: { symbol: true },
        distinct: ['symbol'],
        orderBy: { symbol: 'asc' }
      });
      symbolList = uniqueSymbols.map(row => row.symbol);
    }
    
    const result: Record<string, ZScoreDataPoint[]> = {};
    
    // Build where conditions
    const whereConditions: any = {
      timestamp: {
        gte: cutoffTime
      }
    };
    
    if (symbolList.length > 0) {
      whereConditions.symbol = { in: symbolList };
    }
    
    if (showEnabledOnly) {
      whereConditions.isEnabledForTrading = true;
    }
    
    // Fetch z-score data from database
    const zScoreRecords = await prisma.zScoreHistory.findMany({
      where: whereConditions,
      orderBy: [
        { symbol: 'asc' },
        { timestamp: 'asc' }
      ]
    });
    
    // Group by symbol
    for (const record of zScoreRecords) {
      if (!result[record.symbol]) {
        result[record.symbol] = [];
      }
      
      result[record.symbol].push({
        timestamp: record.timestamp,
        zScore: parseFloat(record.zScore.toString()),
        symbol: record.symbol,
        rating: parseFloat(record.rating.toString()),
        movingAverageZScore: record.movingAverageZScore ? parseFloat(record.movingAverageZScore.toString()) : undefined
      });
    }
    
    // Get enabled symbols for metadata
    const enabledSymbols = await prisma.zScoreHistory.findMany({
      select: { symbol: true },
      where: {
        isEnabledForTrading: true,
        timestamp: { gte: cutoffTime }
      },
      distinct: ['symbol']
    });
    
    res.json({
      data: result,
      symbols: Object.keys(result).sort(),
      enabledSymbols: enabledSymbols.map(s => s.symbol).sort(),
      totalRecords: zScoreRecords.length,
      timeRange: {
        from: cutoffTime,
        to: new Date()
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error getting z-score data:', error);
    res.status(500).json({ error: 'Failed to get z-score data' });
  }
});

export { router as tradingRouter };