import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { rustCore } from '../index';
import { BacktestConfig } from '../../types';

const router = Router();
const prisma = new PrismaClient();

/**
 * GET /api/backtest - Fetch all backtest results
 * Returns empty results if backtest tables don't exist (production schema)
 */
router.get('/', async (req, res) => {
  try {
    // Check if we're using production schema (no backtest tables)
    const hasBacktestTables = 'optimizationResults' in prisma;
    
    if (!hasBacktestTables) {
      return res.json({
        results: [],
        pagination: {
          total: 0,
          limit: 50,
          offset: 0
        },
        message: 'Backtest data not available in production mode'
      });
    }

    const { baseAsset, quoteAsset, limit = '50', offset = '0' } = req.query;
    
    const where: any = {};
    if (baseAsset) where.baseAsset = baseAsset;
    if (quoteAsset) where.quoteAsset = quoteAsset;

    const [results, total] = await Promise.all([
      (prisma as any).optimizationResults.findMany({
        where,
        include: {
          backtestRun: {
            include: {
              orders: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: parseInt(limit as string),
        skip: parseInt(offset as string)
      }),
      (prisma as any).optimizationResults.count({ where })
    ]);

    res.json({
      results,
      pagination: {
        total,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string)
      }
    });
  } catch (error) {
    console.error('Error fetching backtest results:', error);
    res.status(500).json({ error: 'Failed to fetch backtest results' });
  }
});

/**
 * POST /api/backtest/run - Run a new backtest
 */
router.post('/run', async (req, res) => {
  try {
    const {
      baseAsset,
      quoteAsset,
      zScoreThreshold,
      movingAverages,
      profitPercent,
      stopLossPercent,
      startTime,
      endTime,
      windowSize
    } = req.body;

    // Validate required parameters
    if (!baseAsset || !quoteAsset || !zScoreThreshold || !movingAverages || 
        !profitPercent || !stopLossPercent || !startTime || !endTime) {
      return res.status(400).json({ 
        error: 'Missing required parameters' 
      });
    }

    // Check if we're using production schema (no backtest tables)
    const hasBacktestTables = 'backtestRuns' in prisma;
    
    if (!hasBacktestTables) {
      return res.status(501).json({
        error: 'Backtest functionality not available in production mode',
        message: 'This endpoint requires the full development schema'
      });
    }

    // Create backtest run record
    const backtestRun = await (prisma as any).backtestRuns.create({
      data: {
        baseAsset,
        quoteAsset,
        zScoreThreshold,
        movingAverages,
        profitPercent,
        stopLossPercent,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        windowSize: windowSize || 12
      }
    });

    // Fetch Glicko ratings for the specified period
    const symbol = `${baseAsset}USDT`;
    const ratings = await prisma.glickoRatings.findMany({
      where: {
        symbol,
        timestamp: {
          gte: new Date(startTime),
          lte: new Date(endTime)
        }
      },
      orderBy: {
        timestamp: 'asc'
      }
    });

    if (ratings.length === 0) {
      return res.status(400).json({ 
        error: 'No Glicko ratings found for the specified period and symbol' 
      });
    }

    // Convert to the format expected by Rust
    const glickoRatings = ratings.map(r => ({
      id: r.id,
      symbol: r.symbol,
      timestamp: r.timestamp,
      rating: parseFloat(r.rating.toString()),
      ratingDeviation: parseFloat(r.ratingDeviation.toString()),
      volatility: parseFloat(r.volatility.toString()),
      performanceScore: parseFloat(r.performanceScore.toString())
    }));

    const config: BacktestConfig = {
      baseAsset,
      quoteAsset,
      zScoreThreshold,
      movingAverages,
      profitPercent,
      stopLossPercent,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      windowSize
    };

    // Run backtest using Rust core
    const backtestResult = await rustCore.runBacktest(config, glickoRatings);

    // Save backtest orders
    if (backtestResult.orders.length > 0) {
      await (prisma as any).backtestOrders.createMany({
        data: backtestResult.orders.map(order => ({
          runId: backtestRun.id,
          symbol: order.symbol,
          side: order.side === 'BUY' ? 'BUY' : 'SELL',
          quantity: order.quantity,
          price: order.price,
          timestamp: new Date(order.timestamp),
          reason: order.reason as any,
          profitLoss: order.profitLoss || null,
          profitLossPercent: order.profitLossPercent || null
        }))
      });
    }

    // Save optimization result
    const optimizationResult = await (prisma as any).optimizationResults.create({
      data: {
        runId: backtestRun.id,
        baseAsset,
        quoteAsset,
        zScoreThreshold,
        movingAverages,
        profitPercent,
        stopLossPercent,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        totalReturn: backtestResult.metrics.totalReturn,
        annualizedReturn: backtestResult.metrics.annualizedReturn,
        sharpeRatio: backtestResult.metrics.sharpeRatio,
        sortinoRatio: backtestResult.metrics.sortinoRatio,
        alpha: backtestResult.metrics.alpha,
        maxDrawdown: backtestResult.metrics.maxDrawdown,
        winRatio: backtestResult.metrics.winRatio,
        totalTrades: backtestResult.metrics.totalTrades,
        profitFactor: backtestResult.metrics.profitFactor,
        avgTradeDuration: backtestResult.metrics.avgTradeDuration
      }
    });

    res.json({
      backtestRunId: backtestRun.id,
      optimizationResultId: optimizationResult.id,
      result: backtestResult
    });

  } catch (error) {
    console.error('Error running backtest:', error);
    res.status(500).json({ error: 'Failed to run backtest' });
  }
});

/**
 * POST /api/backtest/windowed - Run windowed backtest
 */
router.post('/windowed', async (req, res) => {
  try {
    const config = req.body as BacktestConfig;

    // Fetch Glicko ratings
    const symbol = `${config.baseAsset}USDT`;
    const ratings = await prisma.glickoRatings.findMany({
      where: {
        symbol,
        timestamp: {
          gte: config.startTime,
          lte: config.endTime
        }
      },
      orderBy: {
        timestamp: 'asc'
      }
    });

    if (ratings.length === 0) {
      return res.status(400).json({ 
        error: 'No Glicko ratings found for the specified period and symbol' 
      });
    }

    // Convert to the format expected by Rust
    const glickoRatings = ratings.map(r => ({
      id: r.id,
      symbol: r.symbol,
      timestamp: r.timestamp,
      rating: parseFloat(r.rating.toString()),
      ratingDeviation: parseFloat(r.ratingDeviation.toString()),
      volatility: parseFloat(r.volatility.toString()),
      performanceScore: parseFloat(r.performanceScore.toString())
    }));

    // Run windowed backtest
    const results = await rustCore.runWindowedBacktest(config, glickoRatings);

    res.json({
      windows: results.length,
      results
    });

  } catch (error) {
    console.error('Error running windowed backtest:', error);
    res.status(500).json({ error: 'Failed to run windowed backtest' });
  }
});

/**
 * GET /api/backtest/:id/orders - Get orders for a specific backtest run
 */
router.get('/:id/orders', async (req, res) => {
  try {
    const { id } = req.params;
    
    const orders = await (prisma as any).backtestOrders.findMany({
      where: {
        runId: id
      },
      orderBy: {
        timestamp: 'asc'
      }
    });

    res.json(orders);
  } catch (error) {
    console.error('Error fetching backtest orders:', error);
    res.status(500).json({ error: 'Failed to fetch backtest orders' });
  }
});

export { router as backtestRouter };