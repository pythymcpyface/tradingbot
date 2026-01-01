import { PrismaClient } from '@prisma/client';
import { TradingParameterSet } from '../types';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface ParameterLoadOptions {
  source: 'file' | 'database' | 'manual';
  filePath?: string;
  parameterSets?: TradingParameterSet[];
  databaseQuery?: {
    metric?: 'sharpeRatio' | 'calmarRatio' | 'totalReturn' | 'alpha';
    baseAssets?: string[];
    quoteAssets?: string[];
    minTrades?: number;
    limit?: number;
  };
}

export class ParameterSetManager {
  private prisma: PrismaClient;
  private loadedParameterSets: Map<string, TradingParameterSet> = new Map();

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Load parameter sets from various sources
   */
  async loadParameterSets(options: ParameterLoadOptions): Promise<TradingParameterSet[]> {
    let parameterSets: TradingParameterSet[] = [];

    switch (options.source) {
      case 'file':
        parameterSets = await this.loadFromFile(options.filePath!);
        break;
      case 'database':
        parameterSets = await this.loadFromDatabase(options.databaseQuery || {});
        break;
      case 'manual':
        parameterSets = options.parameterSets || [];
        break;
      default:
        throw new Error(`Unsupported parameter source: ${options.source}`);
    }

    // Store in internal map for quick access
    this.loadedParameterSets.clear();
    for (const params of parameterSets) {
      this.loadedParameterSets.set(params.symbol, params);
    }

    console.log(`Loaded ${parameterSets.length} parameter sets from ${options.source}`);
    return parameterSets;
  }

