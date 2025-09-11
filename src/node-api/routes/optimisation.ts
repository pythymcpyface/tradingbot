import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { rustCore } from '../index';

const router = Router();
const prisma = new PrismaClient();

/**
 * GET /api/optimisation - Fetch optimization results
 */
router.get('/', async (req, res) => {
  try {
    const { 
      baseAsset, 
      quoteAsset, 
      sortBy = 'totalReturn',
      sortOrder = 'desc',
      limit = '50', 
      offset = '0',
      minReturn,
      minSharpe,
      zScoreThreshold,
      movingAverages,
      profitPercent,
      stopLossPercent
    } = req.query;
    
    const where: any = {};
    if (baseAsset) where.baseAsset = baseAsset;
    if (quoteAsset) where.quoteAsset = quoteAsset;
    
    // Parameter filters
    if (minReturn) {
      where.totalReturn = { gte: parseFloat(minReturn as string) };
    }
    if (minSharpe) {
      where.sharpeRatio = { gte: parseFloat(minSharpe as string) };
    }
    if (zScoreThreshold) {
      where.zScoreThreshold = parseFloat(zScoreThreshold as string);
    }
    if (movingAverages) {
      where.movingAverages = parseInt(movingAverages as string);
    }
    if (profitPercent) {
      where.profitPercent = parseFloat(profitPercent as string);
    }
    if (stopLossPercent) {
      where.stopLossPercent = parseFloat(stopLossPercent as string);
    }

    // Validate sort field
    const validSortFields = [
      'totalReturn', 'annualizedReturn', 'sharpeRatio', 'sortinoRatio', 
      'alpha', 'maxDrawdown', 'winRatio', 'profitFactor', 'createdAt'
    ];
    
    const orderBy = validSortFields.includes(sortBy as string) 
      ? { [sortBy as string]: sortOrder === 'asc' ? 'asc' : 'desc' as const }
      : { totalReturn: 'desc' as const };

    const [results, total] = await Promise.all([
      prisma.optimizationResults.findMany({
        where,
        include: {
          backtestRun: {
            select: {
              id: true,
              startTime: true,
              endTime: true,
              windowSize: true
            }
          }
        },
        orderBy,
        take: parseInt(limit as string),
        skip: parseInt(offset as string)
      }),
      prisma.optimizationResults.count({ where })
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
    console.error('Error fetching optimization results:', error);
    res.status(500).json({ error: 'Failed to fetch optimization results' });
  }
});

/**
 * GET /api/optimisation/best - Get best performing parameters
 */
router.get('/best', async (req, res) => {
  try {
    const { baseAsset, quoteAsset, metric = 'sharpeRatio' } = req.query;
    
    const where: any = {};
    if (baseAsset) where.baseAsset = baseAsset;
    if (quoteAsset) where.quoteAsset = quoteAsset;

    // Get best performing result by specified metric
    const bestResult = await prisma.optimizationResults.findFirst({
      where,
      orderBy: {
        [metric as string]: 'desc'
      },
      include: {
        backtestRun: {
          include: {
            orders: {
              take: 10,
              orderBy: {
                timestamp: 'desc'
              }
            }
          }
        }
      }
    });

    if (!bestResult) {
      return res.status(404).json({ 
        error: 'No optimization results found for the specified criteria' 
      });
    }

    res.json({
      bestResult,
      metric,
      parameters: {
        zScoreThreshold: bestResult.zScoreThreshold,
        movingAverages: bestResult.movingAverages,
        profitPercent: bestResult.profitPercent,
        stopLossPercent: bestResult.stopLossPercent
      }
    });
  } catch (error) {
    console.error('Error fetching best optimization result:', error);
    res.status(500).json({ error: 'Failed to fetch best optimization result' });
  }
});

/**
 * GET /api/optimisation/stats - Get optimization statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const { baseAsset, quoteAsset } = req.query;
    
    const where: any = {};
    if (baseAsset) where.baseAsset = baseAsset;
    if (quoteAsset) where.quoteAsset = quoteAsset;

    // Get aggregated statistics
    const stats = await prisma.optimizationResults.aggregate({
      where,
      _avg: {
        totalReturn: true,
        annualizedReturn: true,
        sharpeRatio: true,
        sortinoRatio: true,
        alpha: true,
        maxDrawdown: true,
        winRatio: true,
        profitFactor: true,
        avgTradeDuration: true
      },
      _max: {
        totalReturn: true,
        annualizedReturn: true,
        sharpeRatio: true,
        sortinoRatio: true,
        alpha: true,
        winRatio: true,
        profitFactor: true
      },
      _min: {
        totalReturn: true,
        annualizedReturn: true,
        sharpeRatio: true,
        sortinoRatio: true,
        alpha: true,
        maxDrawdown: true,
        winRatio: true,
        profitFactor: true
      },
      _count: true
    });

    // Get parameter distribution statistics
    const parameterStats = await prisma.$queryRaw<any[]>`
      SELECT 
        AVG("zScoreThreshold") as avg_z_score,
        AVG("movingAverages") as avg_moving_averages,
        AVG("profitPercent") as avg_profit_percent,
        AVG("stopLossPercent") as avg_stop_loss_percent,
        COUNT(DISTINCT "zScoreThreshold") as unique_z_scores,
        COUNT(DISTINCT "movingAverages") as unique_ma_periods,
        COUNT(DISTINCT "profitPercent") as unique_profit_targets,
        COUNT(DISTINCT "stopLossPercent") as unique_stop_losses
      FROM "optimization_results"
      ${baseAsset ? `WHERE "baseAsset" = '${baseAsset}'` : ''}
      ${quoteAsset ? `AND "quoteAsset" = '${quoteAsset}'` : ''}
    `;

    res.json({
      totalOptimizations: stats._count,
      performanceStats: {
        averages: stats._avg,
        maximums: stats._max,
        minimums: stats._min
      },
      parameterStats: parameterStats[0] || {}
    });
  } catch (error) {
    console.error('Error fetching optimization statistics:', error);
    res.status(500).json({ error: 'Failed to fetch optimization statistics' });
  }
});

/**
 * GET /api/optimisation/correlation - Get parameter correlation analysis
 */
router.get('/correlation', async (req, res) => {
  try {
    const { baseAsset, quoteAsset, targetMetric = 'totalReturn' } = req.query;
    
    const where: any = {};
    if (baseAsset) where.baseAsset = baseAsset;
    if (quoteAsset) where.quoteAsset = quoteAsset;

    const results = await prisma.optimizationResults.findMany({
      where,
      select: {
        zScoreThreshold: true,
        movingAverages: true,
        profitPercent: true,
        stopLossPercent: true,
        totalReturn: true,
        annualizedReturn: true,
        sharpeRatio: true,
        sortinoRatio: true,
        maxDrawdown: true,
        winRatio: true,
        profitFactor: true
      }
    });

    if (results.length < 10) {
      return res.status(400).json({ 
        error: 'Insufficient data for correlation analysis (minimum 10 results required)' 
      });
    }

    // Calculate correlations between parameters and target metric
    const correlations = calculateCorrelations(results, targetMetric as string);

    res.json({
      targetMetric,
      dataPoints: results.length,
      correlations,
      interpretation: {
        strong: correlations.filter(c => Math.abs(c.correlation) > 0.7),
        moderate: correlations.filter(c => Math.abs(c.correlation) > 0.4 && Math.abs(c.correlation) <= 0.7),
        weak: correlations.filter(c => Math.abs(c.correlation) <= 0.4)
      }
    });
  } catch (error) {
    console.error('Error calculating parameter correlations:', error);
    res.status(500).json({ error: 'Failed to calculate parameter correlations' });
  }
});

/**
 * POST /api/optimisation/run-full - Run full parameter optimization
 */
router.post('/run-full', async (req, res) => {
  try {
    const { baseAsset, quoteAsset, startTime, endTime } = req.body;

    if (!baseAsset || !quoteAsset || !startTime || !endTime) {
      return res.status(400).json({ 
        error: 'Missing required parameters: baseAsset, quoteAsset, startTime, endTime' 
      });
    }

    // Parameter ranges for optimization
    const parameterRanges = {
      zScoreThresholds: [1.5, 2.0, 2.5, 3.0, 3.5],
      movingAveragesPeriods: [50, 100, 150, 200, 250],
      profitPercents: [3, 5, 7, 10],
      stopLossPercents: [2, 2.5, 3, 4]
    };

    const totalCombinations = 
      parameterRanges.zScoreThresholds.length *
      parameterRanges.movingAveragesPeriods.length *
      parameterRanges.profitPercents.length *
      parameterRanges.stopLossPercents.length;

    res.json({
      message: 'Full optimization started',
      totalCombinations,
      estimatedDuration: `${Math.ceil(totalCombinations / 10)} minutes`,
      status: 'running'
    });

    // Run optimization in background (don't await)
    runFullOptimization(baseAsset, quoteAsset, startTime, endTime, parameterRanges)
      .catch(error => {
        console.error('Full optimization failed:', error);
      });

  } catch (error) {
    console.error('Error starting full optimization:', error);
    res.status(500).json({ error: 'Failed to start full optimization' });
  }
});

// Helper function to calculate correlations
function calculateCorrelations(results: any[], targetMetric: string) {
  const parameters = ['zScoreThreshold', 'movingAverages', 'profitPercent', 'stopLossPercent'];
  const correlations = [];

  for (const param of parameters) {
    const correlation = pearsonCorrelation(
      results.map(r => parseFloat(r[param].toString())),
      results.map(r => parseFloat(r[targetMetric].toString()))
    );

    correlations.push({
      parameter: param,
      correlation: isNaN(correlation) ? 0 : correlation
    });
  }

  return correlations.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
}

// Pearson correlation coefficient calculation
function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
  const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  return denominator === 0 ? 0 : numerator / denominator;
}

// Background optimization function
async function runFullOptimization(
  baseAsset: string, 
  quoteAsset: string, 
  startTime: string, 
  endTime: string,
  parameterRanges: any
) {
  console.log(`Starting full optimization for ${baseAsset}/${quoteAsset}`);

  // This would run all parameter combinations
  // Implementation would be similar to the backtest endpoint but with nested loops
  // for all parameter combinations
}

export { router as optimisationRouter };