# Backtest Data Query Guide

This guide provides comprehensive documentation on how to query backtest data by parameter sets, dates, and individual trades using the database schema.

## Table of Contents
- [Database Schema Overview](#database-schema-overview)
- [Table Relationships](#table-relationships)
- [Common Query Patterns](#common-query-patterns)
- [Filtering Examples](#filtering-examples)
- [Performance Considerations](#performance-considerations)
- [TypeScript Examples](#typescript-examples)

## Database Schema Overview

The backtest data is stored across three main tables with clear relationships:

```
BacktestRuns (1) ──── (Many) BacktestOrders
     │
     └── (1) ──── (1) OptimizationResults
```

### BacktestRuns Table
**Purpose**: Stores parameter configurations and metadata for each backtest execution.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key (CUID) |
| `baseAsset` | String | Base asset (e.g., 'BTC', 'ETH') |
| `quoteAsset` | String | Quote asset (e.g., 'USDT') |
| `zScoreThreshold` | Decimal(5,2) | Z-score threshold parameter |
| `movingAverages` | Int | Moving averages window parameter |
| `profitPercent` | Decimal(5,2) | Profit target percentage |
| `stopLossPercent` | Decimal(5,2) | Stop loss percentage |
| `startTime` | DateTime | Backtest start timestamp |
| `endTime` | DateTime | Backtest end timestamp |
| `windowSize` | Int | Window size (default: 12) |
| `createdAt` | DateTime | Record creation timestamp |

### BacktestOrders Table
**Purpose**: Stores individual trades/orders for each backtest run.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key (CUID) |
| `runId` | String | Foreign key to BacktestRuns |
| `symbol` | String | Trading symbol (e.g., 'BTCUSDT') |
| `side` | OrderSide | BUY or SELL |
| `quantity` | Decimal(20,8) | Order quantity |
| `price` | Decimal(20,8) | Order price |
| `timestamp` | DateTime | Order timestamp |
| `reason` | ExitReason | ENTRY, EXIT_ZSCORE, EXIT_PROFIT, EXIT_STOP |
| `profitLoss` | Decimal(20,8) | Profit/loss amount (nullable) |
| `profitLossPercent` | Decimal(10,4) | Profit/loss percentage (nullable) |
| `createdAt` | DateTime | Record creation timestamp |

### OptimizationResults Table
**Purpose**: Stores performance metrics and results for each backtest run.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key (CUID) |
| `runId` | String | Foreign key to BacktestRuns |
| `totalReturn` | Decimal(10,4) | Total return percentage |
| `annualizedReturn` | Decimal(10,4) | Annualized return percentage |
| `sharpeRatio` | Decimal(10,4) | Sharpe ratio |
| `maxDrawdown` | Decimal(10,4) | Maximum drawdown percentage |
| `winRatio` | Decimal(5,2) | Win rate (0-1) |
| `totalTrades` | Int | Total number of trades |
| `profitFactor` | Decimal(10,4) | Profit factor |
| `avgTradeDuration` | Decimal(10,2) | Average trade duration in hours |
| `calmarRatio` | Decimal(10,4) | Calmar ratio (optional) |

## Table Relationships

### Prisma Relationships
```typescript
model BacktestRuns {
  id              String   @id @default(cuid())
  // ... fields
  orders              BacktestOrders[]      // One-to-many
  optimizationResults OptimizationResults[] // One-to-many
}

model BacktestOrders {
  // ... fields
  backtestRun BacktestRuns @relation(fields: [runId], references: [id])
}

model OptimizationResults {
  // ... fields
  backtestRun BacktestRuns @relation(fields: [runId], references: [id])
}
```

## Common Query Patterns

### Pattern 1: Query by Parameter Set with Results
**Use Case**: Find all backtest runs matching specific parameters and get their performance metrics.

```typescript
const results = await prisma.optimizationResults.findMany({
  where: {
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    zScoreThreshold: 2.0,
    profitPercent: 1.5,
    stopLossPercent: 2.0,
    movingAverages: 20,
    startTime: {
      gte: new Date('2024-01-01'),
      lte: new Date('2024-12-31')
    }
  },
  include: {
    backtestRun: {
      include: {
        orders: true  // Include all individual trades
      }
    }
  },
  orderBy: {
    totalReturn: 'desc'
  }
});
```

### Pattern 2: Query BacktestRuns with Orders
**Use Case**: Find backtest runs by parameters and get all their orders directly.

```typescript
const backtestRuns = await prisma.backtestRuns.findMany({
  where: {
    baseAsset: 'ETH',
    zScoreThreshold: { gte: 1.5, lte: 2.5 },
    startTime: { gte: new Date('2024-06-01') },
    endTime: { lte: new Date('2024-12-31') }
  },
  include: {
    orders: {
      orderBy: { timestamp: 'asc' }
    },
    optimizationResults: true
  }
});
```

### Pattern 3: Direct Order Query by Run ID
**Use Case**: Get all trades for a specific backtest run.

```typescript
const orders = await prisma.backtestOrders.findMany({
  where: {
    runId: 'specific-run-id'
  },
  orderBy: { timestamp: 'asc' }
});
```

### Pattern 4: Complex Parameter Filtering
**Use Case**: Find best performing strategies across multiple parameter combinations.

```typescript
const topPerformers = await prisma.optimizationResults.findMany({
  where: {
    AND: [
      { totalReturn: { gte: 5.0 } },      // At least 5% return
      { sharpeRatio: { gte: 1.0 } },      // Sharpe ratio >= 1.0
      { totalTrades: { gte: 10 } },       // At least 10 trades
      { maxDrawdown: { gte: -15.0 } },    // Max drawdown <= 15%
      {
        OR: [
          { baseAsset: 'BTC' },
          { baseAsset: 'ETH' },
          { baseAsset: 'SOL' }
        ]
      }
    ]
  },
  include: {
    backtestRun: true
  },
  orderBy: [
    { totalReturn: 'desc' },
    { sharpeRatio: 'desc' }
  ],
  take: 20
});
```

## Filtering Examples

### By Date Range
```typescript
// All backtests in Q3 2024
const q3Results = await prisma.backtestRuns.findMany({
  where: {
    startTime: { gte: new Date('2024-07-01') },
    endTime: { lte: new Date('2024-09-30') }
  }
});

// Backtests created in the last 7 days
const recentRuns = await prisma.backtestRuns.findMany({
  where: {
    createdAt: { 
      gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) 
    }
  }
});
```

### By Parameter Ranges
```typescript
// Conservative strategies (lower risk parameters)
const conservative = await prisma.optimizationResults.findMany({
  where: {
    zScoreThreshold: { gte: 2.0 },     // Higher z-score threshold
    stopLossPercent: { lte: 1.5 },     // Tighter stop loss
    profitPercent: { lte: 1.0 }        // Lower profit target
  }
});

// Aggressive strategies
const aggressive = await prisma.optimizationResults.findMany({
  where: {
    zScoreThreshold: { lte: 1.5 },     // Lower z-score threshold
    stopLossPercent: { gte: 3.0 },     // Wider stop loss
    profitPercent: { gte: 2.0 }        // Higher profit target
  }
});
```

### By Asset Pairs
```typescript
// All BTC pairs
const btcPairs = await prisma.backtestRuns.findMany({
  where: { baseAsset: 'BTC' }
});

// Specific trading pairs
const specificPairs = await prisma.backtestRuns.findMany({
  where: {
    OR: [
      { baseAsset: 'BTC', quoteAsset: 'USDT' },
      { baseAsset: 'ETH', quoteAsset: 'USDT' },
      { baseAsset: 'SOL', quoteAsset: 'USDT' }
    ]
  }
});
```

### By Performance Metrics
```typescript
// High-performing strategies only
const highPerformers = await prisma.optimizationResults.findMany({
  where: {
    totalReturn: { gte: 10.0 },        // 10%+ return
    sharpeRatio: { gte: 1.5 },         // Sharpe >= 1.5
    winRatio: { gte: 0.6 },            // 60%+ win rate
    calmarRatio: { gte: 2.0 }          // Calmar >= 2.0
  }
});
```

## Performance Considerations

### Indexes Available
The schema includes these indexes for optimal query performance:

```sql
-- BacktestRuns indexes
CREATE INDEX idx_backtest_runs_base_quote ON backtest_runs(base_asset, quote_asset);
CREATE INDEX idx_backtest_runs_time_range ON backtest_runs(start_time, end_time);

-- BacktestOrders indexes  
CREATE INDEX idx_backtest_orders_run_id ON backtest_orders(run_id);
CREATE INDEX idx_backtest_orders_symbol_time ON backtest_orders(symbol, timestamp);

-- OptimizationResults indexes
CREATE INDEX idx_optimization_base_quote ON optimization_results(base_asset, quote_asset);
CREATE INDEX idx_optimization_total_return ON optimization_results(total_return);
CREATE INDEX idx_optimization_sharpe ON optimization_results(sharpe_ratio);
CREATE INDEX idx_optimization_calmar ON optimization_results(calmar_ratio);
```

### Query Optimization Tips

1. **Use specific filters first**: Filter by baseAsset/quoteAsset before other parameters
2. **Limit results**: Use `take` to limit large result sets
3. **Order by indexed fields**: Use orderBy with indexed columns for better performance
4. **Selective includes**: Only include related data you need

```typescript
// Good: Efficient query
const efficientQuery = await prisma.optimizationResults.findMany({
  where: {
    baseAsset: 'BTC',                    // Indexed field first
    totalReturn: { gte: 5.0 }            // Then performance filter
  },
  select: {                              // Only select needed fields
    id: true,
    totalReturn: true,
    sharpeRatio: true,
    backtestRun: {
      select: {
        zScoreThreshold: true,
        profitPercent: true
      }
    }
  },
  take: 50                               // Limit results
});

// Avoid: Loading everything
const inefficientQuery = await prisma.optimizationResults.findMany({
  include: {
    backtestRun: {
      include: {
        orders: true                     // Could load thousands of orders
      }
    }
  }
  // No limits or specific filters
});
```

## TypeScript Examples

### Complete Query Service Class
```typescript
import { PrismaClient, OrderSide, ExitReason } from '@prisma/client';

export interface BacktestQueryParams {
  baseAsset?: string;
  quoteAsset?: string;
  zScoreThreshold?: { min?: number; max?: number };
  profitPercent?: { min?: number; max?: number };
  stopLossPercent?: { min?: number; max?: number };
  movingAverages?: number | number[];
  dateRange?: { start: Date; end: Date };
  minTotalReturn?: number;
  minSharpeRatio?: number;
  minWinRatio?: number;
  limit?: number;
  offset?: number;
}

export interface BacktestResultWithTrades {
  runId: string;
  parameters: {
    baseAsset: string;
    quoteAsset: string;
    zScoreThreshold: number;
    movingAverages: number;
    profitPercent: number;
    stopLossPercent: number;
  };
  performance: {
    totalReturn: number;
    sharpeRatio: number;
    maxDrawdown: number;
    winRatio: number;
    totalTrades: number;
    calmarRatio: number | null;
  };
  trades: Array<{
    symbol: string;
    side: OrderSide;
    price: number;
    quantity: number;
    timestamp: Date;
    reason: ExitReason;
    profitLoss: number | null;
    profitLossPercent: number | null;
  }>;
  dateRange: { start: Date; end: Date };
}

export class BacktestQueryService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  /**
   * Query backtest results by parameter set and date range
   */
  async queryByParameters(params: BacktestQueryParams): Promise<BacktestResultWithTrades[]> {
    // Build where clause dynamically
    const where: any = {};
    
    if (params.baseAsset) where.baseAsset = params.baseAsset;
    if (params.quoteAsset) where.quoteAsset = params.quoteAsset;
    
    if (params.zScoreThreshold) {
      where.zScoreThreshold = {};
      if (params.zScoreThreshold.min !== undefined) {
        where.zScoreThreshold.gte = params.zScoreThreshold.min;
      }
      if (params.zScoreThreshold.max !== undefined) {
        where.zScoreThreshold.lte = params.zScoreThreshold.max;
      }
    }
    
    if (params.profitPercent) {
      where.profitPercent = {};
      if (params.profitPercent.min !== undefined) {
        where.profitPercent.gte = params.profitPercent.min;
      }
      if (params.profitPercent.max !== undefined) {
        where.profitPercent.lte = params.profitPercent.max;
      }
    }
    
    if (params.stopLossPercent) {
      where.stopLossPercent = {};
      if (params.stopLossPercent.min !== undefined) {
        where.stopLossPercent.gte = params.stopLossPercent.min;
      }
      if (params.stopLossPercent.max !== undefined) {
        where.stopLossPercent.lte = params.stopLossPercent.max;
      }
    }
    
    if (params.movingAverages) {
      if (Array.isArray(params.movingAverages)) {
        where.movingAverages = { in: params.movingAverages };
      } else {
        where.movingAverages = params.movingAverages;
      }
    }
    
    if (params.dateRange) {
      where.startTime = { gte: params.dateRange.start };
      where.endTime = { lte: params.dateRange.end };
    }
    
    // Performance filters
    const performanceFilters: any[] = [];
    if (params.minTotalReturn !== undefined) {
      performanceFilters.push({ totalReturn: { gte: params.minTotalReturn } });
    }
    if (params.minSharpeRatio !== undefined) {
      performanceFilters.push({ sharpeRatio: { gte: params.minSharpeRatio } });
    }
    if (params.minWinRatio !== undefined) {
      performanceFilters.push({ winRatio: { gte: params.minWinRatio } });
    }
    
    if (performanceFilters.length > 0) {
      where.AND = performanceFilters;
    }

    const results = await this.prisma.optimizationResults.findMany({
      where,
      include: {
        backtestRun: {
          include: {
            orders: {
              orderBy: { timestamp: 'asc' }
            }
          }
        }
      },
      orderBy: { totalReturn: 'desc' },
      take: params.limit || 50,
      skip: params.offset || 0
    });

    return results.map(result => ({
      runId: result.runId,
      parameters: {
        baseAsset: result.baseAsset,
        quoteAsset: result.quoteAsset,
        zScoreThreshold: Number(result.zScoreThreshold),
        movingAverages: result.movingAverages,
        profitPercent: Number(result.profitPercent),
        stopLossPercent: Number(result.stopLossPercent)
      },
      performance: {
        totalReturn: Number(result.totalReturn),
        sharpeRatio: Number(result.sharpeRatio),
        maxDrawdown: Number(result.maxDrawdown),
        winRatio: Number(result.winRatio),
        totalTrades: result.totalTrades,
        calmarRatio: result.calmarRatio ? Number(result.calmarRatio) : null
      },
      trades: result.backtestRun.orders.map(order => ({
        symbol: order.symbol,
        side: order.side,
        price: Number(order.price),
        quantity: Number(order.quantity),
        timestamp: order.timestamp,
        reason: order.reason,
        profitLoss: order.profitLoss ? Number(order.profitLoss) : null,
        profitLossPercent: order.profitLossPercent ? Number(order.profitLossPercent) : null
      })),
      dateRange: {
        start: result.startTime,
        end: result.endTime
      }
    }));
  }

  /**
   * Get all trades for a specific parameter set
   */
  async getTradesByParameters(
    baseAsset: string,
    quoteAsset: string,
    zScoreThreshold: number,
    profitPercent: number,
    stopLossPercent: number,
    movingAverages: number,
    dateRange: { start: Date; end: Date }
  ) {
    const backtestRuns = await this.prisma.backtestRuns.findMany({
      where: {
        baseAsset,
        quoteAsset,
        zScoreThreshold,
        profitPercent,
        stopLossPercent,
        movingAverages,
        startTime: dateRange.start,
        endTime: dateRange.end
      },
      include: {
        orders: {
          orderBy: { timestamp: 'asc' }
        },
        optimizationResults: true
      }
    });

    return backtestRuns.flatMap(run => 
      run.orders.map(order => ({
        ...order,
        runId: run.id,
        parameters: {
          baseAsset: run.baseAsset,
          quoteAsset: run.quoteAsset,
          zScoreThreshold: Number(run.zScoreThreshold),
          movingAverages: run.movingAverages,
          profitPercent: Number(run.profitPercent),
          stopLossPercent: Number(run.stopLossPercent)
        },
        performance: run.optimizationResults[0] ? {
          totalReturn: Number(run.optimizationResults[0].totalReturn),
          sharpeRatio: Number(run.optimizationResults[0].sharpeRatio),
          winRatio: Number(run.optimizationResults[0].winRatio)
        } : null
      }))
    );
  }

  /**
   * Get unique parameter combinations with their best performance
   */
  async getUniqueParameterCombinations(baseAsset?: string) {
    const where: any = {};
    if (baseAsset) where.baseAsset = baseAsset;

    const results = await this.prisma.optimizationResults.findMany({
      where,
      select: {
        baseAsset: true,
        quoteAsset: true,
        zScoreThreshold: true,
        movingAverages: true,
        profitPercent: true,
        stopLossPercent: true,
        totalReturn: true,
        sharpeRatio: true,
        calmarRatio: true,
        totalTrades: true
      },
      orderBy: { totalReturn: 'desc' }
    });

    // Group by parameter combination and keep the best result
    const parameterMap = new Map();
    
    for (const result of results) {
      const key = `${result.baseAsset}-${result.quoteAsset}-${result.zScoreThreshold}-${result.movingAverages}-${result.profitPercent}-${result.stopLossPercent}`;
      
      if (!parameterMap.has(key) || 
          Number(result.totalReturn) > Number(parameterMap.get(key).totalReturn)) {
        parameterMap.set(key, result);
      }
    }

    return Array.from(parameterMap.values());
  }

  async cleanup() {
    await this.prisma.$disconnect();
  }
}
```

### Usage Examples

```typescript
// Example usage
const queryService = new BacktestQueryService();

// 1. Find all BTC strategies with good performance
const btcStrategies = await queryService.queryByParameters({
  baseAsset: 'BTC',
  quoteAsset: 'USDT',
  minTotalReturn: 5.0,
  minSharpeRatio: 1.0,
  limit: 20
});

// 2. Get conservative strategies in a date range
const conservativeStrategies = await queryService.queryByParameters({
  zScoreThreshold: { min: 2.0 },
  stopLossPercent: { max: 2.0 },
  dateRange: {
    start: new Date('2024-01-01'),
    end: new Date('2024-12-31')
  }
});

// 3. Find specific parameter set performance
const specificTrades = await queryService.getTradesByParameters(
  'ETH',      // baseAsset
  'USDT',     // quoteAsset
  2.0,        // zScoreThreshold
  1.5,        // profitPercent
  2.0,        // stopLossPercent
  20,         // movingAverages
  {
    start: new Date('2024-06-01'),
    end: new Date('2024-12-31')
  }
);

// 4. Get best parameter combinations
const bestCombinations = await queryService.getUniqueParameterCombinations('BTC');

await queryService.cleanup();
```

## Summary

This guide provides a complete reference for querying backtest data by:

- **Parameter sets**: Filter by zScoreThreshold, profitPercent, stopLossPercent, movingAverages
- **Date ranges**: Query by startTime, endTime, or createdAt
- **Performance metrics**: Filter by returns, Sharpe ratio, win rate, etc.
- **Individual trades**: Access all BacktestOrders linked to specific runs
- **Asset pairs**: Filter by baseAsset and quoteAsset combinations

The schema is optimized for these query patterns with appropriate indexes, and the TypeScript examples provide production-ready code for common use cases.