import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import BinanceService from '../services/BinanceService';
import TradingEngine, { TradingConfig } from '../services/TradingEngine';
import { rustCore } from '../index';

const router = Router();
const prisma = new PrismaClient();

// Global trading engine instance
let tradingEngine: TradingEngine | null = null;
let binanceService: BinanceService | null = null;

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
      { apiKey, apiSecret, testnet },
      prisma
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
 * POST /api/trading/start - Start the trading engine
 */
router.post('/start', async (req, res) => {
  try {
    if (!binanceService) {
      return res.status(400).json({
        error: 'Trading services not initialized. Call /initialize first.'
      });
    }

    const config: TradingConfig = {
      zScoreThreshold: req.body.zScoreThreshold || 2.5,
      movingAveragesPeriod: req.body.movingAveragesPeriod || 200,
      profitPercent: req.body.profitPercent || 5.0,
      stopLossPercent: req.body.stopLossPercent || 2.5,
      maxPositions: req.body.maxPositions || 5,
      allocationPerPosition: req.body.allocationPerPosition || 0.1,
      symbols: req.body.symbols || ['BTCUSDT', 'ETHUSDT'],
      enableLiveTrading: req.body.enableLiveTrading || false,
      riskManagement: {
        maxDailyLoss: req.body.maxDailyLoss || 100,
        maxDrawdown: req.body.maxDrawdown || 10,
        cooldownPeriod: req.body.cooldownPeriod || 60
      }
    };

    // Create trading engine if it doesn't exist
    if (!tradingEngine) {
      tradingEngine = new TradingEngine(prisma, binanceService, rustCore, config);
      
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
    }

    await tradingEngine.start();

    res.json({
      message: 'Trading engine started successfully',
      config,
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
    if (!tradingEngine) {
      return res.status(400).json({
        error: 'Trading engine not running'
      });
    }

    await tradingEngine.stop();

    res.json({
      message: 'Trading engine stopped successfully',
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
    if (!tradingEngine) {
      return res.json({
        status: 'stopped',
        binanceConnected: binanceService?.isReady() || false,
        message: 'Trading engine not initialized'
      });
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

    // Get recent ratings
    const ratings = await prisma.glickoRatings.findMany({
      where: {
        symbol: { in: symbolList },
        timestamp: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) }
      },
      orderBy: [
        { symbol: 'asc' },
        { timestamp: 'desc' }
      ]
    });

    // Calculate z-scores
    const zScores = await rustCore.calculateZScores(
      ratings.map(r => ({
        symbol: r.symbol,
        timestamp: r.timestamp,
        rating: parseFloat(r.rating.toString()),
        ratingDeviation: parseFloat(r.ratingDeviation.toString()),
        volatility: parseFloat(r.volatility.toString()),
        performanceScore: parseFloat(r.performanceScore.toString())
      })),
      parseInt(movingAverages as string)
    );

    const strongSignals = zScores.filter(z => 
      Math.abs(z.zScore) >= parseFloat(threshold as string)
    );

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
    if (!tradingEngine) {
      return res.status(400).json({
        error: 'Trading engine not initialized'
      });
    }

    const positions = await tradingEngine.getActivePositions();

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

        // Save to database
        const saved = await prisma.klines.createMany({
          data: klines,
          skipDuplicates: true
        });

        totalSynced += saved.count;
        console.log(`Synced ${saved.count} klines for ${symbol}`);

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

export { router as tradingRouter };