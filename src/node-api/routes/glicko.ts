import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { rustCore } from '../index';

const router = Router();
const prisma = new PrismaClient();

/**
 * GET /api/glicko/ratings - Fetch Glicko-2 ratings
 */
router.get('/ratings', async (req, res) => {
  try {
    const { 
      symbol, 
      startTime, 
      endTime, 
      limit = '1000', 
      offset = '0' 
    } = req.query;
    
    const where: any = {};
    if (symbol) where.symbol = symbol;
    
    if (startTime || endTime) {
      where.timestamp = {};
      if (startTime) where.timestamp.gte = new Date(startTime as string);
      if (endTime) where.timestamp.lte = new Date(endTime as string);
    }

    const [ratings, total] = await Promise.all([
      prisma.glickoRatings.findMany({
        where,
        orderBy: {
          timestamp: 'desc'
        },
        take: parseInt(limit as string),
        skip: parseInt(offset as string)
      }),
      prisma.glickoRatings.count({ where })
    ]);

    res.json({
      ratings,
      pagination: {
        total,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string)
      }
    });
  } catch (error) {
    console.error('Error fetching Glicko ratings:', error);
    res.status(500).json({ error: 'Failed to fetch Glicko ratings' });
  }
});

/**
 * GET /api/glicko/latest - Get latest ratings for all symbols
 */
