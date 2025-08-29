import Binance from 'binance-api-node';
import { EventEmitter } from 'events';
import { PrismaClient } from '@prisma/client';
import { ZScoreSignal, TradingPair } from '../../types';

export interface BinanceConfig {
  apiKey: string;
  apiSecret: string;
  testnet?: boolean;
  paperTrading?: boolean;
}

export interface OrderRequest {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'OCO';
  quantity?: string;
  quoteOrderQty?: string;
  price?: string;
  stopPrice?: string;
  stopLimitPrice?: string;
  timeInForce?: 'GTC' | 'IOC' | 'FOK';
}

export class BinanceService extends EventEmitter {
  private client: any;
  private prisma: PrismaClient;
  private isInitialized: boolean = false;
  private activePositions: Map<string, any> = new Map();
  private priceSubscriptions: Map<string, any> = new Map();
  private paperTrading: boolean = false;

  constructor(config: BinanceConfig, prisma: PrismaClient) {
    super();
    this.prisma = prisma;
    this.paperTrading = config.paperTrading || false;
    
    this.client = Binance({
      apiKey: config.apiKey,
      apiSecret: config.apiSecret,
      getTime: () => Date.now(),
      httpBase: config.testnet ? 'https://testnet.binance.vision' : undefined,
      wsBase: config.testnet ? 'wss://testnet.binance.vision' : undefined,
    });
  }

  async initialize(): Promise<void> {
    try {
      // Always test basic API connection first
      await this.client.ping();
      console.log('✅ Binance API connection test successful');
      
      if (!this.paperTrading) {
        // Live trading mode - full validation
        const accountInfo = await this.client.accountInfo();
        console.log('Binance API connected successfully');
        console.log('Account status:', accountInfo.accountType);
        
        // Load existing positions
        await this.loadExistingPositions();
      } else {
        console.log('📝 Paper trading mode - using real market data, no account validation');
      }
      
      this.isInitialized = true;
      this.emit('initialized');
    } catch (error) {
      console.error('Failed to initialize Binance service:', error);
      throw error;
    }
  }

  private async loadExistingPositions(): Promise<void> {
    try {
      const account = await this.client.accountInfo();
      
      for (const balance of account.balances) {
        const free = parseFloat(balance.free);
        const locked = parseFloat(balance.locked);
        
        if (free > 0 || locked > 0) {
          this.activePositions.set(balance.asset, {
            asset: balance.asset,
            free,
            locked,
            total: free + locked
          });
        }
      }
      
      console.log(`Loaded ${this.activePositions.size} active positions`);
    } catch (error) {
      console.error('Error loading existing positions:', error);
    }
  }

  async getTradingPairs(baseAssets: string[]): Promise<TradingPair[]> {
    try {
      const exchangeInfo = await this.client.exchangeInfo();
      const tradingPairs: TradingPair[] = [];
      
      for (const symbol of exchangeInfo.symbols) {
        if (symbol.status === 'TRADING' && 
            baseAssets.includes(symbol.baseAsset) && 
            symbol.quoteAsset === 'USDT') {
          
          tradingPairs.push({
            symbol: symbol.symbol,
            baseAsset: symbol.baseAsset,
            quoteAsset: symbol.quoteAsset,
            isActive: true
          });
        }
      }
      
      return tradingPairs;
    } catch (error) {
      console.error('Error fetching trading pairs:', error);
      throw error;
    }
  }

  async getKlines(
    symbol: string,
    interval: string,
    startTime?: number,
    endTime?: number,
    limit?: number
  ): Promise<any[]> {
    try {
      const options: any = {
        symbol,
        interval,
        limit: limit || 1000
      };
      
      if (startTime) options.startTime = startTime;
      if (endTime) options.endTime = endTime;
      
      const klines = await this.client.candles(options);
      
      // Check if we got valid data
      if (!klines || klines.length === 0) {
        throw new Error(`No klines data received for ${symbol}`);
      }
      
      // Debug: log raw response structure
      console.log(`🔍 Raw klines response for ${symbol}:`, {
        length: klines.length,
        firstKline: klines[0],
        klineType: typeof klines[0],
        isArray: Array.isArray(klines[0])
      });
      
      const processedKlines = klines.map((kline: any) => {
        // Binance returns klines as objects with named properties
        const processed = {
          symbol,
          openTime: new Date(kline.openTime),
          closeTime: new Date(kline.closeTime),
          open: parseFloat(kline.open),
          high: parseFloat(kline.high),
          low: parseFloat(kline.low),
          close: parseFloat(kline.close),
          volume: parseFloat(kline.volume),
          quoteAssetVolume: parseFloat(kline.quoteVolume),
          numberOfTrades: kline.trades,
          takerBuyBaseAssetVolume: parseFloat(kline.baseAssetVolume),
          takerBuyQuoteAssetVolume: parseFloat(kline.quoteAssetVolume),
          ignore: 0
        };
        
        // Debug first processed kline
        if (kline === klines[0]) {
          console.log(`🔍 First processed kline for ${symbol}:`, processed);
        }
        
        return processed;
      });
      
      // Validate the processed data
      const validKlines = processedKlines.filter((k: any) => !isNaN(k.close) && k.close > 0);
      
      console.log(`📊 ${symbol}: ${validKlines.length}/${processedKlines.length} valid klines`);
      
      if (validKlines.length === 0) {
        throw new Error(`All klines data is invalid for ${symbol}`);
      }
      
      return validKlines;
      
    } catch (error) {
      console.error(`Error fetching klines for ${symbol}:`, error);
      throw error;
    }
  }


