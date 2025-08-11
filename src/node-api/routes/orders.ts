import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

/**
 * GET /api/orders - Fetch production orders
 */
router.get('/', async (req, res) => {
  try {
    const { 
      symbol, 
      status, 
      side,
      limit = '50', 
      offset = '0',
      startTime,
      endTime
    } = req.query;
    
    const where: any = {};
    if (symbol) where.symbol = symbol;
    if (status) where.status = status;
    if (side) where.side = side;
    
    if (startTime || endTime) {
      where.time = {};
      if (startTime) where.time.gte = new Date(startTime as string);
      if (endTime) where.time.lte = new Date(endTime as string);
    }

    const [orders, total] = await Promise.all([
      prisma.productionOrders.findMany({
        where,
        orderBy: {
          time: 'desc'
        },
        take: parseInt(limit as string),
        skip: parseInt(offset as string)
      }),
      prisma.productionOrders.count({ where })
    ]);

    res.json({
      orders,
      pagination: {
        total,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string)
      }
    });
  } catch (error) {
    console.error('Error fetching production orders:', error);
    res.status(500).json({ error: 'Failed to fetch production orders' });
  }
});

/**
 * GET /api/orders/stats - Get order statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const { symbol, timeRange = '7d' } = req.query;
    
    // Calculate start time based on time range
    const now = new Date();
    const startTime = new Date(now);
    
    switch (timeRange) {
      case '1d':
        startTime.setDate(now.getDate() - 1);
        break;
      case '7d':
        startTime.setDate(now.getDate() - 7);
        break;
      case '30d':
        startTime.setDate(now.getDate() - 30);
        break;
      case '1y':
        startTime.setFullYear(now.getFullYear() - 1);
        break;
      default:
        startTime.setDate(now.getDate() - 7);
    }

    const where: any = {
      time: {
        gte: startTime
      }
    };
    
    if (symbol) where.symbol = symbol;

    // Get order statistics
    const [totalOrders, buyOrders, sellOrders, filledOrders] = await Promise.all([
      prisma.productionOrders.count({ where }),
      prisma.productionOrders.count({ 
        where: { ...where, side: 'BUY' }
      }),
      prisma.productionOrders.count({ 
        where: { ...where, side: 'SELL' }
      }),
      prisma.productionOrders.count({ 
        where: { ...where, status: 'FILLED' }
      })
    ]);

    // Get total volume
    const totalVolumeResult = await prisma.productionOrders.aggregate({
      where: { ...where, status: 'FILLED' },
      _sum: {
        cummulativeQuoteQty: true
      }
    });

    // Get profit/loss for sell orders
    const sellOrdersWithProfitLoss = await prisma.productionOrders.findMany({
      where: {
        ...where,
        side: 'SELL',
        status: 'FILLED'
      },
      select: {
        symbol: true,
        executedQty: true,
        price: true,
        time: true
      }
    });

    // Calculate basic profit metrics (simplified)
    let totalProfit = 0;
    let profitableTrades = 0;

    // This is a simplified calculation - in reality, you'd need to match
    // buy and sell orders to calculate actual profit/loss
    for (const sellOrder of sellOrdersWithProfitLoss) {
      // Find corresponding buy order (simplified matching)
      const buyOrder = await prisma.productionOrders.findFirst({
        where: {
          symbol: sellOrder.symbol,
          side: 'BUY',
          status: 'FILLED',
          time: {
            lt: sellOrder.time
          }
        },
        orderBy: {
          time: 'desc'
        }
      });

      if (buyOrder) {
        const profit = parseFloat(sellOrder.executedQty.toString()) * 
                      (parseFloat(sellOrder.price.toString()) - parseFloat(buyOrder.price.toString()));
        totalProfit += profit;
        if (profit > 0) profitableTrades++;
      }
    }

    const winRate = sellOrdersWithProfitLoss.length > 0 ? 
      (profitableTrades / sellOrdersWithProfitLoss.length) * 100 : 0;

    res.json({
      summary: {
        totalOrders,
        buyOrders,
        sellOrders,
        filledOrders,
        fillRate: totalOrders > 0 ? (filledOrders / totalOrders) * 100 : 0,
        totalVolume: totalVolumeResult._sum.cummulativeQuoteQty || 0,
        totalProfit,
        winRate,
        profitableTrades,
        totalTrades: sellOrdersWithProfitLoss.length
      },
      timeRange,
      startTime,
      endTime: now
    });
  } catch (error) {
    console.error('Error fetching order statistics:', error);
    res.status(500).json({ error: 'Failed to fetch order statistics' });
  }
});

/**
 * GET /api/orders/portfolio-value - Calculate current portfolio value
 */
