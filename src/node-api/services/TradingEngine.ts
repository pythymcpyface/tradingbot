import { EventEmitter } from 'events';
import { PrismaClient } from '@prisma/client';
import BinanceService from './BinanceService';
import { RustCoreService } from './RustCoreService';
import { ZScoreSignal } from '../../types';

export interface TradingConfig {
  zScoreThreshold: number;
  movingAveragesPeriod: number;
  profitPercent: number;
  stopLossPercent: number;
  maxPositions: number;
  allocationPerPosition: number;
  symbols: string[];
  enableLiveTrading: boolean;
  riskManagement: {
    maxDailyLoss: number;
    maxDrawdown: number;
    cooldownPeriod: number; // minutes
  };
}

export interface TradingState {
  isRunning: boolean;
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  currentDrawdown: number;
  dailyPnL: number;
  lastTradeTime?: Date;
  activeSignals: ZScoreSignal[];
}

export class TradingEngine extends EventEmitter {
  private prisma: PrismaClient;
  private binanceService: BinanceService;
  private rustCore: RustCoreService;
  private config: TradingConfig;
  private state: TradingState;
  private monitoringInterval?: NodeJS.Timeout;
  private lastSignalCheck: Date = new Date(0);
  private failedTradeCooldown: Map<string, Date> = new Map();

  constructor(
    prisma: PrismaClient,
    binanceService: BinanceService,
    rustCore: RustCoreService,
    config: TradingConfig
  ) {
    super();
    this.prisma = prisma;
    this.binanceService = binanceService;
    this.rustCore = rustCore;
    this.config = config;
    
    this.state = {
      isRunning: false,
      totalTrades: 0,
      successfulTrades: 0,
      failedTrades: 0,
      currentDrawdown: 0,
      dailyPnL: 0,
      activeSignals: []
    };

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.binanceService.on('orderPlaced', (order) => {
      this.state.totalTrades++;
      this.emit('orderExecuted', order);
      console.log('Order executed:', order.symbol, order.side);
    });

    this.binanceService.on('orderError', (error) => {
      this.state.failedTrades++;
      this.emit('tradingError', error);
      console.error('Trading error:', error);
    });

    this.binanceService.on('priceUpdate', (priceData) => {
      this.emit('priceUpdate', priceData);
    });
  }