  async getCurrentPrice(symbol: string): Promise<number> {
    try {
      const ticker = await this.client.prices({ symbol });
      return parseFloat(ticker[symbol]);
    } catch (error) {
      console.error(`Error getting current price for ${symbol}:`, error);
      throw error;
    }
  }

  async getCurrentPrices(symbols?: string[]): Promise<Map<string, number>> {
    try {
      const tickers = symbols 
        ? await this.client.prices({ symbols })
        : await this.client.prices();
      
      const prices = new Map<string, number>();
      
      for (const [symbol, price] of Object.entries(tickers)) {
        prices.set(symbol, parseFloat(price as string));
      }
      
      return prices;
    } catch (error) {
      console.error('Error getting current prices:', error);
      throw error;
    }
  }

  async placeOrder(orderRequest: OrderRequest): Promise<any> {
    try {
      let order;
      
      switch (orderRequest.type) {
        case 'MARKET':
          order = await this.client.order({
            symbol: orderRequest.symbol,
            side: orderRequest.side,
            type: 'MARKET',
            quantity: orderRequest.quantity,
            quoteOrderQty: orderRequest.quoteOrderQty
          });
          break;
          
        case 'LIMIT':
          order = await this.client.order({
            symbol: orderRequest.symbol,
            side: orderRequest.side,
            type: 'LIMIT',
            timeInForce: orderRequest.timeInForce || 'GTC',
            quantity: orderRequest.quantity,
            price: orderRequest.price
          });
          break;
          
        case 'OCO':
          order = await this.client.orderOco({
            symbol: orderRequest.symbol,
            side: orderRequest.side,
            quantity: orderRequest.quantity,
            price: orderRequest.price,
            stopPrice: orderRequest.stopPrice,
            stopLimitPrice: orderRequest.stopLimitPrice,
            stopLimitTimeInForce: 'GTC'
          });
          break;
          
        default:
          throw new Error(`Unsupported order type: ${orderRequest.type}`);
      }
      
      // Save to database
      await this.saveOrderToDatabase(order);
      
      // Update active positions
      await this.updateActivePositions();
      
      this.emit('orderPlaced', order);
      return order;
      
    } catch (error) {
      console.error('Error placing order:', error);
      this.emit('orderError', error);
      throw error;
    }
  }

  async executeZScoreSignal(
    signal: ZScoreSignal,
    allocation: number = 0.1 // 10% of portfolio
  ): Promise<any> {
    try {
      const currentPrice = await this.getCurrentPrice(signal.symbol);
      const account = await this.client.accountInfo();
      
      // Get USDT balance
      const usdtBalance = account.balances.find((b: any) => b.asset === 'USDT');
      const availableUsdt = parseFloat(usdtBalance?.free || '0');
      
      if (signal.signal === 'BUY') {
        // Check if we already have a position
        if (this.activePositions.has(signal.symbol.replace('USDT', ''))) {
          console.log(`Already have position in ${signal.symbol}, skipping buy signal`);
          return null;
        }
        
        const orderValue = availableUsdt * allocation;
        if (orderValue < 10) { // Minimum order value
          console.log(`Insufficient balance for buy order: $${orderValue}`);
          return null;
        }
        
        // Place market buy order
        const order = await this.placeOrder({
          symbol: signal.symbol,
          side: 'BUY',
          type: 'MARKET',
          quoteOrderQty: orderValue.toFixed(2)
        });
        
        console.log(`Buy order placed for ${signal.symbol}:`, order);
        return order;
        
      } else if (signal.signal === 'SELL') {
        const baseAsset = signal.symbol.replace('USDT', '');
        const position = this.activePositions.get(baseAsset);
        
        if (!position || position.free <= 0) {
          console.log(`No position to sell for ${signal.symbol}`);
          return null;
        }
        
        // Place market sell order for entire position
        const order = await this.placeOrder({
          symbol: signal.symbol,
          side: 'SELL',
          type: 'MARKET',
          quantity: position.free.toString()
        });
        
        console.log(`Sell order placed for ${signal.symbol}:`, order);
        return order;
      }
      
      return null;
    } catch (error) {
      console.error('Error executing z-score signal:', error);
      throw error;
    }
  }

  async placeOcoOrder(
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: string,
    price: string,
    stopPrice: string,
    stopLimitPrice: string
  ): Promise<any> {
    try {
      const order = await this.client.orderOco({
        symbol,
        side,
        quantity,
        price,
        stopPrice,
        stopLimitPrice,
        stopLimitTimeInForce: 'GTC'
      });
      
      await this.saveOrderToDatabase(order);
      this.emit('ocoOrderPlaced', order);
      
      return order;
    } catch (error) {
      console.error('Error placing OCO order:', error);
      throw error;
    }
  }

