export interface Kline {
  id?: string;
  symbol: string;
  openTime: Date;
  closeTime: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteAssetVolume: number;
  numberOfTrades: number;
  takerBuyBaseAssetVolume: number;
  takerBuyQuoteAssetVolume: number;
  ignore: number;
}

export interface GlickoRating {
  id?: string;
  symbol: string;
  timestamp: Date;
  rating: number;
  ratingDeviation: number;
  volatility: number;
  performanceScore: number;
}

export interface ProductionOrder {
  id?: string;
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: string;
  quantity: number;
  price: number;
  stopPrice?: number;
  timeInForce: string;
  status: string;
  executedQty: number;
  cummulativeQuoteQty: number;
  time: Date;
  updateTime: Date;
  isWorking: boolean;
  origQuoteOrderQty: number;
}

export interface BacktestOrder {
  id?: string;
  runId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  timestamp: Date;
  reason: 'ENTRY' | 'EXIT_ZSCORE' | 'EXIT_PROFIT' | 'EXIT_STOP';
  profitLoss?: number;
  profitLossPercent?: number;
}

export interface OptimizationResult {
  id?: string;
  baseAsset: string;
  quoteAsset: string;
  zScoreThreshold: number;
  movingAverages: number;
  profitPercent: number;
  stopLossPercent: number;
  startTime: Date;
  endTime: Date;
  totalReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  sortinoRatio: number;
  alpha: number;
  maxDrawdown: number;
  winRatio: number;
  totalTrades: number;
  profitFactor: number;
  avgTradeDuration: number;
}

export interface HybridScore {
  priceUp: boolean;
  priceUnchanged: boolean;
  takerBuyDominant: boolean;
  score: number;
  confidence: 'HIGH' | 'LOW' | 'NEUTRAL';
}

export interface ZScoreSignal {
  symbol: string;
  timestamp: Date;
  currentRating: number;
  movingAverage: number;
  standardDeviation: number;
  zScore: number;
  signal: 'BUY' | 'SELL' | 'HOLD';
}

export interface BacktestConfig {
  baseAsset: string;
  quoteAsset: string;
  zScoreThreshold: number;
  movingAverages: number;
  profitPercent: number;
  stopLossPercent: number;
  startTime: Date;
  endTime: Date;
  windowSize?: number;
}

export interface PerformanceMetrics {
  totalReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  sortinoRatio: number;
  alpha: number;
  maxDrawdown: number;
  annualizedVolatility: number;
  winRatio: number;
  profitFactor: number;
  totalTrades: number;
  avgTradeDuration: number;
}

export interface TradingPair {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  isActive: boolean;
}

export interface BacktestResult {
  config: BacktestConfig;
  orders: BacktestOrder[];
  metrics: PerformanceMetrics;
  equity: Array<{
    timestamp: Date;
    value: number;
  }>;
}

export interface TradingParameterSet {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  zScoreThreshold: number;
  movingAverages: number;
  profitPercent: number;
  stopLossPercent: number;
  allocationPercent?: number;
  enabled?: boolean;
}

export interface ActivePosition {
  symbol: string;
  entryPrice: number;
  quantity: number;
  entryTime: Date;
  buyOrderId: string;
  ocoOrderId: string;
  takeProfitOrderId?: string;
  stopLossOrderId?: string;
  takeProfitPrice: number;
  stopLossPrice: number;
  zScoreThreshold: number;
  parameters: TradingParameterSet;
}

export interface PaperPosition {
  symbol: string;
  entryPrice: number;
  quantity: number;
  entryTime: Date;
  takeProfitPrice: number;
  stopLossPrice: number;
  parameters: TradingParameterSet;
  entryValue: number; // USDT value at entry
  unrealizedPnL?: number;
  unrealizedPnLPercent?: number;
}