import { EventEmitter } from 'events';
import BinanceService from './BinanceService';
import { RustCoreService } from './RustCoreService';
import { ZScoreSignal, TradingParameterSet, ActivePosition, PaperPosition } from '../../types';
import { Logger, LogLevel } from '../../services/Logger';
import { AllocationManager } from '../../services/AllocationManager';
import { SignalGeneratorService, RatingInput } from '../../services/SignalGeneratorService';
import { OCOOrderService } from '../../services/OCOOrderService';
import { GlickoEngine } from '../../services/GlickoEngine';
import { TradingPairsGenerator } from '../../utils/TradingPairsGenerator';

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
  private allocationManager: AllocationManager;
  private signalGenerator: SignalGeneratorService;
  private ocoOrderService: OCOOrderService;
  private glickoEngine: GlickoEngine;

  constructor(
    binanceService: BinanceService,
    rustCore: RustCoreService,
    config: TradingConfig
  ) {
    super();
    this.binanceService = binanceService;
    this.rustCore = rustCore;
    this.config = config;
    this.logger = new Logger('./logs', LogLevel.INFO);
    this.allocationManager = new AllocationManager();
    this.signalGenerator = new SignalGeneratorService();
    this.ocoOrderService = new OCOOrderService();
    this.glickoEngine = new GlickoEngine();
    
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

      // Initialize allocation manager
      if (this.config.enableLiveTrading) {
        await this.allocationManager.initialize(this.binanceService);
        await this.logger.info('ENGINE', 'Allocation manager initialized');
      }

      // Start price streaming for all active trading pairs
      const tradingSymbols = Array.from(this.state.parameterSets.keys());
      const activePositionSymbols = Array.from(this.state.activePositions.keys());
      
      // Combine and deduplicate symbols
      const allMonitoringSymbols = [...new Set([...tradingSymbols, ...activePositionSymbols])];
      
      if (allMonitoringSymbols.length > 0) {
        await this.binanceService.startPriceStreaming(allMonitoringSymbols);
        await this.logger.info('ENGINE', 'Price streaming started for trading pairs', { 
          symbols: allMonitoringSymbols 
        });
      } else {
        await this.logger.warn('ENGINE', 'No symbols to monitor for price streaming');
      }

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
    // Check for signals every 1 hour (3600000ms) to align with 1h klines interval
    console.log('🔄 Starting monitoring loop - checking every 1 hour');
    this.monitoringInterval = setInterval(async () => {
      try {
        console.log('🔄 [Monitoring] Starting 1-hour signal check cycle...');
        await this.checkForSignals();
        console.log('✅ [Monitoring] 1-hour signal check cycle completed');
        console.log('⏰ [Monitoring] Next check in 1 hour...');
      } catch (error) {
        console.error('❌ [Monitoring] Error in monitoring loop:', error);
        await this.logger.error('MONITORING', 'Error in monitoring loop', { error: (error as Error).message });
        this.emit('monitoringError', error);
        // Don't stop monitoring on errors, just log and continue
      }
    }, 3600000); // 1 hour = 3600000ms

    // Initial check
    console.log('🚀 [Monitoring] Starting initial signal check in 5 seconds...');
    setTimeout(async () => {
      try {
        await this.checkForSignals();
        console.log('⏰ [Monitoring] Next check in 1 hour...');
      } catch (error) {
        console.error('❌ [Monitoring] Error in initial check:', error);
      }
    }, 5000);
  }

  private async checkForSignals(): Promise<void> {
    try {
      let ratings: any[] = [];
      
      // Always calculate real-time Z-scores from live market data (like backtest system)
      await this.logger.info('SIGNALS', 'Calculating real-time Glicko ratings from live market data');
      console.log('📊 Calculating real-time Glicko ratings from live market data (no database dependency)...');
      ratings = await this.calculateRealTimeRatings();

      if (ratings.length === 0) {
        await this.logger.warn('SIGNALS', 'No ratings data available for signal generation');
        console.log('No ratings data available for signal generation');
        return;
      }

      // Convert ratings to RatingInput format for SignalGeneratorService
      const ratingInputs: RatingInput[] = ratings.map(r => ({
        symbol: r.symbol,
        rating: parseFloat(r.rating.toString()),
        timestamp: r.timestamp || new Date()
      }));

      // Use SignalGeneratorService to generate signals
      const result = this.signalGenerator.generateSignals(ratingInputs, this.state.parameterSets);

      console.log(`📊 Cross-coin statistics: mean=${result.statistics.meanRating.toFixed(1)}, σ=${result.statistics.stdDevRating.toFixed(1)} across ${result.statistics.totalCoins} coins`);

      // Store z-scores for reversal detection and emit events
      const tradingSymbolData: any[] = [];
      const monitoringSymbolData: any[] = [];

      for (const [symbol, zScoreData] of result.zScores) {
        const params = this.getParametersForSymbol(symbol);
        const rating = ratingInputs.find(r => r.symbol === params.baseAsset);

        if (rating && zScoreData.movingAverage !== null) {
          const isEnabledForTrading = this.state.parameterSets.has(symbol);

          // Emit z-score data for database storage
          this.emit('zScoreCalculated', {
            symbol,
            timestamp: new Date(),
            zScore: zScoreData.current,
            rating: rating.rating,
            movingAverageZScore: zScoreData.movingAverage,
            zScoreThreshold: params.zScoreThreshold,
            movingAveragesPeriod: params.movingAverages,
            isEnabledForTrading
          });

          // Store for reversal detection
          this.previousZScores.set(symbol, zScoreData.movingAverage);

          // Collect data for logging
          const symbolData = {
            symbol,
            currentZScore: zScoreData.current,
            movingAverageZScore: zScoreData.movingAverage,
            threshold: params.zScoreThreshold,
            ratingValue: rating.rating,
            movingAveragesPeriod: params.movingAverages,
            historyLength: zScoreData.historyLength,
            isTrading: isEnabledForTrading
          };

          if (isEnabledForTrading) {
            tradingSymbolData.push(symbolData);
          } else {
            monitoringSymbolData.push(symbolData);
          }

          await this.logger.info('Z_SCORE', `Z-score calculated for ${symbol}`, {
            currentZScore: zScoreData.current,
            movingAverageZScore: zScoreData.movingAverage,
            threshold: params.zScoreThreshold,
            rating: rating.rating,
            meanRating: result.statistics.meanRating,
            stdDevRating: result.statistics.stdDevRating,
            movingAveragesPeriod: params.movingAverages,
            historyLength: zScoreData.historyLength,
            canTrade: isEnabledForTrading
          });
        }
      }

      // Display organized trading symbols information
      if (tradingSymbolData.length > 0) {
        console.log(`\n🎯 TRADING SYMBOLS:`);
        tradingSymbolData.forEach(data => {
          const currentZDisplay = data.currentZScore > 0 ? `+${data.currentZScore.toFixed(3)}` : data.currentZScore.toFixed(3);
          const maZDisplay = data.movingAverageZScore > 0 ? `+${data.movingAverageZScore.toFixed(3)}` : data.movingAverageZScore.toFixed(3);
          const historyStatus = data.historyLength >= data.movingAveragesPeriod ? `${data.movingAveragesPeriod} periods)` : `${data.historyLength}/${data.movingAveragesPeriod} periods)`;

          console.log(`   [${data.symbol}] Current Z: ${currentZDisplay} | MA Z-score: ${maZDisplay} (${historyStatus} | Threshold: ±${data.threshold} | Rating: ${data.ratingValue.toFixed(0)} | TRADING ENABLED`);
        });
      }

      // Display monitoring symbols in a compact format
      if (monitoringSymbolData.length > 0) {
        console.log(`\n📊 MONITORING SYMBOLS:`);
        const monitoringLines: string[] = [];
        monitoringSymbolData.forEach(data => {
          const maZDisplay = data.movingAverageZScore > 0 ? `+${data.movingAverageZScore.toFixed(3)}` : data.movingAverageZScore.toFixed(3);
          monitoringLines.push(`[${data.symbol}] MA Z: ${maZDisplay}`);
        });

        // Display monitoring symbols in rows of 3
        for (let i = 0; i < monitoringLines.length; i += 3) {
          const row = monitoringLines.slice(i, i + 3).join(' | ');
          console.log(`   ${row}`);
        }
      }

      // Log signals from SignalGeneratorService
      for (const signal of result.signals) {
        console.log(`🚨 [${signal.symbol}] TRADING SIGNAL: ${signal.signal} (MA Z-score: ${signal.zScore.toFixed(3)} >= threshold)`);
      }

      const signals = result.signals;

      // Enhance signals with additional data from ratings
      for (const signal of signals) {
        const params = this.getParametersForSymbol(signal.symbol);
        const matchingRatings = ratings.filter(r => r.symbol === params.baseAsset);
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
          buyOrderId: buyOrder.orderId?.toString() || '',
          ocoOrderId: ocoOrder.orderListId?.toString() || '',
          takeProfitOrderId: ocoOrder.orders?.find((o: any) => o.type === 'LIMIT')?.orderId?.toString(),
          stopLossOrderId: ocoOrder.orders?.find((o: any) => o.type === 'STOP_LOSS_LIMIT')?.orderId?.toString(),
          takeProfitPrice: Number(takeProfitPrice),
          stopLossPrice: Number(stopLossPrice),
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
              
              // Release allocated funds
              this.allocationManager.releaseFunds(symbol);
              
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
            
            // Release allocated funds (in case paper trading was mixed with live)
            this.allocationManager.releaseFunds(symbol);
            
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
      // Calculate P&L from live tracked positions and paper positions (in-memory tracking)
      let dailyPnL = 0;

      // Calculate P&L from active positions (unrealized)
      for (const [symbol, position] of this.state.activePositions) {
        try {
          const currentPrice = await this.binanceService.getCurrentPrice(symbol);
          const unrealizedPnL = (currentPrice - position.entryPrice) * position.quantity;
          dailyPnL += unrealizedPnL;
        } catch (error) {
          await this.logger.warn('PNL', `Failed to update P&L for position ${symbol}`, { error: (error as Error).message });
        }
      }

      // Calculate P&L from paper positions (unrealized)
      for (const [symbol, position] of this.paperPositions) {
        if (position.unrealizedPnL !== undefined) {
          dailyPnL += position.unrealizedPnL;
        }
      }

      this.state.dailyPnL = dailyPnL;
      this.emit('dailyPnLUpdated', dailyPnL);

      await this.logger.info('PNL', 'Daily P&L updated', { 
        dailyPnL, 
        activePositions: this.state.activePositions.size,
        paperPositions: this.paperPositions.size 
      });

    } catch (error) {
      await this.logger.error('PNL', 'Error updating daily P&L', { error: (error as Error).message });
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

  async getActivePositionsStatus(): Promise<any> {
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
   * Calculate real-time Glicko ratings from live market data using pairwise algorithm
   * This matches the canonical implementation in calculateGlickoRatings-fixed.ts
   */
  private async calculateRealTimeRatings(): Promise<any[]> {
    try {
      const ratings: any[] = [];
      const now = new Date();

      // Get all BASE_COINS from environment to monitor (exclude USDT since USDTUSDT is invalid)
      const baseCoins = (process.env.BASE_COINS?.split(',').map(coin => coin.trim()) || [])
        .filter(coin => coin !== 'USDT');

      console.log(`📊 Calculating pairwise Glicko ratings for ${baseCoins.length} coins: ${baseCoins.join(', ')}`);
      await this.logger.info('MONITORING', `Calculating pairwise Glicko ratings for all BASE_COINS`, {
        totalCoins: baseCoins.length,
        coins: baseCoins,
        tradingSymbols: this.config.symbols
      });

      // Determine how many periods to fetch based on max moving average period needed
      let maxMovingAveragesPeriod = 50; // Default minimum
      for (const paramSet of this.state.parameterSets.values()) {
        if (paramSet.movingAverages > maxMovingAveragesPeriod) {
          maxMovingAveragesPeriod = paramSet.movingAverages;
        }
      }

      const totalPeriodsNeeded = Math.max(50, maxMovingAveragesPeriod * 2);
      console.log(`🔍 Fetching ${totalPeriodsNeeded} periods of data for pairwise calculation...`);

      // Calculate pairwise ratings using GlickoEngine
      const pairwiseRatings = await this.calculatePairwiseRatings(baseCoins, totalPeriodsNeeded);

      if (pairwiseRatings.size === 0) {
        console.warn('⚠️ No pairwise ratings calculated');
        return [];
      }

      // Convert to format expected by signal generation
      for (const coin of baseCoins) {
        const ratingData = pairwiseRatings.get(coin);
        if (ratingData) {
          ratings.push({
            symbol: coin,
            timestamp: now,
            rating: ratingData.rating,
            ratingDeviation: ratingData.ratingDeviation,
            volatility: ratingData.volatility
          });

          await this.logger.info('RATINGS', `Pairwise Glicko rating calculated for ${coin}`, {
            rating: ratingData.rating,
            ratingDeviation: ratingData.ratingDeviation,
            volatility: ratingData.volatility
          });
        } else {
          await this.logger.warn('RATINGS', `No pairwise rating calculated for ${coin}`);
        }
      }

      console.log(`✅ Calculated ${ratings.length} pairwise Glicko ratings`);
      return ratings;
    } catch (error) {
      console.error('Error calculating real-time pairwise ratings:', error);
      await this.logger.error('RATINGS', 'Failed to calculate pairwise ratings', { error: (error as Error).message });
      return [];
    }
  }

  /**
   * Calculate pairwise Glicko-2 ratings using GlickoEngine (matches calculateGlickoRatings-fixed.ts)
   * This method processes trading pairs (BTCETH, ETHBNB, etc.) to generate ratings for each coin
   */
  private async calculatePairwiseRatings(baseCoins: string[], periodsToFetch: number): Promise<Map<string, { rating: number; ratingDeviation: number; volatility: number }>> {
    const engine = new GlickoEngine();
    const now = new Date();
    const generator = new TradingPairsGenerator();

    // Initialize all coins in the engine
    for (const coin of baseCoins) {
      engine.ensureCoinExists(coin, now);
    }

    // 1. Find relevant trading pairs using dynamic discovery
    const tradingPairs: Array<{ pair: string; base: string; quote: string }> = [];
    try {
        console.log('🔍 Discovering valid trading pairs via Binance API...');
        const validPairs = await generator.generateTradingPairs(baseCoins);
        const details = await generator.getDetailedPairInfo(validPairs);
        details.forEach(d => {
            tradingPairs.push({ pair: d.symbol, base: d.baseAsset, quote: d.quoteAsset });
        });
    } catch (e) {
        console.warn('⚠️ Dynamic pair discovery failed, falling back to basic construction:', e);
        // Fallback to manual permutation if API fails
        for (const base of baseCoins) {
          for (const quote of baseCoins) {
            if (base !== quote) {
              tradingPairs.push({ pair: `${base}${quote}`, base, quote });
            }
          }
        }
    }

    console.log(`🔍 Processing ${tradingPairs.length} potential trading pairs for pairwise Glicko calculation...`);

    // 2. Fetch klines for all pairs (5-minute intervals)
    const startTime = Date.now() - (periodsToFetch * 5 * 60 * 1000);
    const klinesByPair = new Map<string, any[]>();

    for (const { pair, base, quote } of tradingPairs) {
      try {
        const klines = await this.binanceService.getKlines(
          pair,
          '5m',
          startTime,
          undefined,
          periodsToFetch
        );

        if (klines && klines.length > 0) {
          klinesByPair.set(pair, klines);
          console.log(`  ✓ ${pair}: fetched ${klines.length} klines`);
        }
      } catch (error) {
        // Pair doesn't exist on Binance, skip silently
      }
    }

    if (klinesByPair.size === 0) {
      console.warn('⚠️ No trading pair klines available for pairwise calculation');
      return new Map();
    }

    console.log(`📊 Found ${klinesByPair.size} active trading pairs`);

    // 3. Group all klines by timestamp and process chronologically
    const klinesByTimestamp = new Map<string, Array<{ pair: string; kline: any }>>();

    for (const [pair, klines] of klinesByPair) {
      for (const kline of klines) {
        const timestamp = new Date(kline.openTime).toISOString();
        if (!klinesByTimestamp.has(timestamp)) {
          klinesByTimestamp.set(timestamp, []);
        }
        klinesByTimestamp.get(timestamp)!.push({ pair, kline });
      }
    }

    const timestamps = Array.from(klinesByTimestamp.keys()).sort();
    console.log(`⏱️  Processing ${timestamps.length} time intervals...`);

    // 4. Process each timestamp
    for (const timestamp of timestamps) {
      const timestampData = klinesByTimestamp.get(timestamp)!;

      for (const { pair, kline } of timestampData) {
        // Find base and quote from pair name
        const pairInfo = tradingPairs.find(p => p.pair === pair);
        if (!pairInfo) continue;

        const { base, quote } = pairInfo;
        const priceChange = (kline.close - kline.open) / kline.open;
        const tsDate = new Date(timestamp);

        // Process game with volume metrics if available
        const volumeMetrics = kline.takerBuyBaseAssetVolume ? {
          volume: kline.volume,
          takerBuyVolume: kline.takerBuyBaseAssetVolume
        } : undefined;

        engine.processGame(base, quote, priceChange, tsDate, volumeMetrics);
      }

      // Normalize ratings after each interval to prevent drift
      engine.normalizeRatings();
    }

    // 5. Extract final ratings for all coins
    const finalRatings = new Map<string, { rating: number; ratingDeviation: number; volatility: number }>();

    for (const coin of baseCoins) {
      const state = engine.getCoinState(coin);
      if (state) {
        finalRatings.set(coin, {
          rating: state.rating.rating,
          ratingDeviation: state.rating.ratingDeviation,
          volatility: state.rating.volatility
        });
        console.log(`  ${coin}: rating=${state.rating.rating.toFixed(0)}, RD=${state.rating.ratingDeviation.toFixed(1)}, σ=${state.rating.volatility.toFixed(3)}`);
      }
    }

    return finalRatings;
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
        
        // Reserve funds using allocation manager
        const allocationPercent = params.allocationPercent || 10;
        const reservation = await this.allocationManager.reserveFunds(
          signal.symbol, 
          allocationPercent, 
          this.binanceService
        );
        
        if (!reservation.success) {
          console.log(`❌ Failed to reserve funds for ${signal.symbol}: ${reservation.reason}`);
          await this.logger.warn('ALLOCATION', `Failed to reserve funds for ${signal.symbol}`, { 
            reason: reservation.reason,
            allocationPercent 
          });
          return;
        }
        
        const allocationAmount = reservation.amount;
        
        if (allocationAmount < 10) {
          console.log(`Insufficient allocation for ${signal.symbol}: $${allocationAmount.toFixed(2)}`);
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
        console.log(`   Allocated: $${allocationAmount.toFixed(2)} (${allocationPercent}%)`);
        
        // Update reservation with order ID
        this.allocationManager.updateReservation(signal.symbol, buyOrder.orderId.toString());
        
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
      
      // Cancel all tracked active positions' OCO orders
      for (const [symbol, position] of this.state.activePositions) {
        try {
          if (position.ocoOrderId) {
            await this.binanceService.cancelOrder(symbol, position.ocoOrderId);
            console.log(`Cancelled OCO order for ${symbol}: ${position.ocoOrderId}`);
          }
          
          // Also try to get and cancel any other open orders for this symbol from Binance directly
          const openOrders = await this.binanceService.getOpenOrders(symbol);
          for (const order of openOrders) {
            try {
              await this.binanceService.cancelOrder(symbol, order.orderId.toString());
              console.log(`Cancelled open order for ${symbol}: ${order.orderId}`);
            } catch (error) {
              console.error(`Failed to cancel open order ${order.orderId} for ${symbol}:`, error);
            }
          }
        } catch (error) {
          console.error(`Failed to cancel orders for ${symbol}:`, error);
        }
      }

      // Clear all active positions
      this.state.activePositions.clear();
      
      // Clear paper positions
      this.paperPositions.clear();
      
      // Clear all allocations
      await this.clearAllAllocations();

      this.emit('emergencyStop');
      console.log('Emergency stop completed - all orders cancelled and positions cleared');

    } catch (error) {
      console.error('Error during emergency stop:', error);
      this.emit('emergencyStopError', error);
    }
  }

  /**
   * Get current allocation status for monitoring
   */
  getAllocationStatus(): any {
    return this.allocationManager.getAllocationStatus();
  }

  /**
   * Emergency clear all reservations
   */
  async clearAllAllocations(): Promise<void> {
    console.warn('🚨 Emergency: Clearing all allocation reservations');
    this.allocationManager.clearAllReservations();
    await this.logger.warn('ALLOCATION', 'Emergency: Cleared all allocation reservations');
  }
}

export default TradingEngine;