  async cancelOrder(symbol: string, orderId: string): Promise<any> {
    try {
      const result = await this.client.cancelOrder({
        symbol,
        orderId: parseInt(orderId)
      });
      
      // Update database
      await this.prisma.productionOrders.update({
        where: { orderId },
        data: {
          status: 'CANCELED',
          updateTime: new Date()
        }
      });
      
      this.emit('orderCanceled', result);
      return result;
    } catch (error) {
      console.error('Error canceling order:', error);
      throw error;
    }
  }

  async getOrderStatus(symbol: string, orderId: string): Promise<any> {
    try {
      return await this.client.getOrder({
        symbol,
        orderId: parseInt(orderId)
      });
    } catch (error) {
      console.error('Error getting order status:', error);
      throw error;
    }
  }

  async startPriceStreaming(symbols: string[]): Promise<void> {
    try {
      // Clean up existing streams
      for (const [symbol, stream] of this.priceSubscriptions) {
        if (stream && typeof stream.close === 'function') {
          stream.close();
        }
      }
      this.priceSubscriptions.clear();
      
      // Start new price streams
      for (const symbol of symbols) {
        const stream = this.client.ws.ticker(symbol, (ticker: any) => {
          this.emit('priceUpdate', {
            symbol: ticker.symbol,
            price: parseFloat(ticker.curDayClose),
            change: parseFloat(ticker.priceChangePercent),
            volume: parseFloat(ticker.volume),
            timestamp: new Date()
          });
        });
        
        this.priceSubscriptions.set(symbol, stream);
      }
      
      console.log(`Started price streaming for ${symbols.length} symbols`);
    } catch (error) {
      console.error('Error starting price streaming:', error);
      throw error;
    }
  }

  async stopPriceStreaming(): Promise<void> {
    for (const [symbol, stream] of this.priceSubscriptions) {
      if (stream && typeof stream.close === 'function') {
        stream.close();
      }
    }
    this.priceSubscriptions.clear();
    console.log('Stopped price streaming');
  }

  private async saveOrderToDatabase(order: any): Promise<void> {
    try {
      // Handle both regular orders and OCO orders
      if (order.orderListId) {
        // OCO order - save each order in the list
        for (const orderReport of order.orderReports) {
          await this.prisma.productionOrders.create({
            data: {
              orderId: orderReport.orderId.toString(),
              symbol: orderReport.symbol,
              side: orderReport.side,
              type: orderReport.type,
              quantity: parseFloat(orderReport.origQty),
              price: parseFloat(orderReport.price || '0'),
              stopPrice: parseFloat(orderReport.stopPrice || '0') || null,
              timeInForce: orderReport.timeInForce,
              status: orderReport.status,
              executedQty: parseFloat(orderReport.executedQty),
              cummulativeQuoteQty: parseFloat(orderReport.cummulativeQuoteQty),
              time: new Date(order.transactionTime),
              updateTime: new Date(order.transactionTime),
              isWorking: orderReport.status === 'NEW',
              origQuoteOrderQty: parseFloat(orderReport.origQuoteOrderQty || '0')
            }
          });
        }
      } else {
        // Regular order
        await this.prisma.productionOrders.create({
          data: {
            orderId: order.orderId.toString(),
            symbol: order.symbol,
            side: order.side,
            type: order.type,
            quantity: parseFloat(order.origQty),
            price: parseFloat(order.price || '0'),
            stopPrice: parseFloat(order.stopPrice || '0') || null,
            timeInForce: order.timeInForce || 'GTC',
            status: order.status,
            executedQty: parseFloat(order.executedQty),
            cummulativeQuoteQty: parseFloat(order.cummulativeQuoteQty),
            time: new Date(order.transactTime),
            updateTime: new Date(order.transactTime),
            isWorking: order.status === 'NEW',
            origQuoteOrderQty: parseFloat(order.origQuoteOrderQty || '0')
          }
        });
      }
    } catch (error) {
      console.error('Error saving order to database:', error);
    }
  }

  private async updateActivePositions(): Promise<void> {
    try {
      await this.loadExistingPositions();
      this.emit('positionsUpdated', this.activePositions);
    } catch (error) {
      console.error('Error updating active positions:', error);
    }
  }

  async getAccountInfo(): Promise<any> {
    try {
      if (this.paperTrading) {
        // Return mock account info for paper trading
        return {
          balances: [
            { asset: 'USDT', free: '10000.00', locked: '0.00' },
            { asset: 'BTC', free: '0.00', locked: '0.00' },
            { asset: 'ETH', free: '0.00', locked: '0.00' },
            { asset: 'BNB', free: '0.00', locked: '0.00' }
          ]
        };
      }
      
      return await this.client.accountInfo();
    } catch (error) {
      console.error('Error getting account info:', error);
      throw error;
    }
  }

  getActivePositions(): Map<string, any> {
    return this.activePositions;
  }

  isReady(): boolean {
    return this.isInitialized;
  }

  async disconnect(): Promise<void> {
    await this.stopPriceStreaming();
    this.removeAllListeners();
  }
}

export default BinanceService;