router.get('/portfolio-value', async (req, res) => {
  try {
    // Get all filled orders to calculate current positions
    const orders = await prisma.productionOrders.findMany({
      where: {
        status: 'FILLED'
      },
      orderBy: {
        time: 'asc'
      }
    });

    // Calculate current positions
    const positions = new Map<string, { quantity: number; avgPrice: number }>();
    let totalCashFlow = 0;

    for (const order of orders) {
      const symbol = order.symbol;
      const quantity = parseFloat(order.executedQty.toString());
      const price = parseFloat(order.price.toString());
      
      if (!positions.has(symbol)) {
        positions.set(symbol, { quantity: 0, avgPrice: 0 });
      }
      
      const position = positions.get(symbol)!;
      
      if (order.side === 'BUY') {
        // Calculate new average price
        const totalValue = position.quantity * position.avgPrice + quantity * price;
        const newQuantity = position.quantity + quantity;
        position.avgPrice = newQuantity > 0 ? totalValue / newQuantity : 0;
        position.quantity = newQuantity;
        totalCashFlow -= quantity * price; // Cash outflow
      } else {
        position.quantity -= quantity;
        totalCashFlow += quantity * price; // Cash inflow
        
        // If position is closed, remove it
        if (position.quantity <= 0.00001) { // Account for floating point precision
          positions.delete(symbol);
        }
      }
    }

    // You would normally fetch current prices from Binance API here
    // For now, using mock prices
    const currentPrices = new Map<string, number>();
    // This would be replaced with actual API calls to get current prices
    
    let totalPortfolioValue = totalCashFlow; // Start with net cash flow
    const positionValues = [];
    
    for (const [symbol, position] of positions) {
      // Mock current price - in reality, fetch from Binance
      const currentPrice = position.avgPrice * (1 + (Math.random() - 0.5) * 0.1); // ±5% variation
      const currentValue = position.quantity * currentPrice;
      const unrealizedPL = (currentPrice - position.avgPrice) * position.quantity;
      
      totalPortfolioValue += currentValue;
      
      positionValues.push({
        symbol,
        quantity: position.quantity,
        avgPrice: position.avgPrice,
        currentPrice,
        currentValue,
        unrealizedPL,
        unrealizedPLPercent: ((currentPrice - position.avgPrice) / position.avgPrice) * 100
      });
    }

    res.json({
      totalPortfolioValue,
      netCashFlow: totalCashFlow,
      totalUnrealizedPL: totalPortfolioValue - totalCashFlow,
      positions: positionValues,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error calculating portfolio value:', error);
    res.status(500).json({ error: 'Failed to calculate portfolio value' });
  }
});

/**
 * POST /api/orders - Create a new production order (webhook endpoint)
 */
router.post('/', async (req, res) => {
  try {
    const orderData = req.body;
    
    // Validate required fields
    const requiredFields = [
      'orderId', 'symbol', 'side', 'type', 'quantity', 'price',
      'timeInForce', 'status', 'executedQty', 'cummulativeQuoteQty',
      'time', 'updateTime', 'isWorking', 'origQuoteOrderQty'
    ];
    
    for (const field of requiredFields) {
      if (orderData[field] === undefined) {
        return res.status(400).json({ 
          error: `Missing required field: ${field}` 
        });
      }
    }

    const order = await prisma.productionOrders.create({
      data: {
        orderId: orderData.orderId,
        symbol: orderData.symbol,
        side: orderData.side,
        type: orderData.type,
        quantity: parseFloat(orderData.quantity),
        price: parseFloat(orderData.price),
        stopPrice: orderData.stopPrice ? parseFloat(orderData.stopPrice) : null,
        timeInForce: orderData.timeInForce,
        status: orderData.status,
        executedQty: parseFloat(orderData.executedQty),
        cummulativeQuoteQty: parseFloat(orderData.cummulativeQuoteQty),
        time: new Date(orderData.time),
        updateTime: new Date(orderData.updateTime),
        isWorking: orderData.isWorking,
        origQuoteOrderQty: parseFloat(orderData.origQuoteOrderQty)
      }
    });

    res.status(201).json(order);
  } catch (error) {
    console.error('Error creating production order:', error);
    res.status(500).json({ error: 'Failed to create production order' });
  }
});

/**
 * PUT /api/orders/:orderId - Update an existing production order
 */
router.put('/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const updateData = req.body;
    
    const order = await prisma.productionOrders.update({
      where: { orderId },
      data: {
        status: updateData.status,
        executedQty: updateData.executedQty ? parseFloat(updateData.executedQty) : undefined,
        cummulativeQuoteQty: updateData.cummulativeQuoteQty ? parseFloat(updateData.cummulativeQuoteQty) : undefined,
        updateTime: updateData.updateTime ? new Date(updateData.updateTime) : new Date(),
        isWorking: updateData.isWorking
      }
    });

    res.json(order);
  } catch (error) {
    console.error('Error updating production order:', error);
    res.status(500).json({ error: 'Failed to update production order' });
  }
});

export { router as ordersRouter };