import { EventEmitter } from 'events';
import { PrismaClient } from '@prisma/client';
import BinanceService from './BinanceService';
import { RustCoreService } from './RustCoreService';
import { ZScoreSignal, TradingParameterSet, ActivePosition, PaperPosition } from '../../types';
import { Logger, LogLevel } from '../../services/Logger';

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
  activePositions: Map<string, ActivePosition>;
  parameterSets: Map<string, TradingParameterSet>;
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
  private previousZScores: Map<string, number> = new Map();
  private zScoreHistory: Map<string, Array<{ timestamp: Date; zScore: number; rating: number }>> = new Map();
  private paperTradingBalance: number = 10000; // Start with $10k virtual balance
  private paperPositions: Map<string, PaperPosition> = new Map();
  private logger: Logger;

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
    this.logger = new Logger('./logs', LogLevel.INFO);
    
    this.state = {
      isRunning: false,
      totalTrades: 0,
      successfulTrades: 0,
      failedTrades: 0,
      currentDrawdown: 0,
      dailyPnL: 0,
      activeSignals: [],
      activePositions: new Map(),
      parameterSets: new Map()
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
      // Initialize logger first
      await this.logger.initialize();
      await this.logger.info('ENGINE', 'Initializing trading engine', {
        mode: this.config.enableLiveTrading ? 'LIVE' : 'PAPER',
        symbols: this.config.symbols,
        parameterSets: this.state.parameterSets.size
      });

      // Initialize services
      if (!this.binanceService.isReady()) {
        await this.binanceService.initialize();
        await this.logger.info('ENGINE', 'Binance service initialized');
      }

      if (!this.rustCore.isInitialized()) {
        await this.rustCore.initialize();
        await this.logger.info('ENGINE', 'Rust core service initialized');
      }

      // Start price streaming for all BASE_COINS (monitoring) but only trade parameter set symbols
      const baseCoins = (process.env.BASE_COINS?.split(',').map(coin => coin.trim()) || [])
        .filter(coin => coin !== 'USDT');
      const allMonitoringSymbols = baseCoins.map(coin => `${coin}USDT`);
      
      await this.binanceService.startPriceStreaming(allMonitoringSymbols);
      await this.logger.info('ENGINE', 'Price streaming started for all BASE_COINS', { 
        monitoringSymbols: allMonitoringSymbols,
        tradingSymbols: this.config.symbols 
      });

      // Start monitoring loop
      this.startMonitoring();

      this.state.isRunning = true;
      this.emit('started');
      
      await this.logger.info('ENGINE', 'Trading engine started successfully', {
        symbols: this.config.symbols,
        liveTrading: this.config.enableLiveTrading,
        parameterSets: this.state.parameterSets.size
      });

      console.log('Trading engine started successfully');
      console.log('Monitoring all BASE_COINS for Z-scores:', allMonitoringSymbols.join(', '));
      console.log('Trading enabled for parameter set symbols:', Array.from(this.state.parameterSets.keys()).join(', '));
      console.log('Live trading:', this.config.enableLiveTrading ? 'ENABLED' : 'DISABLED');

    } catch (error) {
      await this.logger.error('ENGINE', 'Failed to start trading engine', { error: (error as Error).message });
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
    // Check for signals every 5 minutes (300000ms) to align with 5m klines interval
    console.log('🔄 Starting monitoring loop - checking every 5 minutes');
    this.monitoringInterval = setInterval(async () => {
      try {
        console.log('🔄 [Monitoring] Starting 5-minute signal check cycle...');
        await this.checkForSignals();
        console.log('✅ [Monitoring] 5-minute signal check cycle completed');
        console.log('⏰ [Monitoring] Next check in 5 minutes...');
      } catch (error) {
        console.error('❌ [Monitoring] Error in monitoring loop:', error);
        await this.logger.error('MONITORING', 'Error in monitoring loop', { error: (error as Error).message });
        this.emit('monitoringError', error);
        // Don't stop monitoring on errors, just log and continue
      }
    }, 300000); // 5 minutes = 300000ms

    // Initial check
    console.log('🚀 [Monitoring] Starting initial signal check in 5 seconds...');
    setTimeout(async () => {
      try {
        await this.checkForSignals();
        console.log('⏰ [Monitoring] Next check in 5 minutes...');
      } catch (error) {
        console.error('❌ [Monitoring] Error in initial check:', error);
      }
    }, 5000);
  }

  private async checkForSignals(): Promise<void> {
    try {
      let ratings: any[] = [];
      
      if (!this.config.enableLiveTrading) {
        // Paper trading: Calculate real-time Z-scores from live market data
        await this.logger.info('SIGNALS', 'Paper trading: Calculating real-time Z-scores from market data');
        console.log('📊 Paper trading: Calculating real-time Z-scores from market data...');
        ratings = await this.calculateRealTimeRatings();
      } else {
        // Live trading: Use stored Glicko ratings
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        
        ratings = await this.prisma.glickoRatings.findMany({
          where: {
            symbol: { in: this.config.symbols },
            timestamp: { gte: twoHoursAgo }
          },
          orderBy: [
            { symbol: 'asc' },
            { timestamp: 'desc' }
          ]
        });
      }

      if (ratings.length === 0) {
        await this.logger.warn('SIGNALS', 'No ratings data available for signal generation');
        console.log('No ratings data available for signal generation');
        return;
      }

      // STEP 1: Calculate mean and standard deviation of ALL coins' Glicko ratings for this interval
      const allRatingValues = ratings.map(r => parseFloat(r.rating.toString()));
      const meanRating = allRatingValues.reduce((sum, rating) => sum + rating, 0) / allRatingValues.length;
      const variance = allRatingValues.reduce((sum, rating) => sum + Math.pow(rating - meanRating, 2), 0) / allRatingValues.length;
      const stdDevRating = Math.sqrt(variance);
      
      console.log(`📊 Cross-coin statistics for this interval: mean=${meanRating.toFixed(1)}, σ=${stdDevRating.toFixed(1)} across ${ratings.length} coins`);
      
      // STEP 2: Calculate Z-scores for each coin and update their Z-score history
      const currentZScores: { [symbol: string]: number } = {};
      
      for (const rating of ratings) {
        const tradingSymbol = `${rating.symbol}USDT`;
        const ratingValue = parseFloat(rating.rating.toString());
        
        // Z-score = (current_rating - mean_of_all_coins) / std_dev_of_all_coins
        const zScore = stdDevRating > 0 ? (ratingValue - meanRating) / stdDevRating : 0;
        currentZScores[tradingSymbol] = zScore;
        
        // Store this Z-score in the coin's history for moving average calculation
        if (!this.zScoreHistory) {
          this.zScoreHistory = new Map();
        }
        if (!this.zScoreHistory.has(tradingSymbol)) {
          this.zScoreHistory.set(tradingSymbol, []);
        }
        
        const history = this.zScoreHistory.get(tradingSymbol)!;
        history.push({
          timestamp: new Date(),
          zScore: zScore,
          rating: ratingValue
        });
        
        // Keep only the history we need (limit to max moving average period needed)
        const maxPeriod = Math.max(...Array.from(this.state.parameterSets.values()).map(p => p.movingAverages));
        if (history.length > maxPeriod + 10) { // Keep a few extra for safety
          history.shift();
        }
      }
      
      // STEP 3: Calculate moving averages of Z-scores and generate signals
      const allSignals: ZScoreSignal[] = [];
      
      console.log(`📊 Processing ${ratings.length} coins for moving average Z-score calculations`);
      console.log(`🎯 Trading enabled for ${this.state.parameterSets.size} parameter set symbols: ${Array.from(this.state.parameterSets.keys()).join(', ')}`);
      
      for (const rating of ratings) {
        const tradingSymbol = `${rating.symbol}USDT`;
        const ratingValue = parseFloat(rating.rating.toString());
        const currentZScore = currentZScores[tradingSymbol];
        
        // Get parameter set for moving average period
        const params = this.getParametersForSymbol(tradingSymbol);
        const movingAveragesPeriod = params.movingAverages;
        
        // Calculate moving average of Z-scores
        const history = this.zScoreHistory?.get(tradingSymbol) || [];
        let movingAverageZScore = currentZScore; // Default to current if insufficient history
        
        if (history.length >= movingAveragesPeriod) {
          const recentZScores = history.slice(-movingAveragesPeriod);
          movingAverageZScore = recentZScores.reduce((sum, h) => sum + h.zScore, 0) / recentZScores.length;
        }
        
        // Store current z-score for ALL symbols (needed for reversal detection)
        this.previousZScores.set(tradingSymbol, movingAverageZScore);
        
        // Get threshold and determine if this symbol can trade
        const isInParameterSet = this.state.parameterSets.has(tradingSymbol);
        const threshold = isInParameterSet ? params.zScoreThreshold : this.config.zScoreThreshold;
        
        console.log(`📊 [${tradingSymbol}] Current Z: ${currentZScore.toFixed(3)}, MA Z-score: ${movingAverageZScore.toFixed(3)} (${movingAveragesPeriod}), Threshold: ±${threshold}, Rating: ${ratingValue.toFixed(0)}, History: ${history.length}${!isInParameterSet ? ' (monitoring only)' : ' (trading enabled)'}`);
        
        await this.logger.info('Z_SCORE', `Z-score calculated for ${tradingSymbol}`, {
          currentZScore,
          movingAverageZScore,
          threshold,
          rating: ratingValue,
          meanRating: meanRating,
          stdDevRating: stdDevRating,
          movingAveragesPeriod,
          historyLength: history.length,
          canTrade: isInParameterSet
        });
        
        // STEP 4: Generate trading signals based on moving average Z-score threshold
        if (isInParameterSet && Math.abs(movingAverageZScore) >= params.zScoreThreshold) {
          const signal = movingAverageZScore > 0 ? 'BUY' : 'SELL';
          console.log(`🚨 [${tradingSymbol}] TRADING SIGNAL TRIGGERED: ${signal} (MA Z-score: ${movingAverageZScore.toFixed(3)} >= ±${params.zScoreThreshold})`);
          
          allSignals.push({
            symbol: tradingSymbol,
            timestamp: new Date(),
            currentRating: ratingValue,
            movingAverage: meanRating,
            standardDeviation: stdDevRating,
            zScore: movingAverageZScore,
            signal: signal as 'BUY' | 'SELL'
          });
        } else if (!isInParameterSet) {
          console.log(`📊 [${tradingSymbol}] MA Z-score: ${movingAverageZScore.toFixed(3)} (monitoring only - no trading)`);
        }
      }

      const signals = allSignals;

      // Enhance signals with additional data from ratings
      for (const signal of signals) {
        const baseSymbol = signal.symbol.replace('USDT', '');
        const matchingRatings = ratings.filter(r => r.symbol === baseSymbol);
        if (matchingRatings.length > 0) {
          const latestRating = matchingRatings[matchingRatings.length - 1];
          signal.currentRating = parseFloat(latestRating.rating.toString());
        }
      }

      // Update paper trading positions and check OCO conditions
      if (!this.config.enableLiveTrading) {
        await this.updatePaperPositions();
      }
      
      // Check for Z-score reversals on existing positions
      await this.checkForZScoreReversals();

      this.state.activeSignals = signals;

      // Process new signals
      for (const signal of signals) {
        await this.processSignal(signal);
      }

      this.lastSignalCheck = new Date();
      
      await this.logger.debug('SIGNALS', 'Signal check completed', {
        totalRatings: ratings.length,
        strongSignals: signals.length,
        signalDetails: signals.map(s => ({ symbol: s.symbol, zScore: s.zScore, signal: s.signal }))
      });
      
      this.emit('signalsChecked', { 
        totalSignals: ratings.length, 
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
          // Execute live trade with real Binance OCO orders
          await this.executeLiveTrade(signal);
          
          this.state.lastTradeTime = new Date();
          
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
        // Paper trading - simulate the trade with virtual positions and OCO
        await this.executePaperTrade(signal);
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
      const params = this.getParametersForSymbol(symbol);
      const currentPrice = await this.binanceService.getCurrentPrice(symbol);
      const quantity = parseFloat(buyOrder.executedQty || buyOrder.origQty);
      
      if (quantity > 0) {
        // Calculate stop-loss and take-profit prices using symbol-specific parameters
        const takeProfitPrice = (currentPrice * (1 + params.profitPercent / 100)).toFixed(8);
        const stopLossPrice = (currentPrice * (1 - params.stopLossPercent / 100)).toFixed(8);
        const stopLimitPrice = (currentPrice * (1 - params.stopLossPercent / 100 - 0.001)).toFixed(8);

        // Place OCO order (take-profit limit + stop-loss)
        const ocoOrder = await this.binanceService.placeOcoOrder(
          symbol,
          'SELL',
          quantity.toFixed(8),
          takeProfitPrice,
          stopLossPrice,
          stopLimitPrice
        );

        // Track the active position with OCO order details
        const position: ActivePosition = {
          symbol,
          entryPrice: currentPrice,
          quantity,
          entryTime: new Date(),
          ocoOrderId: ocoOrder.orderListId?.toString(),
          takeProfitOrderId: ocoOrder.orders?.find((o: any) => o.type === 'LIMIT')?.orderId?.toString(),
          stopLossOrderId: ocoOrder.orders?.find((o: any) => o.type === 'STOP_LOSS_LIMIT')?.orderId?.toString(),
          zScoreThreshold: params.zScoreThreshold,
          parameters: params
        };

        this.state.activePositions.set(symbol, position);
        console.log(`OCO order placed for ${symbol}: TP=${takeProfitPrice}, SL=${stopLossPrice}`);
      }
    } catch (error) {
      console.error(`Failed to setup trailing orders for ${symbol}:`, error);
    }
  }

  /**
   * Check for Z-score reversals on active positions and execute market sells
   */
  private async checkForZScoreReversals(): Promise<void> {
    // Check live trading positions
    for (const [symbol, position] of this.state.activePositions) {
      try {
        const currentZScore = this.previousZScores.get(symbol);
        if (currentZScore === undefined) continue;

        const params = position.parameters;
        
        // Check if Z-score has reversed (crossed negative threshold)
        if (currentZScore <= -params.zScoreThreshold) {
          await this.logger.info('REVERSAL', `Z-score reversal detected for ${symbol}`, {
            currentZScore,
            threshold: params.zScoreThreshold,
            position: {
              entryPrice: position.entryPrice,
              quantity: position.quantity,
              entryTime: position.entryTime
            }
          });
          console.log(`Z-score reversal detected for ${symbol}: ${currentZScore.toFixed(2)} <= -${params.zScoreThreshold}`);
          
          // Cancel existing OCO orders
          if (position.ocoOrderId) {
            try {
              await this.binanceService.cancelOrder(symbol, position.ocoOrderId);
              await this.logger.info('ORDERS', `Cancelled OCO order for ${symbol}`, { ocoOrderId: position.ocoOrderId });
              console.log(`Cancelled OCO order ${position.ocoOrderId} for ${symbol}`);
            } catch (error) {
              await this.logger.error('ORDERS', `Failed to cancel OCO order for ${symbol}`, { 
                ocoOrderId: position.ocoOrderId,
                error: (error as Error).message 
              });
              console.warn(`Failed to cancel OCO order for ${symbol}:`, error);
            }
          }

          // Execute market sell for entire position
          if (this.config.enableLiveTrading) {
            try {
              const sellOrder = await this.binanceService.placeOrder({
                symbol,
                side: 'SELL',
                type: 'MARKET',
                quantity: position.quantity.toString()
              });

              await this.logger.logPosition('MARKET_SELL_REVERSAL', symbol, {
                sellOrder,
                zScore: currentZScore,
                position,
                reason: 'Z_SCORE_REVERSAL'
              });
              console.log(`Market sell executed for ${symbol} due to Z-score reversal:`, sellOrder);
              
              // Remove position from tracking
              this.state.activePositions.delete(symbol);
              this.state.successfulTrades++;
              this.emit('zScoreReversal', { symbol, position, sellOrder });
              
            } catch (error) {
              await this.logger.error('TRADING', `Failed to execute market sell for ${symbol}`, {
                symbol,
                error: (error as Error).message,
                position
              });
              console.error(`Failed to execute market sell for ${symbol}:`, error);
            }
          } else {
            // Paper trading - just log the action
            await this.logger.logPaperTrade(symbol, 'MARKET_SELL', {
              zScore: currentZScore,
              reason: 'Z_SCORE_REVERSAL',
              position,
              timestamp: new Date()
            });
            console.log(`PAPER TRADE: Market sell ${symbol} due to Z-score reversal (z=${currentZScore.toFixed(2)})`);
            this.state.activePositions.delete(symbol);
            this.emit('paperTrade', { 
              symbol, 
              signal: 'SELL', 
              reason: 'Z_SCORE_REVERSAL',
              zScore: currentZScore
            });
          }
        }
      } catch (error) {
        console.error(`Error checking Z-score reversal for ${symbol}:`, error);
      }
    }

    // Check paper trading positions for Z-score reversals
    for (const [symbol, position] of this.paperPositions) {
      try {
        const currentZScore = this.previousZScores.get(symbol);
        if (currentZScore === undefined) continue;

        const params = position.parameters;
        
        // Check if Z-score has reversed (crossed negative threshold)
        if (currentZScore <= -params.zScoreThreshold) {
          await this.logger.info('REVERSAL', `Paper position Z-score reversal detected for ${symbol}`, {
            currentZScore,
            threshold: params.zScoreThreshold,
            position: {
              entryPrice: position.entryPrice,
              quantity: position.quantity,
              entryTime: position.entryTime
            }
          });
          console.log(`📝 PAPER POSITION: Z-score reversal detected for ${symbol}: ${currentZScore.toFixed(2)} <= -${params.zScoreThreshold}`);
          
          // Close paper position due to Z-score reversal
          const currentPrice = await this.binanceService.getCurrentPrice(symbol);
          await this.closePaperPosition(symbol, currentPrice, 'Z_SCORE_REVERSAL');
        }
      } catch (error) {
        console.error(`Error checking Z-score reversal for paper position ${symbol}:`, error);
      }
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

  /**
   * Set parameter sets for symbol-specific trading parameters
   */
  setParameterSets(parameterSets: TradingParameterSet[]): void {
    this.state.parameterSets.clear();
    for (const params of parameterSets) {
      if (params.enabled !== false) {
        this.state.parameterSets.set(params.symbol, params);
      }
    }
    console.log(`Configured ${this.state.parameterSets.size} parameter sets`);
  }

  /**
   * Get parameters for a specific symbol, falling back to config defaults
   */
  private getParametersForSymbol(symbol: string): TradingParameterSet {
    const symbolParams = this.state.parameterSets.get(symbol);
    if (symbolParams) {
      return symbolParams;
    }

    // Fallback to global config
    return {
      symbol,
      baseAsset: symbol.replace('USDT', ''),
      quoteAsset: 'USDT',
      zScoreThreshold: this.config.zScoreThreshold,
      movingAverages: this.config.movingAveragesPeriod,
      profitPercent: this.config.profitPercent,
      stopLossPercent: this.config.stopLossPercent,
      allocationPercent: this.config.allocationPerPosition,
      enabled: true
    };
  }

  async getActivePositions(): Promise<any> {
    return {
      binancePositions: Array.from(this.binanceService.getActivePositions().entries()),
      tradingEnginePositions: Array.from(this.state.activePositions.entries()),
      parameterSets: Array.from(this.state.parameterSets.entries()),
      lastUpdate: new Date(),
      totalPositions: this.binanceService.getActivePositions().size,
      trackedPositions: this.state.activePositions.size
    };
  }

  /**
   * Get current Z-scores for monitoring
   */
  getCurrentZScores(): Map<string, number> {
    return new Map(this.previousZScores);
  }

  /**
   * Get parameter sets currently in use
   */
  getParameterSets(): TradingParameterSet[] {
    return Array.from(this.state.parameterSets.values());
  }

  /**
   * Calculate real-time Glicko ratings from live market data for paper trading
   */
  private async calculateRealTimeRatings(): Promise<any[]> {
    try {
      const ratings: any[] = [];
      const now = new Date();
      
      // Get all BASE_COINS from environment to monitor (exclude USDT since USDTUSDT is invalid)
      const baseCoins = (process.env.BASE_COINS?.split(',').map(coin => coin.trim()) || [])
        .filter(coin => coin !== 'USDT');
      const monitoringSymbols = baseCoins.map(coin => `${coin}USDT`);
      
      console.log(`📊 Monitoring ${monitoringSymbols.length} symbols for Glicko rating calculations: ${monitoringSymbols.join(', ')}`);
      await this.logger.info('MONITORING', `Calculating Glicko ratings for all BASE_COINS`, { 
        totalSymbols: monitoringSymbols.length, 
        symbols: monitoringSymbols,
        tradingSymbols: this.config.symbols
      });
      
      // Get recent price data for each symbol in BASE_COINS
      for (const symbol of monitoringSymbols) {
        const baseAsset = symbol.replace('USDT', '');
        
        try {
          // Get parameter set for this symbol to determine movingAverages period
          const params = this.getParametersForSymbol(symbol);
          const movingAveragesPeriod = params.movingAverages;
          
          // Fetch enough klines for Glicko calculations (need extra for historical comparison)
          const totalPeriodsNeeded = Math.max(50, movingAveragesPeriod * 2); // Ensure we have enough data
          
          await this.logger.debug('DATA', `Fetching ${totalPeriodsNeeded} klines for ${symbol} (movingAverages: ${movingAveragesPeriod})`);
          console.log(`🔍 Fetching ${totalPeriodsNeeded} klines for ${symbol} (MA period: ${movingAveragesPeriod})...`);
          
          const klines = await this.binanceService.getKlines(
            symbol,
            '5m',
            Date.now() - totalPeriodsNeeded * 5 * 60 * 1000, // totalPeriodsNeeded * 5 minutes * 60 seconds * 1000ms
            undefined,
            totalPeriodsNeeded
          );
          
          await this.logger.debug('DATA', `Retrieved ${klines?.length || 0} klines for ${symbol}`);
          console.log(`📊 Got ${klines?.length || 0} klines for ${symbol}`);

          if (klines && klines.length >= movingAveragesPeriod) {
            // Calculate Glicko ratings for each 5-minute interval
            const glickoRatings = await this.calculateGlickoRatingsForIntervals(symbol, klines, movingAveragesPeriod);
            
            if (glickoRatings.length > 0) {
              // Calculate moving average of Glicko ratings
              const recentRatings = glickoRatings.slice(-movingAveragesPeriod);
              const ratingValues = recentRatings.map(r => r.rating);
              
              // Calculate statistics
              const averageRating = ratingValues.reduce((sum, r) => sum + r, 0) / ratingValues.length;
              const variance = ratingValues.reduce((sum, r) => sum + Math.pow(r - averageRating, 2), 0) / ratingValues.length;
              const standardDeviation = Math.sqrt(variance);
              
              // Latest rating for current signal
              const latestRating = glickoRatings[glickoRatings.length - 1];
              
              ratings.push({
                symbol: baseAsset,
                timestamp: now,
                rating: latestRating.rating,
                ratingDeviation: latestRating.ratingDeviation,
                volatility: latestRating.volatility,
                movingAverageRating: averageRating,
                standardDeviation: standardDeviation,
                movingAveragesPeriod: movingAveragesPeriod,
                glickoRatingsCount: glickoRatings.length
              });
              
              await this.logger.info('RATINGS', `Glicko ratings calculated for ${baseAsset}`, {
                latestRating: latestRating.rating,
                movingAverage: averageRating,
                standardDeviation: standardDeviation,
                movingAveragesPeriod: movingAveragesPeriod,
                totalRatings: glickoRatings.length,
                klinesCount: klines.length
              });
              
              console.log(`📊 ${baseAsset}: rating=${latestRating.rating.toFixed(0)}, MA=${averageRating.toFixed(0)}, σ=${standardDeviation.toFixed(1)}, periods=${movingAveragesPeriod}, total=${glickoRatings.length}`);
            } else {
              await this.logger.warn('RATINGS', `Failed to calculate Glicko ratings for ${symbol}`, { klinesCount: klines.length });
              console.warn(`⚠️ Failed to calculate Glicko ratings for ${symbol}`);
            }
          } else {
            await this.logger.warn('DATA', `Insufficient klines data for ${symbol}`, { 
              klinesCount: klines?.length || 0, 
              required: movingAveragesPeriod 
            });
            console.warn(`⚠️ Insufficient klines data for ${symbol}: ${klines?.length || 0} periods (need ${movingAveragesPeriod})`);
          }
        } catch (error) {
          await this.logger.error('DATA', `Failed to get data for ${symbol}`, { error: (error as Error).message });
          console.warn(`⚠️ Failed to get data for ${symbol}:`, (error as Error).message);
        }
      }
      
      return ratings;
    } catch (error) {
      console.error('Error calculating real-time ratings:', error);
      return [];
    }
  }

  /**
   * Calculate Glicko-2 ratings for each 5-minute interval based on price performance
   */
  private async calculateGlickoRatingsForIntervals(symbol: string, klines: any[], movingAveragesPeriod: number): Promise<any[]> {
    try {
      const ratings: any[] = [];
      const baseAsset = symbol.replace('USDT', '');
      
      // Glicko-2 constants
      const initialRating = 1500;
      const initialRatingDeviation = 350;
      const initialVolatility = 0.06;
      const tau = 0.5; // System constant (volatility change)
      
      console.log(`🔢 Calculating Glicko ratings for ${baseAsset} over ${klines.length} intervals (MA: ${movingAveragesPeriod})`);
      
      // Start with initial Glicko values
      let currentRating = initialRating;
      let currentRatingDeviation = initialRatingDeviation;
      let currentVolatility = initialVolatility;
      
      // Calculate ratings for each interval (starting from the second kline since we need price changes)
      for (let i = 1; i < klines.length; i++) {
        const prevKline = klines[i - 1];
        const currKline = klines[i];
        
        // Calculate price performance for this interval
        const priceChange = (currKline.close - prevKline.close) / prevKline.close;
        const volumeRatio = currKline.volume / (prevKline.volume || 1);
        
        // Convert price performance to a pseudo-game result
        // Positive price change = "win", negative = "loss", neutral = "draw"
        let gameResult: number;
        if (Math.abs(priceChange) < 0.001) { // < 0.1% change = draw
          gameResult = 0.5;
        } else if (priceChange > 0) { // Price up = win
          gameResult = Math.min(1.0, 0.5 + priceChange * 50); // Scale performance
        } else { // Price down = loss
          gameResult = Math.max(0.0, 0.5 + priceChange * 50); // Scale performance
        }
        
        // Calculate opponent rating based on market conditions
        // Higher volume = stronger opponent, higher volatility = stronger opponent
        const marketVolatility = this.calculateVolatility(klines.slice(Math.max(0, i - 10), i + 1));
        const opponentRating = initialRating + (marketVolatility * 1000) + (Math.log(volumeRatio) * 100);
        const opponentRatingDeviation = initialRatingDeviation;
        
        // Perform Glicko-2 update (simplified version)
        const updatedRating = this.updateGlickoRating(
          currentRating,
          currentRatingDeviation,
          currentVolatility,
          opponentRating,
          opponentRatingDeviation,
          gameResult,
          tau
        );
        
        currentRating = updatedRating.rating;
        currentRatingDeviation = updatedRating.ratingDeviation;
        currentVolatility = updatedRating.volatility;
        
        ratings.push({
          interval: i,
          timestamp: new Date(currKline.openTime),
          rating: currentRating,
          ratingDeviation: currentRatingDeviation,
          volatility: currentVolatility,
          priceChange: priceChange,
          gameResult: gameResult,
          opponentRating: opponentRating,
          close: currKline.close,
          volume: currKline.volume
        });
      }
      
      await this.logger.debug('GLICKO', `Calculated ${ratings.length} Glicko ratings for ${baseAsset}`, {
        finalRating: currentRating,
        initialRating: initialRating,
        ratingChange: currentRating - initialRating,
        intervals: ratings.length
      });
      
      console.log(`🔢 ${baseAsset}: ${ratings.length} intervals calculated, final rating: ${currentRating.toFixed(0)} (change: ${(currentRating - initialRating).toFixed(0)})`);
      
      return ratings;
    } catch (error) {
      console.error(`Error calculating Glicko ratings for ${symbol}:`, error);
      return [];
    }
  }

  /**
   * Simplified Glicko-2 rating update
   */
  private updateGlickoRating(
    rating: number,
    ratingDeviation: number,
    volatility: number,
    opponentRating: number,
    opponentRatingDeviation: number,
    gameResult: number,
    tau: number
  ): { rating: number; ratingDeviation: number; volatility: number } {
    // Convert to Glicko-2 scale
    const mu = (rating - 1500) / 173.7178;
    const phi = ratingDeviation / 173.7178;
    const sigma = volatility;
    const muOpponent = (opponentRating - 1500) / 173.7178;
    const phiOpponent = opponentRatingDeviation / 173.7178;
    
    // Calculate g(phi) function
    const g = (phi: number) => 1 / Math.sqrt(1 + 3 * phi * phi / (Math.PI * Math.PI));
    
    // Calculate E function (expected score)
    const E = (mu: number, muOpponent: number, phiOpponent: number) => 
      1 / (1 + Math.exp(-g(phiOpponent) * (mu - muOpponent)));
    
    const gPhi = g(phiOpponent);
    const expectedScore = E(mu, muOpponent, phiOpponent);
    const variance = 1 / (gPhi * gPhi * expectedScore * (1 - expectedScore));
    
    // Simplified volatility update (skip iterative calculation for performance)
    const delta = variance * gPhi * (gameResult - expectedScore);
    const newSigma = Math.sqrt(sigma * sigma + delta * delta / variance);
    
    // Update rating deviation
    const newPhiSquared = 1 / (1 / (phi * phi + newSigma * newSigma) + 1 / variance);
    const newPhi = Math.sqrt(newPhiSquared);
    
    // Update rating
    const newMu = mu + newPhiSquared * gPhi * (gameResult - expectedScore);
    
    // Convert back to Glicko scale
    return {
      rating: newMu * 173.7178 + 1500,
      ratingDeviation: newPhi * 173.7178,
      volatility: Math.min(0.2, Math.max(0.01, newSigma)) // Bound volatility
    };
  }

  /**
   * Calculate price volatility from kline data
   */
  private calculateVolatility(klines: any[]): number {
    if (klines.length < 2) return 0.1; // Default volatility
    
    const returns = [];
    for (let i = 1; i < klines.length; i++) {
      const prevPrice = klines[i - 1].close;
      const currPrice = klines[i].close;
      const logReturn = Math.log(currPrice / prevPrice);
      returns.push(logReturn);
    }
    
    // Calculate standard deviation of returns
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    return Math.sqrt(variance);
  }

  /**
   * Execute a live trade with real Binance OCO orders
   */
  private async executeLiveTrade(signal: ZScoreSignal): Promise<void> {
    try {
      const params = this.getParametersForSymbol(signal.symbol);
      const currentPrice = await this.binanceService.getCurrentPrice(signal.symbol);
      
      if (signal.signal === 'BUY') {
        // Check if we already have a position
        if (this.state.activePositions.has(signal.symbol)) {
          console.log(`Already have position in ${signal.symbol}, skipping buy signal`);
          return;
        }
        
        // Get account balance
        const account = await this.binanceService.getAccountInfo();
        const usdtBalance = account.balances.find((b: any) => b.asset === 'USDT');
        const availableUsdt = parseFloat(usdtBalance?.free || '0');
        
        // Calculate position size
        const allocationPercent = params.allocationPercent || 10;
        const allocationAmount = availableUsdt * (allocationPercent / 100);
        const quantity = allocationAmount / currentPrice;
        
        if (allocationAmount < 10) {
          console.log(`Insufficient balance for ${signal.symbol}: $${allocationAmount.toFixed(2)}`);
          return;
        }
        
        // Step 1: Place market buy order first
        const buyOrder = await this.binanceService.placeOrder({
          symbol: signal.symbol,
          side: 'BUY',
          type: 'MARKET',
          quoteOrderQty: allocationAmount.toFixed(2)
        });
        
        console.log(`🔥 LIVE BUY: ${signal.symbol} - Market order executed`);
        console.log(`   Order ID: ${buyOrder.orderId}`);
        console.log(`   Quantity: ${buyOrder.executedQty}`);
        console.log(`   Average Price: $${buyOrder.cummulativeQuoteQty / buyOrder.executedQty}`);
        
        // Step 2: Immediately place OCO sell order with the executed quantity
        const executedQuantity = parseFloat(buyOrder.executedQty);
        const avgPrice = parseFloat(buyOrder.cummulativeQuoteQty) / executedQuantity;
        
        // Calculate OCO prices based on actual execution price
        const takeProfitPrice = (avgPrice * (1 + params.profitPercent / 100)).toFixed(8);
        const stopLossPrice = (avgPrice * (1 - params.stopLossPercent / 100)).toFixed(8);
        const stopLimitPrice = (avgPrice * (1 - params.stopLossPercent / 100 - 0.001)).toFixed(8); // Slightly lower for stop limit
        
        const ocoOrder = await this.binanceService.placeOcoOrder(
          signal.symbol,
          'SELL',
          executedQuantity.toFixed(8),
          takeProfitPrice,
          stopLossPrice,
          stopLimitPrice
        );
        
        console.log(`🎯 OCO ORDER PLACED for ${signal.symbol}:`);
        console.log(`   OCO Order ID: ${ocoOrder.orderListId}`);
        console.log(`   Take Profit: $${takeProfitPrice} (+${params.profitPercent}%)`);
        console.log(`   Stop Loss: $${stopLossPrice} (-${params.stopLossPercent}%)`);
        
        // Track the active position
        const activePosition = {
          symbol: signal.symbol,
          entryPrice: avgPrice,
          quantity: executedQuantity,
          entryTime: new Date(),
          buyOrderId: buyOrder.orderId,
          ocoOrderId: ocoOrder.orderListId,
          takeProfitOrderId: ocoOrder.orders.find((o: any) => o.side === 'SELL' && !o.stopPrice)?.orderId,
          stopLossOrderId: ocoOrder.orders.find((o: any) => o.side === 'SELL' && o.stopPrice)?.orderId,
          takeProfitPrice: parseFloat(takeProfitPrice),
          stopLossPrice: parseFloat(stopLossPrice),
          parameters: params,
          zScoreThreshold: params.zScoreThreshold
        };
        
        this.state.activePositions.set(signal.symbol, activePosition);
        
        await this.logger.logPosition('BUY_WITH_OCO', signal.symbol, {
          buyOrder,
          ocoOrder,
          zScore: signal.zScore,
          position: activePosition,
          reason: 'Z_SCORE_THRESHOLD'
        });
        
        this.state.successfulTrades++;
        this.emit('liveTradeExecuted', { 
          ...signal, 
          action: 'BUY_WITH_OCO', 
          buyOrder, 
          ocoOrder, 
          position: activePosition 
        });
        
      } else if (signal.signal === 'SELL') {
        // Handle sell signal - this will be handled by Z-score reversal logic
        console.log(`SELL signal received for ${signal.symbol} - will be handled by reversal detection`);
      }
      
    } catch (error) {
      console.error(`Error executing live trade for ${signal.symbol}:`, error);
      await this.logger.error('LIVE_TRADE', `Failed to execute live trade for ${signal.symbol}`, { 
        error: (error as Error).message,
        signal 
      });
    }
  }

  /**
   * Execute a paper trade with virtual positions and OCO logic
   */
  private async executePaperTrade(signal: ZScoreSignal): Promise<void> {
    try {
      const params = this.getParametersForSymbol(signal.symbol);
      const currentPrice = await this.binanceService.getCurrentPrice(signal.symbol);
      
      if (signal.signal === 'BUY') {
        // Check if we already have a position
        if (this.paperPositions.has(signal.symbol)) {
          console.log(`PAPER TRADE: Already have position in ${signal.symbol}, skipping buy signal`);
          return;
        }
        
        // Calculate position size based on allocation
        const allocationPercent = params.allocationPercent || 10; // Default to 10% if not specified
        const allocationAmount = this.paperTradingBalance * (allocationPercent / 100);
        const quantity = allocationAmount / currentPrice;
        
        if (allocationAmount < 10) { // Minimum $10 position
          console.log(`PAPER TRADE: Insufficient balance for ${signal.symbol}: $${allocationAmount.toFixed(2)}`);
          return;
        }
        
        // Calculate OCO prices
        const takeProfitPrice = currentPrice * (1 + params.profitPercent / 100);
        const stopLossPrice = currentPrice * (1 - params.stopLossPercent / 100);
        
        // Create paper position
        const paperPosition: PaperPosition = {
          symbol: signal.symbol,
          entryPrice: currentPrice,
          quantity: quantity,
          entryTime: new Date(),
          takeProfitPrice: takeProfitPrice,
          stopLossPrice: stopLossPrice,
          parameters: params,
          entryValue: allocationAmount
        };
        
        this.paperPositions.set(signal.symbol, paperPosition);
        this.paperTradingBalance -= allocationAmount;
        
        await this.logger.logPaperTrade(signal.symbol, 'BUY', {
          zScore: signal.zScore,
          entryPrice: currentPrice,
          quantity: quantity,
          entryValue: allocationAmount,
          takeProfitPrice: takeProfitPrice,
          stopLossPrice: stopLossPrice,
          remainingBalance: this.paperTradingBalance,
          reason: 'Z_SCORE_THRESHOLD',
          timestamp: new Date()
        });
        
        console.log(`📝 PAPER TRADE BUY: ${signal.symbol} at $${currentPrice.toFixed(4)}`);
        console.log(`   Quantity: ${quantity.toFixed(6)}, Value: $${allocationAmount.toFixed(2)}`);
        console.log(`   Take Profit: $${takeProfitPrice.toFixed(4)} (+${params.profitPercent}%)`);
        console.log(`   Stop Loss: $${stopLossPrice.toFixed(4)} (-${params.stopLossPercent}%)`);
        console.log(`   Remaining Balance: $${this.paperTradingBalance.toFixed(2)}`);
        
        this.state.successfulTrades++;
        this.emit('paperTrade', { ...signal, action: 'BUY_ENTRY', position: paperPosition });
        
      } else if (signal.signal === 'SELL') {
        // Handle sell signal (close position)
        const position = this.paperPositions.get(signal.symbol);
        if (!position) {
          console.log(`PAPER TRADE: No position to sell for ${signal.symbol}`);
          return;
        }
        
        await this.closePaperPosition(signal.symbol, currentPrice, 'Z_SCORE_REVERSAL');
      }
      
    } catch (error) {
      console.error(`Error executing paper trade for ${signal.symbol}:`, error);
      await this.logger.error('PAPER_TRADE', `Failed to execute paper trade for ${signal.symbol}`, { 
        error: (error as Error).message,
        signal 
      });
    }
  }

  /**
   * Close a paper trading position
   */
  private async closePaperPosition(symbol: string, currentPrice: number, reason: string): Promise<void> {
    const position = this.paperPositions.get(symbol);
    if (!position) return;
    
    const exitValue = position.quantity * currentPrice;
    const pnl = exitValue - position.entryValue;
    const pnlPercent = (pnl / position.entryValue) * 100;
    
    // Return funds to balance
    this.paperTradingBalance += exitValue;
    
    // Remove position
    this.paperPositions.delete(symbol);
    
    await this.logger.logPaperTrade(symbol, 'SELL', {
      exitPrice: currentPrice,
      quantity: position.quantity,
      exitValue: exitValue,
      pnl: pnl,
      pnlPercent: pnlPercent,
      holdingTime: Date.now() - position.entryTime.getTime(),
      newBalance: this.paperTradingBalance,
      reason: reason,
      timestamp: new Date()
    });
    
    console.log(`📝 PAPER TRADE SELL: ${symbol} at $${currentPrice.toFixed(4)}`);
    console.log(`   Quantity: ${position.quantity.toFixed(6)}, Exit Value: $${exitValue.toFixed(2)}`);
    console.log(`   P&L: $${pnl.toFixed(2)} (${pnlPercent > 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)`);
    console.log(`   Reason: ${reason}`);
    console.log(`   New Balance: $${this.paperTradingBalance.toFixed(2)}`);
    
    this.state.successfulTrades++;
    this.emit('paperTrade', { 
      symbol, 
      action: 'SELL_EXIT', 
      position, 
      exitPrice: currentPrice,
      pnl,
      pnlPercent,
      reason 
    });
  }

  /**
   * Update paper trading positions with current prices and check OCO conditions
   */
  private async updatePaperPositions(): Promise<void> {
    for (const [symbol, position] of this.paperPositions) {
      try {
        const currentPrice = await this.binanceService.getCurrentPrice(symbol);
        
        // Update unrealized P&L
        const currentValue = position.quantity * currentPrice;
        position.unrealizedPnL = currentValue - position.entryValue;
        position.unrealizedPnLPercent = (position.unrealizedPnL / position.entryValue) * 100;
        
        // Check OCO conditions (take profit or stop loss)
        if (currentPrice >= position.takeProfitPrice) {
          console.log(`🎯 PAPER TRADE: Take profit triggered for ${symbol} at $${currentPrice.toFixed(4)}`);
          await this.closePaperPosition(symbol, currentPrice, 'TAKE_PROFIT');
        } else if (currentPrice <= position.stopLossPrice) {
          console.log(`🛑 PAPER TRADE: Stop loss triggered for ${symbol} at $${currentPrice.toFixed(4)}`);
          await this.closePaperPosition(symbol, currentPrice, 'STOP_LOSS');
        }
        
      } catch (error) {
        console.error(`Error updating paper position for ${symbol}:`, error);
      }
    }
  }

  /**
   * Get paper trading portfolio status
   */
  getPaperTradingStatus(): {
    balance: number;
    positions: PaperPosition[];
    totalValue: number;
    totalUnrealizedPnL: number;
  } {
    const positions = Array.from(this.paperPositions.values());
    const totalPositionValue = positions.reduce((sum, pos) => {
      const currentValue = pos.quantity * (pos.unrealizedPnL ? 
        pos.entryPrice + (pos.unrealizedPnL / pos.quantity) : pos.entryPrice);
      return sum + currentValue;
    }, 0);
    
    const totalUnrealizedPnL = positions.reduce((sum, pos) => sum + (pos.unrealizedPnL || 0), 0);
    
    return {
      balance: this.paperTradingBalance,
      positions: positions,
      totalValue: this.paperTradingBalance + totalPositionValue,
      totalUnrealizedPnL: totalUnrealizedPnL
    };
  }

  /**
   * Get active live trading positions
   */
  getActivePositions(): Map<string, any> {
    return this.state.activePositions;
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