  async start(): Promise<void> {
    if (this.state.isRunning) {
      throw new Error('Trading engine is already running');
    }

    try {
      // Initialize services
      if (!this.binanceService.isReady()) {
        await this.binanceService.initialize();
      }

      if (!this.rustCore.isInitialized()) {
        await this.rustCore.initialize();
      }

      // Start price streaming for configured symbols
      await this.binanceService.startPriceStreaming(this.config.symbols);

      // Start monitoring loop
      this.startMonitoring();

      this.state.isRunning = true;
      this.emit('started');
      
      console.log('Trading engine started successfully');
      console.log('Monitoring symbols:', this.config.symbols);
      console.log('Live trading:', this.config.enableLiveTrading ? 'ENABLED' : 'DISABLED');

    } catch (error) {
      console.error('Failed to start trading engine:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.state.isRunning) {
      return;
    }

    // Stop monitoring
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    // Stop price streaming
    await this.binanceService.stopPriceStreaming();

    this.state.isRunning = false;
    this.emit('stopped');
    
    console.log('Trading engine stopped');
  }

  private startMonitoring(): void {
    // Check for signals every 30 seconds
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.checkForSignals();
      } catch (error) {
        console.error('Error in monitoring loop:', error);
        this.emit('monitoringError', error);
      }
    }, 30000);

    // Initial check
    setTimeout(() => this.checkForSignals(), 5000);
  }

  private async checkForSignals(): Promise<void> {
    try {
      // Get recent Glicko ratings (last 2 hours for safety margin)
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      
      const ratings = await this.prisma.glickoRatings.findMany({
        where: {
          symbol: { in: this.config.symbols },
          timestamp: { gte: twoHoursAgo }
        },
        orderBy: [
          { symbol: 'asc' },
          { timestamp: 'desc' }
        ]
      });

      if (ratings.length === 0) {
        console.log('No recent ratings found for signal generation');
        return;
      }

      // Calculate z-scores
      const zScores = await this.rustCore.calculateZScores(
        ratings.map(r => ({
          symbol: r.symbol,
          timestamp: r.timestamp,
          rating: parseFloat(r.rating.toString()),
          ratingDeviation: parseFloat(r.ratingDeviation.toString()),
          volatility: parseFloat(r.volatility.toString()),
          performanceScore: parseFloat(r.performanceScore.toString())
        })),
        this.config.movingAveragesPeriod
      );

      // Filter for strong signals
      const signals = zScores.filter(z => 
        Math.abs(z.zScore) >= this.config.zScoreThreshold
      );

      this.state.activeSignals = signals;

      // Process new signals
      for (const signal of signals) {
        await this.processSignal(signal);
      }

      this.lastSignalCheck = new Date();
      this.emit('signalsChecked', { 
        totalSignals: zScores.length, 
        strongSignals: signals.length 
      });

    } catch (error) {
      console.error('Error checking for signals:', error);
      this.emit('signalError', error);
    }
  }

  private async processSignal(signal: ZScoreSignal): Promise<void> {
    try {
      // Check if we're in cooldown for this symbol
      const cooldownEnd = this.failedTradeCooldown.get(signal.symbol);
      if (cooldownEnd && new Date() < cooldownEnd) {
        console.log(`Symbol ${signal.symbol} is in cooldown, skipping signal`);
        return;
      }

      // Risk management checks
      if (!this.passesRiskChecks(signal)) {
        return;
      }

      // Check position limits
      const activePositions = this.binanceService.getActivePositions();
      if (signal.signal === 'BUY' && activePositions.size >= this.config.maxPositions) {
        console.log('Maximum positions reached, skipping buy signal');
        return;
      }

      // Execute signal if live trading is enabled
      if (this.config.enableLiveTrading) {
        try {
          const order = await this.binanceService.executeZScoreSignal(
            signal,
            this.config.allocationPerPosition
          );

          if (order) {
            this.state.successfulTrades++;
            this.state.lastTradeTime = new Date();
            
            // If it's a buy order, set up stop-loss and take-profit
            if (signal.signal === 'BUY') {
              await this.setupTrailingOrders(signal.symbol, order);
            }
          }

          // Clear any cooldown for this symbol on successful trade
          this.failedTradeCooldown.delete(signal.symbol);

        } catch (error) {
          console.error(`Failed to execute signal for ${signal.symbol}:`, error);
          
          // Set cooldown for this symbol
          const cooldownEnd = new Date(Date.now() + this.config.riskManagement.cooldownPeriod * 60000);
          this.failedTradeCooldown.set(signal.symbol, cooldownEnd);
          
          this.state.failedTrades++;
        }
      } else {
        // Paper trading - just log the signal
        console.log(`PAPER TRADE: ${signal.signal} signal for ${signal.symbol} at z-score ${signal.zScore.toFixed(2)}`);
        this.emit('paperTrade', signal);
      }

      this.emit('signalProcessed', signal);

    } catch (error) {
      console.error('Error processing signal:', error);
      this.emit('signalError', error);
    }
  }

  private passesRiskChecks(signal: ZScoreSignal): boolean {
    // Check daily loss limit
    if (this.state.dailyPnL <= -this.config.riskManagement.maxDailyLoss) {
      console.log('Daily loss limit reached, skipping trades');
      this.emit('riskLimitHit', 'dailyLoss');
      return false;
    }

    // Check maximum drawdown
    if (this.state.currentDrawdown >= this.config.riskManagement.maxDrawdown) {
      console.log('Maximum drawdown reached, skipping trades');
      this.emit('riskLimitHit', 'maxDrawdown');
      return false;
    }

    // Additional risk checks can be added here
    
    return true;
  }

  private async setupTrailingOrders(symbol: string, buyOrder: any): Promise<void> {
    try {
      const currentPrice = await this.binanceService.getCurrentPrice(symbol);
      const quantity = parseFloat(buyOrder.executedQty || buyOrder.origQty);
      
      if (quantity > 0) {
        // Calculate stop-loss and take-profit prices
        const takeProfitPrice = (currentPrice * (1 + this.config.profitPercent / 100)).toFixed(8);
        const stopLossPrice = (currentPrice * (1 - this.config.stopLossPercent / 100)).toFixed(8);
        const stopLimitPrice = (currentPrice * (1 - this.config.stopLossPercent / 100 - 0.001)).toFixed(8);

        // Place OCO order (take-profit limit + stop-loss)
        await this.binanceService.placeOcoOrder(
          symbol,
          'SELL',
          quantity.toFixed(8),
          takeProfitPrice,
          stopLossPrice,
          stopLimitPrice
        );

        console.log(`OCO order placed for ${symbol}: TP=${takeProfitPrice}, SL=${stopLossPrice}`);
      }
    } catch (error) {
      console.error(`Failed to setup trailing orders for ${symbol}:`, error);
    }
  }

  async updateDailyPnL(): Promise<void> {
    try {
      // Calculate P&L from today's trades
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const todayOrders = await this.prisma.productionOrders.findMany({
        where: {
          time: { gte: todayStart },
          status: 'FILLED'
        },
        orderBy: { time: 'asc' }
      });

      // Simple P&L calculation (this could be more sophisticated)
      let dailyPnL = 0;
      const trades = new Map();

      for (const order of todayOrders) {
        const key = order.symbol;
        if (!trades.has(key)) {
          trades.set(key, { buy: null, sells: [] });
        }

        const trade = trades.get(key);
        const executedQty = parseFloat(order.executedQty.toString());
        const price = parseFloat(order.price.toString());

        if (order.side === 'BUY') {
          if (!trade.buy) {
            trade.buy = { quantity: executedQty, price };
          }
        } else if (order.side === 'SELL' && trade.buy) {
          const profit = executedQty * (price - trade.buy.price);
          dailyPnL += profit;
          trade.sells.push({ quantity: executedQty, price, profit });
        }
      }

      this.state.dailyPnL = dailyPnL;
      this.emit('dailyPnLUpdated', dailyPnL);

    } catch (error) {
      console.error('Error updating daily P&L:', error);
    }
  }

  getState(): TradingState {
    return { ...this.state };
  }

  getConfig(): TradingConfig {
    return { ...this.config };
  }

  updateConfig(newConfig: Partial<TradingConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.emit('configUpdated', this.config);
  }

  async getActivePositions(): Promise<any> {
    return {
      binancePositions: Array.from(this.binanceService.getActivePositions().entries()),
      lastUpdate: new Date(),
      totalPositions: this.binanceService.getActivePositions().size
    };
  }

  async emergencyStop(): Promise<void> {
    console.log('EMERGENCY STOP TRIGGERED');
    
    try {
      // Stop the trading engine
      await this.stop();
      
      // Cancel all open orders
      const openOrders = await this.prisma.productionOrders.findMany({
        where: {
          status: { in: ['NEW', 'PARTIALLY_FILLED'] }
        }
      });

      for (const order of openOrders) {
        try {
          await this.binanceService.cancelOrder(order.symbol, order.orderId);
        } catch (error) {
          console.error(`Failed to cancel order ${order.orderId}:`, error);
        }
      }

      this.emit('emergencyStop');
      console.log('Emergency stop completed');

    } catch (error) {
      console.error('Error during emergency stop:', error);
      this.emit('emergencyStopError', error);
    }
  }
}

export default TradingEngine;