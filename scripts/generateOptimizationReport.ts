#!/usr/bin/env ts-node

/**
 * Generate Optimization Report from Database
 * 
 * This script analyzes all existing optimization results in the database 
 * and creates a comprehensive 3D visualization report.
 * 
 * Creates a 3D chart with:
 * - X-axis: Stop Loss Percent
 * - Y-axis: Profit Percent  
 * - Z-axis: Z-Score Threshold
 * - Color: Annualized Return (performance)
 * 
 * Usage: 
 *   npm run generateOptimizationReport [baseAsset] [quoteAsset]  # Specific pair
 *   npm run generateOptimizationReport [baseAsset]              # All quote assets for baseAsset
 * Examples: 
 *   npm run generateOptimizationReport ETH USDT    # ETH/USDT specific
 *   npm run generateOptimizationReport ETH         # All ETH pairs (ETH/USDT, ETH/BTC, etc.)
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

config();

interface OptimizationDataPoint {
  zScoreThreshold: number;
  profitPercent: number;
  stopLossPercent: number;
  movingAverages: number;
  annualizedReturn: number;
  sharpeRatio: number;
  alpha: number;
  maxDrawdown: number;
  winRatio: number;
  totalTrades: number;
  consistency?: number;
  quoteAsset?: string; // Added for baseAsset-level analysis
}

interface ReportConfig {
  baseAsset: string;
  quoteAsset?: string; // Optional for baseAsset-only reports
  quotePairs?: string[]; // List of quote assets when analyzing baseAsset only
  totalResults: number;
  dateRange: {
    earliest: Date;
    latest: Date;
  };
}

class OptimizationReportGenerator {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async initialize(): Promise<void> {
    try {
      await this.prisma.$connect();
      console.log('✅ Connected to database');
    } catch (error) {
      console.error('❌ Database connection failed:', error);
      throw error;
    }
  }

  /**
   * Get all optimization data for the specified trading pair or baseAsset
   */
  async getOptimizationData(baseAsset: string, quoteAsset?: string): Promise<{
    data: OptimizationDataPoint[];
    config: ReportConfig;
  }> {
    if (quoteAsset) {
      return this.getOptimizationDataForPair(baseAsset, quoteAsset);
    } else {
      return this.getOptimizationDataForBaseAsset(baseAsset);
    }
  }

  /**
   * Get optimization data for a specific trading pair
   */
  private async getOptimizationDataForPair(baseAsset: string, quoteAsset: string): Promise<{
    data: OptimizationDataPoint[];
    config: ReportConfig;
  }> {
    console.log(`📊 Retrieving optimization data for ${baseAsset}/${quoteAsset}...`);

    // Get all optimization results
    const results = await this.prisma.optimizationResults.findMany({
      where: {
        baseAsset,
        quoteAsset
      },
      orderBy: { annualizedReturn: 'desc' }
    });

    if (results.length === 0) {
      throw new Error(`No optimization results found for ${baseAsset}/${quoteAsset}`);
    }

    console.log(`   ✅ Found ${results.length} optimization results`);

    // Convert to data points
    const data: OptimizationDataPoint[] = results.map(result => ({
      zScoreThreshold: parseFloat(result.zScoreThreshold.toString()),
      profitPercent: parseFloat(result.profitPercent.toString()),
      stopLossPercent: parseFloat(result.stopLossPercent.toString()),
      movingAverages: result.movingAverages,
      annualizedReturn: parseFloat(result.annualizedReturn.toString()),
      sharpeRatio: parseFloat(result.sharpeRatio.toString()),
      alpha: parseFloat((result.alpha || 0).toString()),
      maxDrawdown: parseFloat(result.maxDrawdown.toString()),
      winRatio: parseFloat(result.winRatio.toString()),
      totalTrades: result.totalTrades
    }));

    // Get date range
    const dateRange = await this.prisma.optimizationResults.aggregate({
      where: { baseAsset, quoteAsset },
      _min: { startTime: true },
      _max: { endTime: true }
    });

    const config: ReportConfig = {
      baseAsset,
      quoteAsset,
      totalResults: results.length,
      dateRange: {
        earliest: dateRange._min.startTime || new Date(),
        latest: dateRange._max.endTime || new Date()
      }
    };

    return { data, config };
  }

  /**
   * Get optimization data for all quote assets for a given baseAsset
   */
  private async getOptimizationDataForBaseAsset(baseAsset: string): Promise<{
    data: OptimizationDataPoint[];
    config: ReportConfig;
  }> {
    console.log(`📊 Retrieving optimization data for all ${baseAsset} pairs...`);

    // Get all optimization results for this baseAsset across all quote assets
    const results = await this.prisma.optimizationResults.findMany({
      where: {
        baseAsset
      },
      orderBy: { annualizedReturn: 'desc' }
    });

    if (results.length === 0) {
      throw new Error(`No optimization results found for ${baseAsset} (any quote asset)`);
    }

    // Get unique quote assets
    const quotePairs = Array.from(new Set(results.map(r => r.quoteAsset)));
    
    console.log(`   ✅ Found ${results.length} optimization results across ${quotePairs.length} quote assets: ${quotePairs.join(', ')}`);

    // Convert to data points (add quoteAsset property for baseAsset-level analysis)
    const data: OptimizationDataPoint[] = results.map(result => ({
      zScoreThreshold: parseFloat(result.zScoreThreshold.toString()),
      profitPercent: parseFloat(result.profitPercent.toString()),
      stopLossPercent: parseFloat(result.stopLossPercent.toString()),
      movingAverages: result.movingAverages,
      annualizedReturn: parseFloat(result.annualizedReturn.toString()),
      sharpeRatio: parseFloat(result.sharpeRatio.toString()),
      alpha: parseFloat((result.alpha || 0).toString()),
      maxDrawdown: parseFloat(result.maxDrawdown.toString()),
      winRatio: parseFloat(result.winRatio.toString()),
      totalTrades: result.totalTrades,
      // Add quote asset info for baseAsset analysis
      quoteAsset: result.quoteAsset
    }));

    // Get date range across all quote assets
    const dateRange = await this.prisma.optimizationResults.aggregate({
      where: { baseAsset },
      _min: { startTime: true },
      _max: { endTime: true }
    });

    const config: ReportConfig = {
      baseAsset,
      quotePairs,
      totalResults: results.length,
      dateRange: {
        earliest: dateRange._min.startTime || new Date(),
        latest: dateRange._max.endTime || new Date()
      }
    };

    return { data, config };
  }

  /**
   * Group optimization results by parameter sets and calculate averages
   */
  groupByParameters(data: OptimizationDataPoint[]) {
    const groups = new Map();
    
    for (const result of data) {
      // Create unique key based on all parameters including asset pair
      const key = `${result.zScoreThreshold}_${result.profitPercent}_${result.stopLossPercent}_${result.movingAverages}${result.quoteAsset ? `_${result.quoteAsset}` : ''}`;
      
      if (!groups.has(key)) {
        groups.set(key, {
          parameters: {
            zScoreThreshold: result.zScoreThreshold,
            profitPercent: result.profitPercent,
            stopLossPercent: result.stopLossPercent,
            movingAverages: result.movingAverages,
            quoteAsset: result.quoteAsset
          },
          results: []
        });
      }
      
      groups.get(key).results.push(result);
    }
    
    // Calculate statistics for each parameter group
    const groupStats = [];
    for (const [key, group] of groups.entries()) {
      const results = group.results;
      if (results.length === 0) continue;
      
      const returns = results.map((r: OptimizationDataPoint) => r.annualizedReturn);
      const sharpeRatios = results.map((r: OptimizationDataPoint) => r.sharpeRatio);
      const alphas = results.map((r: OptimizationDataPoint) => r.alpha);
      const maxDrawdowns = results.map((r: OptimizationDataPoint) => r.maxDrawdown);
      const winRatios = results.map((r: OptimizationDataPoint) => r.winRatio);
      const totalTrades = results.map((r: OptimizationDataPoint) => r.totalTrades);
      
      const stats = {
        parameters: group.parameters,
        count: results.length,
        // Averaged metrics
        avgReturn: this.average(returns),
        medianReturn: this.median(returns),
        returnStdDev: this.standardDeviation(returns),
        avgSharpe: this.average(sharpeRatios),
        avgAlpha: this.average(alphas),
        avgMaxDrawdown: this.average(maxDrawdowns),
        avgWinRatio: this.average(winRatios),
        avgTotalTrades: this.average(totalTrades),
        // Best/worst in this parameter group
        bestReturn: Math.max(...returns),
        worstReturn: Math.min(...returns),
        // Consistency metrics
        positiveReturns: returns.filter((r: number) => r > 0).length,
        consistency: (returns.filter((r: number) => r > 0).length / returns.length) * 100,
        // For display purposes
        zScoreThreshold: group.parameters.zScoreThreshold,
        profitPercent: group.parameters.profitPercent,
        stopLossPercent: group.parameters.stopLossPercent,
        movingAverages: group.parameters.movingAverages,
        quoteAsset: group.parameters.quoteAsset
      };
      
      groupStats.push(stats);
    }
    
    return groupStats;
  }

  /**
   * Helper functions for statistics
   */
  private average(numbers: number[]): number {
    return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
  }

  private median(numbers: number[]): number {
    const sorted = [...numbers].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  private standardDeviation(numbers: number[]): number {
    const avg = this.average(numbers);
    const squareDiffs = numbers.map(n => Math.pow(n - avg, 2));
    return Math.sqrt(this.average(squareDiffs));
  }

  /**
   * Calculate comprehensive statistics including parameter averaging
   */
  calculateStatistics(data: OptimizationDataPoint[]) {
    const returns = data.map(d => d.annualizedReturn);
    const sharpeRatios = data.map(d => d.sharpeRatio);
    const alphas = data.map(d => d.alpha);

    // Group by parameters for averaging
    const parameterGroups = this.groupByParameters(data);
    
    // Calculate parameter-averaged statistics
    const avgGroupReturns = parameterGroups.map(g => g.avgReturn);
    const avgGroupSharpe = parameterGroups.map(g => g.avgSharpe);
    const avgGroupAlpha = parameterGroups.map(g => g.avgAlpha);

    // Parameter ranges
    const zScoreRange = {
      min: Math.min(...data.map(d => d.zScoreThreshold)),
      max: Math.max(...data.map(d => d.zScoreThreshold)),
      unique: Array.from(new Set(data.map(d => d.zScoreThreshold))).sort((a, b) => a - b)
    };

    const profitRange = {
      min: Math.min(...data.map(d => d.profitPercent)),
      max: Math.max(...data.map(d => d.profitPercent)),
      unique: Array.from(new Set(data.map(d => d.profitPercent))).sort((a, b) => a - b)
    };

    const stopLossRange = {
      min: Math.min(...data.map(d => d.stopLossPercent)),
      max: Math.max(...data.map(d => d.stopLossPercent)),
      unique: Array.from(new Set(data.map(d => d.stopLossPercent))).sort((a, b) => a - b)
    };

    // Performance statistics (both individual and parameter-averaged)
    const stats = {
      parameters: {
        zScoreRange,
        profitRange,
        stopLossRange
      },
      individual: {
        avgReturn: returns.reduce((sum, r) => sum + r, 0) / returns.length,
        maxReturn: Math.max(...returns),
        minReturn: Math.min(...returns),
        avgSharpe: sharpeRatios.reduce((sum, r) => sum + r, 0) / sharpeRatios.length,
        avgAlpha: alphas.reduce((sum, r) => sum + r, 0) / alphas.length,
        positiveAlpha: alphas.filter(a => a > 0).length / alphas.length * 100
      },
      parameterAveraged: {
        avgReturn: this.average(avgGroupReturns),
        maxReturn: Math.max(...avgGroupReturns),
        minReturn: Math.min(...avgGroupReturns),
        avgSharpe: this.average(avgGroupSharpe),
        avgAlpha: this.average(avgGroupAlpha),
        positiveAlpha: avgGroupAlpha.filter(a => a > 0).length / avgGroupAlpha.length * 100,
        totalParameterSets: parameterGroups.length,
        avgResultsPerParameterSet: this.average(parameterGroups.map(g => g.count))
      },
      bestResult: data[0], // Already sorted by annualized return desc
      bestParameterSet: parameterGroups.sort((a, b) => b.avgReturn - a.avgReturn)[0],
      parameterGroups: parameterGroups.sort((a, b) => b.avgReturn - a.avgReturn)
    };

    return stats;
  }

  /**
   * Generate comprehensive 3D HTML report
   */
  generateHTML(data: OptimizationDataPoint[], config: ReportConfig, stats: any): string {
    // Prepare data for 3D visualization
    const chartData = data.map(point => ({
      x: point.stopLossPercent,  // X-axis: Stop Loss %
      y: point.profitPercent,    // Y-axis: Profit %
      z: point.zScoreThreshold,  // Z-axis: Z-Score
      value: point.annualizedReturn,
      sharpe: point.sharpeRatio,
      alpha: point.alpha,
      trades: point.totalTrades,
      winRatio: point.winRatio,
      quoteAsset: point.quoteAsset // Include quote asset for baseAsset analysis
    }));

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>3D Parameter Optimization Analysis - ${config.quoteAsset ? `${config.baseAsset}/${config.quoteAsset}` : `${config.baseAsset} All Pairs`}</title>
    <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
    <style>
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            margin: 0; 
            padding: 20px; 
            background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
            min-height: 100vh;
        }
        .container { 
            max-width: 1800px; 
            margin: 0 auto; 
            background: white; 
            padding: 40px; 
            border-radius: 15px; 
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }
        h1 { 
            color: #2c3e50; 
            text-align: center; 
            margin-bottom: 40px; 
            font-size: 2.8em;
            background: linear-gradient(45deg, #3498db, #9b59b6);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .summary { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); 
            gap: 25px; 
            margin: 40px 0; 
        }
        .metric { 
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); 
            padding: 25px; 
            border-radius: 12px; 
            text-align: center; 
            border-left: 5px solid #3498db;
            transition: transform 0.3s ease;
        }
        .metric:hover { transform: translateY(-5px); }
        .metric-value { 
            font-size: 32px; 
            font-weight: bold; 
            color: #2c3e50; 
            margin-bottom: 8px;
        }
        .metric-label { 
            color: #7f8c8d; 
            font-size: 14px; 
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .positive { color: #27ae60; }
        .negative { color: #e74c3c; }
        .chart-container { 
            height: 800px; 
            margin: 40px 0; 
            background: #f8f9fa; 
            border-radius: 12px; 
            padding: 20px;
        }
        .info-panel { 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
            color: white;
            padding: 25px; 
            border-radius: 12px; 
            margin: 25px 0; 
        }
        .info-panel h3 { color: white; margin-top: 0; }
        .parameter-ranges {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin: 30px 0;
        }
        .range-card {
            background: #e8f4fd;
            padding: 20px;
            border-radius: 8px;
            border-left: 5px solid #3498db;
        }
        .best-result {
            background: linear-gradient(135deg, #52c41a 0%, #389e0d 100%);
            color: white;
            padding: 30px;
            border-radius: 15px;
            margin: 30px 0;
            text-align: center;
        }
        .controls {
            text-align: center;
            margin: 20px 0;
            padding: 20px;
            background: #f1f3f5;
            border-radius: 8px;
        }
        .controls select, .controls button {
            margin: 0 10px;
            padding: 8px 15px;
            border: none;
            border-radius: 5px;
            background: #3498db;
            color: white;
            font-weight: bold;
            cursor: pointer;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>3D Parameter Optimization Analysis</h1>
        
        <div class="info-panel">
            <h3>Analysis Configuration</h3>
            <p><strong>Asset Analysis:</strong> ${config.quoteAsset ? `${config.baseAsset}/${config.quoteAsset} (Single Pair)` : `${config.baseAsset} (All Quote Assets)`}</p>
            ${config.quotePairs ? `<p><strong>Quote Assets:</strong> ${config.quotePairs.join(', ')} (${config.quotePairs.length} pairs)</p>` : ''}
            <p><strong>Data Points:</strong> ${config.totalResults} optimization results</p>
            <p><strong>Date Range:</strong> ${config.dateRange.earliest.toISOString().split('T')[0]} to ${config.dateRange.latest.toISOString().split('T')[0]}</p>
            <p><strong>3D Axes:</strong> X = Stop Loss %, Y = Profit %, Z = Z-Score Threshold, Color = Annualized Return</p>
        </div>

        <div class="info-panel">
            <h3>📊 Parameter Averaging Summary</h3>
            <p><strong>Individual Results:</strong> ${config.totalResults} optimization runs</p>
            <p><strong>Unique Parameter Sets:</strong> ${stats.parameterAveraged.totalParameterSets} combinations</p>
            <p><strong>Average Results per Parameter Set:</strong> ${stats.parameterAveraged.avgResultsPerParameterSet.toFixed(1)} runs</p>
            <p><em>Statistics below show both individual results and parameter-averaged performance</em></p>
        </div>

        <div class="summary">
            <div class="metric">
                <div class="metric-value ${stats.individual.avgReturn >= 0 ? 'positive' : 'negative'}">${stats.individual.avgReturn.toFixed(2)}%</div>
                <div class="metric-label">Avg Return (Individual)</div>
            </div>
            <div class="metric">
                <div class="metric-value ${stats.parameterAveraged.avgReturn >= 0 ? 'positive' : 'negative'}">${stats.parameterAveraged.avgReturn.toFixed(2)}%</div>
                <div class="metric-label">Avg Return (Parameter Sets)</div>
            </div>
            <div class="metric">
                <div class="metric-value positive">${stats.individual.maxReturn.toFixed(2)}%</div>
                <div class="metric-label">Best Individual</div>
            </div>
            <div class="metric">
                <div class="metric-value positive">${stats.parameterAveraged.maxReturn.toFixed(2)}%</div>
                <div class="metric-label">Best Parameter Set</div>
            </div>
            <div class="metric">
                <div class="metric-value">${stats.individual.avgSharpe.toFixed(2)}</div>
                <div class="metric-label">Avg Sharpe (Individual)</div>
            </div>
            <div class="metric">
                <div class="metric-value">${stats.parameterAveraged.avgSharpe.toFixed(2)}</div>
                <div class="metric-label">Avg Sharpe (Parameter Sets)</div>
            </div>
        </div>

        <div class="best-result">
            <h3>🏆 Best Individual Result</h3>
            <p><strong>Parameters:</strong> Z-Score = ${stats.bestResult.zScoreThreshold}, Profit = ${stats.bestResult.profitPercent}%, Stop Loss = ${stats.bestResult.stopLossPercent}%</p>
            <p><strong>Performance:</strong> ${stats.bestResult.annualizedReturn.toFixed(2)}% Return, ${stats.bestResult.sharpeRatio.toFixed(2)} Sharpe, ${stats.bestResult.alpha.toFixed(2)}% Alpha</p>
            <p><strong>Risk:</strong> ${stats.bestResult.maxDrawdown.toFixed(2)}% Max Drawdown, ${stats.bestResult.winRatio.toFixed(1)}% Win Rate, ${stats.bestResult.totalTrades} Total Trades</p>
        </div>

        <div class="best-result" style="background: linear-gradient(135deg, #1890ff 0%, #096dd9 100%);">
            <h3>⭐ Best Parameter Set (Averaged)</h3>
            <p><strong>Parameters:</strong> Z-Score = ${stats.bestParameterSet.zScoreThreshold}, Profit = ${stats.bestParameterSet.profitPercent}%, Stop Loss = ${stats.bestParameterSet.stopLossPercent}%</p>
            <p><strong>Averaged Performance:</strong> ${stats.bestParameterSet.avgReturn.toFixed(2)}% Return, ${stats.bestParameterSet.avgSharpe.toFixed(2)} Sharpe, ${stats.bestParameterSet.avgAlpha.toFixed(2)}% Alpha</p>
            <p><strong>Consistency:</strong> ${stats.bestParameterSet.consistency.toFixed(1)}% positive returns (${stats.bestParameterSet.count} runs)</p>
        </div>


        <div class="parameter-ranges">
            <div class="range-card">
                <h4>📊 Z-Score Thresholds</h4>
                <p><strong>Range:</strong> ${stats.parameters.zScoreRange.min} - ${stats.parameters.zScoreRange.max}</p>
                <p><strong>Values:</strong> [${stats.parameters.zScoreRange.unique.join(', ')}]</p>
                <p><strong>Count:</strong> ${stats.parameters.zScoreRange.unique.length} unique values</p>
            </div>
            <div class="range-card">
                <h4>💰 Profit Percents</h4>
                <p><strong>Range:</strong> ${stats.parameters.profitRange.min}% - ${stats.parameters.profitRange.max}%</p>
                <p><strong>Values:</strong> [${stats.parameters.profitRange.unique.join('%, ')}%]</p>
                <p><strong>Count:</strong> ${stats.parameters.profitRange.unique.length} unique values</p>
            </div>
            <div class="range-card">
                <h4>🛡️ Stop Loss Percents</h4>
                <p><strong>Range:</strong> ${stats.parameters.stopLossRange.min}% - ${stats.parameters.stopLossRange.max}%</p>
                <p><strong>Values:</strong> [${stats.parameters.stopLossRange.unique.join('%, ')}%]</p>
                <p><strong>Count:</strong> ${stats.parameters.stopLossRange.unique.length} unique values</p>
            </div>
        </div>

        <div class="controls">
            <label for="dataMode">Data Mode:</label>
            <select id="dataMode" onchange="updateVisualization()">
                <option value="individual">Individual Results</option>
                <option value="averaged">Parameter Averaged</option>
            </select>
            
            <label for="metricSelect">Color Metric:</label>
            <select id="metricSelect" onchange="updateVisualization()">
                <option value="annualizedReturn">Annualized Return</option>
                <option value="sharpe">Sharpe Ratio</option>
                <option value="alpha">Alpha</option>
                <option value="winRatio">Win Ratio</option>
            </select>
            
            ${config.quotePairs ? `
            <label for="quoteFilter">Quote Asset Filter:</label>
            <select id="quoteFilter" onchange="updateVisualization()">
                <option value="all">All Quote Assets</option>
                ${config.quotePairs.map(quote => `<option value="${quote}">${quote}</option>`).join('')}
            </select>
            ` : ''}
            
            <button onclick="resetView()">Reset View</button>
            <button onclick="showBestRegion()">Highlight Best Region</button>
            <button onclick="createVisualization()">Refresh Chart</button>
        </div>

        <div class="chart-container">
            <div id="chart3d"></div>
        </div>

        <div class="info-panel">
            <h3>💡 How to Interpret the 3D Chart</h3>
            <ul>
                <li><strong>X-Axis (Stop Loss %):</strong> Risk management - lower values = tighter stops</li>
                <li><strong>Y-Axis (Profit %):</strong> Profit targets - higher values = bigger targets</li>
                <li><strong>Z-Axis (Z-Score):</strong> Entry sensitivity - higher values = more selective entries</li>
                <li><strong>Color Scale:</strong> Performance metric (warmer colors = better performance)</li>
                <li><strong>Interactive:</strong> Rotate, zoom, and hover for details</li>
            </ul>
        </div>
    </div>

    <script>
        // Data for the 3D visualization
        const individualData = ${JSON.stringify(chartData)};
        
        // Parameter-averaged data
        const parameterData = ${JSON.stringify(stats.parameterGroups.map((group: any) => ({
          x: group.stopLossPercent,
          y: group.profitPercent,
          z: group.zScoreThreshold,
          value: group.avgReturn,
          sharpe: group.avgSharpe,
          alpha: group.avgAlpha,
          winRatio: group.avgWinRatio,
          quoteAsset: group.quoteAsset,
          count: group.count,
          consistency: group.consistency,
          bestReturn: group.bestReturn,
          worstReturn: group.worstReturn
        })))};
        
        let currentMetric = 'annualizedReturn';
        let currentDataMode = 'individual';

        function getCurrentData() {
            return currentDataMode === 'individual' ? individualData : parameterData;
        }

        function getFilteredData() {
            const currentData = getCurrentData();
            const quoteFilter = document.getElementById('quoteFilter');
            const selectedQuote = quoteFilter ? quoteFilter.value : 'all';
            
            if (selectedQuote === 'all') {
                return currentData;
            }
            
            return currentData.filter(point => point.quoteAsset === selectedQuote);
        }

        function getMetricValues(metric, filteredData = null) {
            const dataToUse = filteredData || getFilteredData();
            return dataToUse.map(point => {
                switch(metric) {
                    case 'annualizedReturn': return point.value;
                    case 'sharpe': return point.sharpe;
                    case 'alpha': return point.alpha;
                    case 'winRatio': return point.winRatio;
                    default: return point.value;
                }
            });
        }

        function getColorScale(metric) {
            switch(metric) {
                case 'annualizedReturn': return 'Viridis';
                case 'sharpe': return 'Plasma';
                case 'alpha': return 'RdBu';
                case 'winRatio': return 'YlOrRd';
                default: return 'Viridis';
            }
        }

        function getMetricTitle(metric) {
            switch(metric) {
                case 'annualizedReturn': return 'Annualized Return (%)';
                case 'sharpe': return 'Sharpe Ratio';
                case 'alpha': return 'Alpha (%)';
                case 'winRatio': return 'Win Ratio (%)';
                default: return 'Performance';
            }
        }

        function createVisualization() {
            const filteredData = getFilteredData();
            const values = getMetricValues(currentMetric, filteredData);
            
            // Calculate min/max for color scale based on actual data
            const minValue = Math.min(...values);
            const maxValue = Math.max(...values);
            
            console.log(currentMetric + ' range: ' + minValue.toFixed(2) + ' to ' + maxValue.toFixed(2));
            
            const trace = {
                x: filteredData.map(d => d.x),
                y: filteredData.map(d => d.y), 
                z: filteredData.map(d => d.z),
                mode: 'markers',
                marker: {
                    size: 8,
                    color: values,
                    colorscale: getColorScale(currentMetric),
                    cmin: minValue,
                    cmax: maxValue,
                    cauto: false,
                    showscale: true,
                    colorbar: {
                        title: getMetricTitle(currentMetric),
                        titleside: 'right',
                        thickness: 20,
                        len: 0.8,
                        tick0: minValue,
                        dtick: (maxValue - minValue) / 10
                    },
                    line: {
                        color: 'rgba(50,50,50,0.3)',
                        width: 1
                    }
                },
                text: filteredData.map(d => {
                    if (currentDataMode === 'individual') {
                        return \`Stop Loss: \${d.x}%<br>\` +
                               \`Profit: \${d.y}%<br>\` + 
                               \`Z-Score: \${d.z}<br>\` +
                               \`Return: \${d.value.toFixed(2)}%<br>\` +
                               \`Sharpe: \${d.sharpe.toFixed(2)}<br>\` +
                               \`Alpha: \${d.alpha.toFixed(2)}%<br>\` +
                               \`Win Ratio: \${d.winRatio.toFixed(1)}%<br>\` +
                               \`Trades: \${d.trades}\` +
                               (d.quoteAsset ? \`<br>Quote: \${d.quoteAsset}\` : '');
                    } else {
                        return \`⭐ PARAMETER SET AVERAGE<br>\` +
                               \`Stop Loss: \${d.x}%<br>\` +
                               \`Profit: \${d.y}%<br>\` + 
                               \`Z-Score: \${d.z}<br>\` +
                               \`Avg Return: \${d.value.toFixed(2)}%<br>\` +
                               \`Avg Sharpe: \${d.sharpe.toFixed(2)}<br>\` +
                               \`Avg Alpha: \${d.alpha.toFixed(2)}%<br>\` +
                               \`Avg Win Ratio: \${d.winRatio.toFixed(1)}%<br>\` +
                               \`Runs: \${d.count} | Consistency: \${d.consistency.toFixed(1)}%<br>\` +
                               \`Best: \${d.bestReturn.toFixed(1)}% | Worst: \${d.worstReturn.toFixed(1)}%\` +
                               (d.quoteAsset ? \`<br>Quote: \${d.quoteAsset}\` : '');
                    }
                }),
                hovertemplate: '%{text}<extra></extra>',
                type: 'scatter3d'
            };

            const layout = {
                title: {
                    text: \`3D Parameter Optimization (\${currentDataMode === 'individual' ? 'Individual Results' : 'Parameter Averaged'}): \${getMetricTitle(currentMetric)}\`,
                    x: 0.5,
                    font: { size: 24, color: '#2c3e50' }
                },
                scene: {
                    xaxis: { 
                        title: 'Stop Loss Percent (%)',
                        titlefont: { color: '#2c3e50' }
                    },
                    yaxis: { 
                        title: 'Profit Percent (%)',
                        titlefont: { color: '#2c3e50' }
                    },
                    zaxis: { 
                        title: 'Z-Score Threshold',
                        titlefont: { color: '#2c3e50' }
                    },
                    camera: {
                        eye: { x: 1.5, y: 1.5, z: 1.5 }
                    },
                    bgcolor: 'rgba(248,249,250,0.8)'
                },
                paper_bgcolor: 'rgba(0,0,0,0)',
                plot_bgcolor: 'rgba(0,0,0,0)',
                margin: { l: 0, r: 0, b: 0, t: 60 },
                height: 750
            };

            const config = {
                responsive: true,
                displayModeBar: true,
                modeBarButtonsToRemove: ['pan2d', 'select2d', 'lasso2d']
            };

            Plotly.newPlot('chart3d', [trace], layout, config);
        }

        function updateVisualization() {
            currentMetric = document.getElementById('metricSelect').value;
            currentDataMode = document.getElementById('dataMode').value;
            createVisualization();
        }

        function resetView() {
            const update = {
                'scene.camera': {
                    eye: { x: 1.5, y: 1.5, z: 1.5 }
                }
            };
            Plotly.relayout('chart3d', update);
        }

        function showBestRegion() {
            // Find best performing region (top 10%)
            const filteredData = getFilteredData();
            const values = getMetricValues(currentMetric, filteredData);
            const sortedIndices = values.map((val, idx) => ({ val, idx }))
                .sort((a, b) => b.val - a.val)
                .slice(0, Math.ceil(filteredData.length * 0.1))
                .map(item => item.idx);

            // Calculate min/max for color scale based on actual data
            const minValue = Math.min(...values);
            const maxValue = Math.max(...values);
            
            // Create two traces: regular points and highlighted points
            const regularIndices = [];
            const bestIndices = [];
            
            for (let i = 0; i < filteredData.length; i++) {
                if (sortedIndices.includes(i)) {
                    bestIndices.push(i);
                } else {
                    regularIndices.push(i);
                }
            }
            
            const regularTrace = {
                x: regularIndices.map(i => filteredData[i].x),
                y: regularIndices.map(i => filteredData[i].y),
                z: regularIndices.map(i => filteredData[i].z),
                mode: 'markers',
                marker: {
                    size: 6,
                    color: regularIndices.map(i => values[i]),
                    colorscale: getColorScale(currentMetric),
                    cmin: minValue,
                    cmax: maxValue,
                    cauto: false,
                    showscale: true,
                    colorbar: {
                        title: getMetricTitle(currentMetric),
                        titleside: 'right',
                        thickness: 20,
                        len: 0.8,
                        tick0: minValue,
                        dtick: (maxValue - minValue) / 10
                    },
                    opacity: 0.3,
                    line: {
                        color: 'rgba(50,50,50,0.2)',
                        width: 1
                    }
                },
                text: regularIndices.map(i => 
                    'Stop Loss: ' + filteredData[i].x + '%<br>' +
                    'Profit: ' + filteredData[i].y + '%<br>' + 
                    'Z-Score: ' + filteredData[i].z + '<br>' +
                    'Return: ' + filteredData[i].value.toFixed(2) + '%<br>' +
                    'Sharpe: ' + filteredData[i].sharpe.toFixed(2) + '<br>' +
                    'Alpha: ' + filteredData[i].alpha.toFixed(2) + '%<br>' +
                    'Win Ratio: ' + filteredData[i].winRatio.toFixed(1) + '%<br>' +
                    'Trades: ' + filteredData[i].trades +
                    (filteredData[i].quoteAsset ? '<br>Quote: ' + filteredData[i].quoteAsset : '')
                ),
                hovertemplate: '%{text}<extra></extra>',
                type: 'scatter3d',
                name: 'Other Points'
            };
            
            const bestTrace = {
                x: bestIndices.map(i => filteredData[i].x),
                y: bestIndices.map(i => filteredData[i].y),
                z: bestIndices.map(i => filteredData[i].z),
                mode: 'markers',
                marker: {
                    size: 12,
                    color: bestIndices.map(i => values[i]),
                    colorscale: getColorScale(currentMetric),
                    cmin: minValue,
                    cmax: maxValue,
                    cauto: false,
                    showscale: false,
                    opacity: 1.0,
                    line: {
                        color: 'red',
                        width: 3
                    }
                },
                text: bestIndices.map(i => 
                    '🏆 TOP PERFORMER<br>' +
                    'Stop Loss: ' + filteredData[i].x + '%<br>' +
                    'Profit: ' + filteredData[i].y + '%<br>' + 
                    'Z-Score: ' + filteredData[i].z + '<br>' +
                    'Return: ' + filteredData[i].value.toFixed(2) + '%<br>' +
                    'Sharpe: ' + filteredData[i].sharpe.toFixed(2) + '<br>' +
                    'Alpha: ' + filteredData[i].alpha.toFixed(2) + '%<br>' +
                    'Win Ratio: ' + filteredData[i].winRatio.toFixed(1) + '%<br>' +
                    'Trades: ' + filteredData[i].trades +
                    (filteredData[i].quoteAsset ? '<br>Quote: ' + filteredData[i].quoteAsset : '')
                ),
                hovertemplate: '%{text}<extra></extra>',
                type: 'scatter3d',
                name: 'Top 10% Performers'
            };

            const layout = {
                title: {
                    text: 'Top 10% Best Performers: ' + getMetricTitle(currentMetric),
                    x: 0.5,
                    font: { size: 24, color: '#2c3e50' }
                },
                scene: {
                    xaxis: { 
                        title: 'Stop Loss Percent (%)',
                        titlefont: { color: '#2c3e50' }
                    },
                    yaxis: { 
                        title: 'Profit Percent (%)',
                        titlefont: { color: '#2c3e50' }
                    },
                    zaxis: { 
                        title: 'Z-Score Threshold',
                        titlefont: { color: '#2c3e50' }
                    },
                    camera: {
                        eye: { x: 1.5, y: 1.5, z: 1.5 }
                    },
                    bgcolor: 'rgba(248,249,250,0.8)'
                },
                paper_bgcolor: 'rgba(0,0,0,0)',
                plot_bgcolor: 'rgba(0,0,0,0)',
                margin: { l: 0, r: 0, b: 0, t: 60 },
                height: 750,
                showlegend: true
            };

            const config = {
                responsive: true,
                displayModeBar: true,
                modeBarButtonsToRemove: ['pan2d', 'select2d', 'lasso2d']
            };

            Plotly.newPlot('chart3d', [regularTrace, bestTrace], layout, config);
            
            alert('Highlighting top 10% performing parameter combinations (' + sortedIndices.length + ' points)');
        }

        // Initialize visualization
        document.addEventListener('DOMContentLoaded', function() {
            createVisualization();
        });
    </script>
</body>
</html>`;

    return html;
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

/**
 * Parse command line arguments
 */
function parseArguments(): { baseAsset: string; quoteAsset?: string } {
  const args = process.argv.slice(2);

  if (args.length < 1 || args.length > 2) {
    console.error('❌ Invalid arguments. Usage:');
    console.error('npm run generateOptimizationReport baseAsset [quoteAsset]');
    console.error('');
    console.error('Examples:');
    console.error('  npm run generateOptimizationReport ETH USDT    # Specific ETH/USDT pair');
    console.error('  npm run generateOptimizationReport ETH         # All ETH pairs (ETH/USDT, ETH/BTC, etc.)');
    console.error('  npm run generateOptimizationReport BTC USDT    # Specific BTC/USDT pair'); 
    console.error('  npm run generateOptimizationReport BTC         # All BTC pairs');
    process.exit(1);
  }

  const [baseAsset, quoteAsset] = args;

  return {
    baseAsset: baseAsset.toUpperCase(),
    quoteAsset: quoteAsset ? quoteAsset.toUpperCase() : undefined
  };
}

/**
 * Main execution function
 */
async function main() {
  const generator = new OptimizationReportGenerator();

  try {
    console.log('🎯 Starting Database Optimization Report Generation...');
    console.log('=' .repeat(80));

    await generator.initialize();

    const { baseAsset, quoteAsset } = parseArguments();

    // Get data from database
    const { data, config } = await generator.getOptimizationData(baseAsset, quoteAsset);

    // Calculate statistics
    const stats = generator.calculateStatistics(data);

    console.log('📊 Analysis Summary:');
    console.log(`   Individual Results: ${data.length}`);
    console.log(`   Parameter Sets: ${stats.parameterAveraged.totalParameterSets}`);
    console.log(`   Avg Return (Individual): ${stats.individual.avgReturn.toFixed(2)}%`);
    console.log(`   Avg Return (Parameter Sets): ${stats.parameterAveraged.avgReturn.toFixed(2)}%`);
    console.log(`   Best Return: ${stats.individual.maxReturn.toFixed(2)}%`);
    console.log(`   Parameter Ranges: Z=[${stats.parameters.zScoreRange.unique.join(',')}], P=[${stats.parameters.profitRange.unique.join(',')}], S=[${stats.parameters.stopLossRange.unique.join(',')}]`);

    // Generate HTML report
    const html = generator.generateHTML(data, config, stats);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const reportSuffix = quoteAsset ? `${baseAsset}${quoteAsset}` : `${baseAsset}-ALL`;
    const reportPath = path.join('analysis', `optimization-report-${reportSuffix}-${timestamp}-${Date.now()}.html`);
    
    // Ensure analysis directory exists
    if (!fs.existsSync('analysis')) {
      fs.mkdirSync('analysis');
    }
    
    fs.writeFileSync(reportPath, html);

    console.log('\\n🎉 Optimization Report Generated Successfully!');
    console.log('📊 Key Insights:');
    if (quoteAsset) {
      console.log(`  📊 Asset Pair: ${baseAsset}/${quoteAsset} (Single Pair Analysis)`);
    } else {
      console.log(`  📊 Base Asset: ${baseAsset} (All Quote Assets: ${config.quotePairs?.join(', ')})`);
    }
    console.log(`  🏆 Best Strategy: Z=${stats.bestResult.zScoreThreshold}, P=${stats.bestResult.profitPercent}%, S=${stats.bestResult.stopLossPercent}%`);
    console.log(`  📈 Best Return: ${stats.bestResult.annualizedReturn.toFixed(2)}%`);
    console.log(`  ⚖️ Average Sharpe: ${stats.individual.avgSharpe.toFixed(2)}`);
    console.log(`  🎯 Positive Alpha: ${stats.individual.positiveAlpha.toFixed(1)}% of strategies`);
    console.log(`📁 3D Interactive Report: ${reportPath}`);
    console.log('');
    console.log('🔍 Report Features:');
    console.log('  • Interactive 3D visualization with Plotly.js');
    console.log('  • X-axis: Stop Loss %, Y-axis: Profit %, Z-axis: Z-Score');
    console.log('  • Color-coded performance metrics');
    console.log('  • Hover details and parameter analysis');
    console.log('  • Multiple metric views (Return, Sharpe, Alpha, Win Rate)');
    console.log('  • Parameter averaging: Compare individual results vs averaged parameter sets');
    console.log(`  • Shows both individual performance and parameter set consistency`);

  } catch (error) {
    console.error('\\n❌ Optimization report generation failed:', error);
    process.exit(1);
  } finally {
    await generator.cleanup();
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { OptimizationReportGenerator };