  /**
   * Load parameters from JSON file
   */
  private async loadFromFile(filePath: string): Promise<TradingParameterSet[]> {
    try {
      const absolutePath = path.resolve(filePath);
      const fileContent = await fs.readFile(absolutePath, 'utf-8');
      const data = JSON.parse(fileContent);

      if (Array.isArray(data)) {
        return data.map(this.validateParameterSet);
      } else if (data.parameterSets && Array.isArray(data.parameterSets)) {
        return data.parameterSets.map(this.validateParameterSet);
      } else if (typeof data === 'object' && data !== null) {
        // Handle Map format: { "SYMBOL": { ...params } }
        const paramSets: TradingParameterSet[] = [];
        
        for (const [symbol, params] of Object.entries(data)) {
          const p = params as any;
          
          // Inject symbol if missing
          if (!p.symbol) p.symbol = symbol;
          
          // Try to derive base/quote if missing
          if ((!p.baseAsset || !p.quoteAsset) && symbol.includes('/')) {
            const [base, quote] = symbol.split('/');
            if (!p.baseAsset) p.baseAsset = base;
            if (!p.quoteAsset) p.quoteAsset = quote;
          } else if ((!p.baseAsset || !p.quoteAsset) && symbol.endsWith('USDT')) {
             if (!p.baseAsset) p.baseAsset = symbol.replace('USDT', '');
             if (!p.quoteAsset) p.quoteAsset = 'USDT';
          }

          paramSets.push(this.validateParameterSet(p));
        }
        
        if (paramSets.length > 0) return paramSets;
      }
      
      throw new Error('Invalid file format. Expected array of parameter sets or object map.');
      
    } catch (error) {
      console.error(`Failed to load parameters from file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Load optimized parameters from database
   */
  private async loadFromDatabase(query: NonNullable<ParameterLoadOptions['databaseQuery']>): Promise<TradingParameterSet[]> {
    try {
      const {
        metric = 'sharpeRatio',
        baseAssets = [],
        quoteAssets = ['USDT'],
        minTrades = 5,
        limit = 50
      } = query;

      // Build where clause
      const whereClause: any = {
        totalTrades: { gte: minTrades }
      };

      if (baseAssets.length > 0) {
        whereClause.baseAsset = { in: baseAssets };
      }

      if (quoteAssets.length > 0) {
        whereClause.quoteAsset = { in: quoteAssets };
      }

      // Build order by clause
      let orderBy: any;
      switch (metric) {
        case 'sharpeRatio':
          orderBy = { sharpeRatio: 'desc' };
          break;
        case 'calmarRatio':
          orderBy = { calmarRatio: 'desc' };
          break;
        case 'totalReturn':
          orderBy = { totalReturn: 'desc' };
          break;
        case 'alpha':
          orderBy = { alpha: 'desc' };
          break;
        default:
          orderBy = { sharpeRatio: 'desc' };
      }

      const results = await this.prisma.optimizationResults.findMany({
        where: whereClause,
        orderBy,
        take: limit,
        select: {
          baseAsset: true,
          quoteAsset: true,
          zScoreThreshold: true,
          movingAverages: true,
          profitPercent: true,
          stopLossPercent: true,
          sharpeRatio: true,
          totalReturn: true,
          calmarRatio: true,
          totalTrades: true
        }
      });

      // Convert to parameter sets
      const parameterSets: TradingParameterSet[] = results.map(result => ({
        symbol: `${result.baseAsset}${result.quoteAsset}`,
        baseAsset: result.baseAsset,
        quoteAsset: result.quoteAsset,
        zScoreThreshold: parseFloat(result.zScoreThreshold.toString()),
        movingAverages: result.movingAverages,
        profitPercent: parseFloat(result.profitPercent.toString()),
        stopLossPercent: parseFloat(result.stopLossPercent.toString()),
        allocationPercent: 10.0, // Default allocation
        enabled: true
      }));

      return parameterSets;
    } catch (error) {
      console.error('Failed to load parameters from database:', error);
      throw error;
    }
  }

  /**
   * Validate and normalize parameter set
   */
  private validateParameterSet(params: any): TradingParameterSet {
    const required = ['symbol', 'baseAsset', 'quoteAsset', 'zScoreThreshold', 'movingAverages', 'profitPercent', 'stopLossPercent'];
    
    for (const field of required) {
      if (params[field] === undefined || params[field] === null) {
        throw new Error(`Missing required parameter: ${field}`);
      }
    }

    return {
      symbol: params.symbol,
      baseAsset: params.baseAsset,
      quoteAsset: params.quoteAsset,
      zScoreThreshold: Number(params.zScoreThreshold),
      movingAverages: Number(params.movingAverages),
      profitPercent: Number(params.profitPercent),
      stopLossPercent: Number(params.stopLossPercent),
      allocationPercent: Number(params.allocationPercent || 10.0),
      enabled: params.enabled !== false
    };
  }

  /**
   * Get parameter set for specific symbol
   */
  getParametersForSymbol(symbol: string): TradingParameterSet | undefined {
    return this.loadedParameterSets.get(symbol);
  }

  /**
   * Get all loaded parameter sets
   */
  getAllParameterSets(): TradingParameterSet[] {
    return Array.from(this.loadedParameterSets.values());
  }

  /**
   * Get symbols with loaded parameters
   */
  getActiveSymbols(): string[] {
    return Array.from(this.loadedParameterSets.keys()).filter(
      symbol => this.loadedParameterSets.get(symbol)?.enabled === true
    );
  }

  /**
   * Update parameter set for symbol
   */
  updateParameterSet(symbol: string, updates: Partial<TradingParameterSet>): void {
    const existing = this.loadedParameterSets.get(symbol);
    if (existing) {
      this.loadedParameterSets.set(symbol, { ...existing, ...updates });
    }
  }

  /**
   * Export parameter sets to JSON file
   */
  async exportToFile(filePath: string, symbols?: string[]): Promise<void> {
    try {
      const parameterSets = symbols 
        ? symbols.map(s => this.loadedParameterSets.get(s)).filter(Boolean)
        : Array.from(this.loadedParameterSets.values());

      const data = {
        exportedAt: new Date().toISOString(),
        parameterSets
      };

      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
      console.log(`Exported ${parameterSets.length} parameter sets to ${filePath}`);
    } catch (error) {
      console.error(`Failed to export parameters to ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Generate parameter sets from top performers query
   */
  async generateFromTopPerformers(options: {
    metric: 'sharpeRatio' | 'calmarRatio' | 'totalReturn' | 'alpha';
    symbols: string[];
    limit?: number;
  }): Promise<TradingParameterSet[]> {
    const baseAssets = options.symbols.map(s => s.replace('USDT', ''));
    
    return await this.loadFromDatabase({
      metric: options.metric,
      baseAssets,
      quoteAssets: ['USDT'],
      minTrades: 5,
      limit: options.limit || 10
    });
  }
}