router.get('/latest', async (req, res) => {
  try {
    const { symbols } = req.query;
    
    let symbolList: string[] = [];
    if (symbols) {
      symbolList = (symbols as string).split(',').map(s => s.trim());
    }

    // Get latest rating for each symbol
    const latestRatings = await prisma.$queryRaw<any[]>`
      SELECT DISTINCT ON (symbol) 
        symbol, timestamp, rating, "ratingDeviation", volatility, "performanceScore"
      FROM glicko_ratings 
      ${symbolList.length > 0 ? `WHERE symbol = ANY(${JSON.stringify(symbolList)})` : ''}
      ORDER BY symbol, timestamp DESC
    `;

    res.json({
      ratings: latestRatings,
      count: latestRatings.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching latest Glicko ratings:', error);
    res.status(500).json({ error: 'Failed to fetch latest Glicko ratings' });
  }
});

/**
 * GET /api/glicko/z-scores - Calculate and return z-scores for symbols
 */
router.get('/z-scores', async (req, res) => {
  try {
    const { 
      symbols, 
      movingAverages = '200',
      threshold = '2.0'
    } = req.query;
    
    let symbolList: string[] = [];
    if (symbols) {
      symbolList = (symbols as string).split(',').map(s => s.trim());
    } else {
      // Get all unique symbols if none specified
      const uniqueSymbols = await prisma.glickoRatings.findMany({
        distinct: ['symbol'],
        select: { symbol: true }
      });
      symbolList = uniqueSymbols.map(s => s.symbol);
    }

    const movingAveragesPeriod = parseInt(movingAverages as string);
    const zScoreThreshold = parseFloat(threshold as string);

    // Get recent ratings for z-score calculation
    const ratings = await prisma.glickoRatings.findMany({
      where: {
        symbol: {
          in: symbolList
        }
      },
      orderBy: [
        { symbol: 'asc' },
        { timestamp: 'desc' }
      ],
      take: symbolList.length * (movingAveragesPeriod + 50) // Extra buffer
    });

    // Calculate z-scores using Rust core service
    const zScores = await rustCore.calculateZScores(
      ratings.map(r => ({
        symbol: r.symbol,
        timestamp: r.timestamp,
        rating: parseFloat(r.rating.toString()),
        ratingDeviation: parseFloat(r.ratingDeviation.toString()),
        volatility: parseFloat(r.volatility.toString()),
        performanceScore: parseFloat(r.performanceScore.toString())
      })),
      movingAveragesPeriod
    );

    // Filter for signals above threshold
    const signals = zScores.filter(z => Math.abs(z.zScore) >= zScoreThreshold);

    res.json({
      zScores,
      signals,
      parameters: {
        movingAveragesPeriod,
        zScoreThreshold
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error calculating z-scores:', error);
    res.status(500).json({ error: 'Failed to calculate z-scores' });
  }
});

/**
 * POST /api/glicko/calculate - Calculate Glicko ratings from klines data
 */
router.post('/calculate', async (req, res) => {
  try {
    const { symbols, startTime, endTime, forceRecalculate = false } = req.body;
    
    if (!symbols || !Array.isArray(symbols)) {
      return res.status(400).json({ 
        error: 'symbols array is required' 
      });
    }

    const start = startTime ? new Date(startTime) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
    const end = endTime ? new Date(endTime) : new Date();

    // Check if ratings already exist (unless forced recalculation)
    if (!forceRecalculate) {
      const existingRatings = await prisma.glickoRatings.count({
        where: {
          symbol: { in: symbols },
          timestamp: {
            gte: start,
            lte: end
          }
        }
      });

      if (existingRatings > 0) {
        return res.json({
          message: 'Glicko ratings already exist for this period. Use forceRecalculate=true to override.',
          existingRatings
        });
      }
    }

    // Fetch klines data
    const klines = await prisma.klines.findMany({
      where: {
        symbol: { in: symbols },
        openTime: {
          gte: start,
          lte: end
        }
      },
      orderBy: [
        { symbol: 'asc' },
        { openTime: 'asc' }
      ]
    });

    if (klines.length === 0) {
      return res.status(400).json({ 
        error: 'No klines data found for the specified symbols and time period' 
      });
    }

    // Convert to format expected by Rust core
    const klinesData = klines.map(k => ({
      id: k.id,
      symbol: k.symbol,
      openTime: k.openTime,
      closeTime: k.closeTime,
      open: parseFloat(k.open.toString()),
      high: parseFloat(k.high.toString()),
      low: parseFloat(k.low.toString()),
      close: parseFloat(k.close.toString()),
      volume: parseFloat(k.volume.toString()),
      quoteAssetVolume: parseFloat(k.quoteAssetVolume.toString()),
      numberOfTrades: k.numberOfTrades,
      takerBuyBaseAssetVolume: parseFloat(k.takerBuyBaseAssetVolume.toString()),
      takerBuyQuoteAssetVolume: parseFloat(k.takerBuyQuoteAssetVolume.toString()),
      ignore: parseInt(k.ignore?.toString() || '0')
    }));

    // Calculate Glicko ratings using Rust core
    const ratings = await rustCore.calculateGlickoRatings(klinesData);

    // Save ratings to database
    if (forceRecalculate) {
      // Delete existing ratings first
      await prisma.glickoRatings.deleteMany({
        where: {
          symbol: { in: symbols },
          timestamp: {
            gte: start,
            lte: end
          }
        }
      });
    }

    const savedRatings = await prisma.glickoRatings.createMany({
      data: ratings.map(r => ({
        symbol: r.symbol,
        timestamp: new Date(r.timestamp),
        rating: r.rating,
        ratingDeviation: r.ratingDeviation,
        volatility: r.volatility,
        performanceScore: r.performanceScore
      }))
    });

    res.json({
      message: 'Glicko ratings calculated successfully',
      klinesProcessed: klines.length,
      ratingsCalculated: ratings.length,
      ratingsSaved: savedRatings.count,
      timeRange: {
        start,
        end
      }
    });

  } catch (error) {
    console.error('Error calculating Glicko ratings:', error);
    res.status(500).json({ error: 'Failed to calculate Glicko ratings' });
  }
});

/**
 * GET /api/glicko/symbols - Get all available symbols with rating data
 */
router.get('/symbols', async (req, res) => {
  try {
    const symbolStats = await prisma.$queryRaw<any[]>`
      SELECT 
        symbol,
        COUNT(*) as rating_count,
        MIN(timestamp) as first_rating,
        MAX(timestamp) as latest_rating,
        AVG(rating) as avg_rating,
        AVG("ratingDeviation") as avg_deviation,
        AVG(volatility) as avg_volatility
      FROM glicko_ratings 
      GROUP BY symbol
      ORDER BY symbol
    `;

    res.json({
      symbols: symbolStats,
      totalSymbols: symbolStats.length
    });
  } catch (error) {
    console.error('Error fetching symbol statistics:', error);
    res.status(500).json({ error: 'Failed to fetch symbol statistics' });
  }
});

/**
 * GET /api/glicko/ratings/:symbol/history - Get rating history for a specific symbol
 */
router.get('/ratings/:symbol/history', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { 
      startTime, 
      endTime, 
      interval = '1h',
      limit = '1000' 
    } = req.query;
    
    const where: any = { symbol };
    
    if (startTime || endTime) {
      where.timestamp = {};
      if (startTime) where.timestamp.gte = new Date(startTime as string);
      if (endTime) where.timestamp.lte = new Date(endTime as string);
    }

    // For now, return all data (interval sampling would be implemented here)
    const ratings = await prisma.glickoRatings.findMany({
      where,
      orderBy: {
        timestamp: 'asc'
      },
      take: parseInt(limit as string)
    });

    // Calculate some basic statistics
    const ratingValues = ratings.map(r => parseFloat(r.rating.toString()));
    const stats = {
      count: ratings.length,
      minRating: Math.min(...ratingValues),
      maxRating: Math.max(...ratingValues),
      avgRating: ratingValues.reduce((a, b) => a + b, 0) / ratingValues.length,
      volatility: ratingValues.length > 1 ? {
        min: Math.min(...ratings.map(r => parseFloat(r.volatility.toString()))),
        max: Math.max(...ratings.map(r => parseFloat(r.volatility.toString()))),
        avg: ratings.reduce((sum, r) => sum + parseFloat(r.volatility.toString()), 0) / ratings.length
      } : null
    };

    res.json({
      symbol,
      ratings,
      statistics: stats,
      parameters: {
        interval,
        timeRange: {
          start: startTime,
          end: endTime
        }
      }
    });
  } catch (error) {
    console.error('Error fetching rating history:', error);
    res.status(500).json({ error: 'Failed to fetch rating history' });
  }
});

export { router as glickoRouter };