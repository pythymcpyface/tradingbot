#!/usr/bin/env ts-node

/**
 * Concurrent Windowed Backtests For Pair
 * 
 * Runs parameter optimization using concurrent Promise execution instead of worker threads
 * for simpler deployment while still achieving significant performance improvements.
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

config();

interface ParameterCombination {
  zScoreThreshold: number;
  profitPercent: number;
  stopLossPercent: number;
}

interface BacktestResult {
  parameters: ParameterCombination;
  performance: {
    totalReturn: number;
    annualizedReturn: number;
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
    totalTrades: number;
  } | null;
  success: boolean;
  error?: string;
}

interface WindowChartData {
  windowStart: Date;
  windowEnd: Date;
  equityCurve: Array<{ timestamp: Date; value: number }>;
  marketPrices: Array<{ timestamp: Date; price: number }>;
  trades: Array<{ 
    timestamp: Date; 
    type: 'BUY' | 'SELL' | 'TRADE'; 
    price: number; 
    quantity: number;
    signal?: string;
    profitLoss?: number;
  }>;
  metrics: {
    totalReturn: number;
    sharpeRatio: number;
    maxDrawdown: number;
    totalTrades: number;
  };
}

class ConcurrentBacktestRunner {
  private prisma: PrismaClient;
  private baseAsset: string;
  private quoteAsset: string;
  private windowSize: number;
  private startDate?: string;
  private movingAverage: number;
  private maxConcurrency: number;
  
  private zScoreThresholds: number[];
  private profitPercents: number[];
  private stopLossPercents: number[];
  
  private results: BacktestResult[] = [];
  private logFile: string;

  constructor(
    baseAsset: string,
    quoteAsset: string,
    windowSize: number,
    startDate?: string,
    maxConcurrency: number = 4,
    customParams?: {
      zScoreThresholds?: number[];
      profitPercents?: number[];
      stopLossPercents?: number[];
      movingAverage?: number;
    }
  ) {
    this.prisma = new PrismaClient();
    this.baseAsset = baseAsset;
    this.quoteAsset = quoteAsset;
    this.windowSize = windowSize;
    this.startDate = startDate;
    this.maxConcurrency = maxConcurrency;
    
    // Load parameters from command line or .env
    this.zScoreThresholds = customParams?.zScoreThresholds || 
      this.parseEnvArray('ZSCORE_THRESHOLDS', [1.5, 2.0, 2.5, 3.0, 3.5, 4.0]);
    this.profitPercents = customParams?.profitPercents || 
      this.parseEnvArray('PROFIT_PERCENTS', [3.0, 4.0, 5.0, 6.0, 7.0, 8.0]);
    this.stopLossPercents = customParams?.stopLossPercents || 
      this.parseEnvArray('STOP_LOSS_PERCENTS', [1.5, 2.0, 2.5, 3.0, 3.5, 4.0]);
    this.movingAverage = customParams?.movingAverage || 
      parseInt(process.env.DEFAULT_MOVING_AVERAGE || '10');
    
    // Create log file
    this.logFile = path.join('analysis', `concurrent-backtest-${Date.now()}.log`);
  }

  private parseEnvArray(envKey: string, fallback: number[]): number[] {
    const envValue = process.env[envKey];
    if (!envValue) return fallback;
    
    try {
      return envValue.split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
    } catch (error) {
      console.warn(`⚠️ Failed to parse ${envKey} from environment, using fallback`);
      return fallback;
    }
  }

  private writeLog(message: string): void {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(this.logFile, logEntry);
  }

  private generateParameterCombinations(): ParameterCombination[] {
    const combinations: ParameterCombination[] = [];
    
    for (const zScore of this.zScoreThresholds) {
      for (const profit of this.profitPercents) {
        for (const stopLoss of this.stopLossPercents) {
          combinations.push({
            zScoreThreshold: zScore,
            profitPercent: profit,
            stopLossPercent: stopLoss
          });
        }
      }
    }
    
    return combinations;
  }

  private async runSingleBacktest(params: ParameterCombination): Promise<BacktestResult> {
    return new Promise((resolve) => {
      // runWindowedBacktest.ts expects: startTime, windowSize, baseAsset, quoteAsset, zScoreThreshold, movingAverages, profitPercent, stopLossPercent
      const startDate = this.startDate || '2022-01-01'; // Use provided date or default
      
      const args = [
        'scripts/runWindowedBacktest.ts',
        startDate,                              // startTime
        this.windowSize.toString(),             // windowSize
        this.baseAsset,                         // baseAsset
        this.quoteAsset,                        // quoteAsset
        params.zScoreThreshold.toString(),      // zScoreThreshold
        this.movingAverage.toString(),          // movingAverages
        params.profitPercent.toString(),        // profitPercent
        params.stopLossPercent.toString(),      // stopLossPercent
        '--no-html'                             // Skip HTML generation for speed
      ];

      const child = spawn('npx', ['ts-node', ...args], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          try {
            // Parse performance metrics from stdout
            const performance = this.parsePerformanceFromOutput(stdout);
            resolve({
              parameters: params,
              performance,
              success: true
            });
          } catch (error) {
            resolve({
              parameters: params,
              performance: null,
              success: false,
              error: `Failed to parse output: ${error}`
            });
          }
        } else {
          resolve({
            parameters: params,
            performance: null,
            success: false,
            error: stderr || `Exit code: ${code}`
          });
        }
      });

      child.on('error', (error) => {
        resolve({
          parameters: params,
          performance: null,
          success: false,
          error: error.message
        });
      });
    });
  }

  private parsePerformanceFromOutput(output: string): BacktestResult['performance'] {
    // Simple regex parsing - adjust based on actual output format
    const returnMatch = output.match(/Total Return:\s*([\d.-]+)%/);
    const sharpeMatch = output.match(/Sharpe Ratio:\s*([\d.-]+)/);
    const drawdownMatch = output.match(/Max Drawdown:\s*([\d.-]+)%/);
    const winRateMatch = output.match(/Win Rate:\s*([\d.-]+)%/);
    const tradesMatch = output.match(/Total Trades:\s*(\d+)/);
    
    if (!returnMatch) return null;
    
    const totalReturn = parseFloat(returnMatch[1]);
    const annualizedReturn = totalReturn; // Simplification - calculate properly if needed
    
    return {
      totalReturn,
      annualizedReturn,
      sharpeRatio: sharpeMatch ? parseFloat(sharpeMatch[1]) : 0,
      maxDrawdown: drawdownMatch ? parseFloat(drawdownMatch[1]) : 0,
      winRate: winRateMatch ? parseFloat(winRateMatch[1]) : 0,
      totalTrades: tradesMatch ? parseInt(tradesMatch[1]) : 0
    };
  }

  private async runBatch(combinations: ParameterCombination[], batchIndex: number): Promise<BacktestResult[]> {
    console.log(`🚀 Starting batch ${batchIndex + 1} with ${combinations.length} combinations...`);
    
    const promises = combinations.map(async (params) => {
      const startTime = Date.now();
      const result = await this.runSingleBacktest(params);
      const duration = Date.now() - startTime;
      
      const status = result.success ? '✅' : '❌';
      console.log(`${status} Z=${params.zScoreThreshold}, P=${params.profitPercent}%, S=${params.stopLossPercent}% (${Math.round(duration/1000)}s)`);
      
      this.writeLog(`${status} Z=${params.zScoreThreshold}, P=${params.profitPercent}%, S=${params.stopLossPercent}% - Duration: ${duration}ms`);
      
      return result;
    });

    return Promise.all(promises);
  }

  async runOptimization(): Promise<BacktestResult[]> {
    const combinations = this.generateParameterCombinations();
    console.log(`🎯 Running ${combinations.length} parameter combinations with ${this.maxConcurrency} concurrent processes`);
    
    // Ensure analysis directory exists
    if (!fs.existsSync('analysis')) {
      fs.mkdirSync('analysis');
    }
    
    this.writeLog(`Concurrent optimization started: ${new Date().toISOString()}`);
    this.writeLog(`Total combinations: ${combinations.length}`);
    this.writeLog(`Max concurrency: ${this.maxConcurrency}`);
    this.writeLog(`Parameters: Z=[${this.zScoreThresholds.join(',')}], P=[${this.profitPercents.join(',')}]%, S=[${this.stopLossPercents.join(',')}]%`);
    
    // Split into batches
    const batches: ParameterCombination[][] = [];
    for (let i = 0; i < combinations.length; i += this.maxConcurrency) {
      batches.push(combinations.slice(i, i + this.maxConcurrency));
    }
    
    // Run batches sequentially, but combinations within each batch concurrently
    for (let i = 0; i < batches.length; i++) {
      const batchResults = await this.runBatch(batches[i], i);
      this.results.push(...batchResults);
      
      // Progress update
      const completed = this.results.length;
      const successful = this.results.filter(r => r.success).length;
      console.log(`📊 Progress: ${completed}/${combinations.length} (${Math.round(completed/combinations.length*100)}%) - ${successful} successful`);
    }
    
    return this.results;
  }

  async generateReport(includeCharts: boolean = false, includeWindowCharts: boolean = false): Promise<void> {
    const successful = this.results.filter(r => r.success && r.performance);
    console.log(`\n📊 Optimization Complete - ${successful.length}/${this.results.length} successful backtests`);
    
    if (successful.length === 0) {
      console.log('❌ No successful backtests to analyze');
      return;
    }
    
    // Sort by annualized return
    successful.sort((a, b) => (b.performance!.annualizedReturn) - (a.performance!.annualizedReturn));
    
    console.log('\n🏆 Top 5 Parameter Combinations:');
    successful.slice(0, 5).forEach((result, i) => {
      const p = result.parameters;
      const perf = result.performance!;
      console.log(`${i + 1}. Z=${p.zScoreThreshold}, P=${p.profitPercent}%, S=${p.stopLossPercent}% → Return: ${perf.annualizedReturn.toFixed(2)}%, Sharpe: ${perf.sharpeRatio.toFixed(3)}`);
    });
    
    // Save detailed results
    const timestamp = Date.now();
    const reportPath = path.join('analysis', `concurrent-optimization-${this.baseAsset}-${this.quoteAsset}-${timestamp}.json`);
    fs.writeFileSync(reportPath, JSON.stringify({
      summary: {
        totalCombinations: this.results.length,
        successful: successful.length,
        failed: this.results.length - successful.length,
        asset: `${this.baseAsset}/${this.quoteAsset}`,
        windowSize: this.windowSize,
        movingAverage: this.movingAverage
      },
      topPerformers: successful.slice(0, 10),
      allResults: this.results
    }, null, 2));
    
    console.log(`📁 Detailed report saved to: ${reportPath}`);
    
    // Generate 3D visualization chart if requested
    if (includeCharts && successful.length >= 5) {
      console.log('📊 Generating 3D optimization charts...');
      const chartPath = await this.generate3DChart(successful, timestamp);
      console.log(`📈 Interactive 3D chart saved to: ${chartPath}`);
    } else if (includeCharts) {
      console.log('⚠️ Insufficient data for 3D charts (minimum 5 successful results required)');
    }

    // Generate individual windowed backtest charts if requested
    if (includeWindowCharts && successful.length > 0) {
      console.log('📊 Generating individual windowed backtest charts...');
      const bestResult = successful[0]; // Use the best performing parameters
      const windowCharts = await this.generateWindowedBacktestCharts(bestResult.parameters);
      
      if (windowCharts.length > 0) {
        const windowChartPath = await this.generateWindowChartsHTML(windowCharts, bestResult.parameters, timestamp);
        console.log(`📈 Windowed charts saved to: ${windowChartPath}`);
        console.log(`🎯 Generated ${windowCharts.length} individual window charts`);
      } else {
        console.log('⚠️ No windowed backtest data found for chart generation');
      }
    }
  }

  private async generateWindowedBacktestCharts(params: ParameterCombination): Promise<WindowChartData[]> {
    try {
      // Query database for all windowed backtest results for this parameter combination
      const windowResults = await this.prisma.optimizationResults.findMany({
        where: {
          baseAsset: this.baseAsset,
          quoteAsset: this.quoteAsset,
          zScoreThreshold: params.zScoreThreshold,
          profitPercent: params.profitPercent,
          stopLossPercent: params.stopLossPercent
        },
        orderBy: { startTime: 'asc' },
        take: 20 // Limit to latest 20 windows for performance
      });

      // Get trades and price data for each window
      const windowCharts: WindowChartData[] = [];
      for (const result of windowResults) {
        // Get trades for this specific window
        const trades = await this.prisma.backtestOrders.findMany({
          where: {
            symbol: `${this.baseAsset}${this.quoteAsset}`,
            timestamp: {
              gte: result.startTime,
              lte: result.endTime
            }
          },
          orderBy: { timestamp: 'asc' }
        });

        // Get price data for this window
        const priceData = await this.prisma.klines.findMany({
          where: {
            symbol: `${this.baseAsset}${this.quoteAsset}`,
            openTime: {
              gte: result.startTime,
              lte: result.endTime
            }
          },
          orderBy: { openTime: 'asc' },
          select: {
            openTime: true,
            close: true
          }
        });

        // Calculate equity curve from trades
        const INITIAL_CAPITAL = 10000; // Starting capital
        let runningEquity = INITIAL_CAPITAL;
        const equityCurve: Array<{ timestamp: Date; value: number }> = [];
        
        // Initialize equity curve with starting value
        equityCurve.push({
          timestamp: result.startTime,
          value: INITIAL_CAPITAL
        });

        // Build equity curve from completed trades
        const validTrades = trades
          .filter(trade => trade.profitLoss !== null)
          .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        for (const trade of validTrades) {
          // Add realized P&L
          runningEquity += parseFloat(trade.profitLoss!.toString());
          
          equityCurve.push({
            timestamp: trade.timestamp,
            value: runningEquity
          });
        }

        // Add final point at end time if needed
        if (equityCurve.length > 1 && equityCurve[equityCurve.length - 1].timestamp < result.endTime) {
          equityCurve.push({
            timestamp: result.endTime,
            value: runningEquity
          });
        }

        windowCharts.push({
          windowStart: result.startTime,
          windowEnd: result.endTime,
          equityCurve,
          marketPrices: priceData.map(p => ({
            timestamp: p.openTime,
            price: parseFloat(p.close.toString())
          })),
          trades: validTrades.map((t: any) => ({
            timestamp: t.timestamp,
            type: 'TRADE' as 'BUY' | 'SELL' | 'TRADE',
            price: parseFloat(t.price.toString()),
            quantity: parseFloat(t.quantity.toString()),
            signal: t.reason || undefined,
            profitLoss: t.profitLoss ? parseFloat(t.profitLoss.toString()) : 0
          })),
          metrics: {
            totalReturn: parseFloat(result.annualizedReturn.toString()),
            sharpeRatio: parseFloat(result.sharpeRatio.toString()),
            maxDrawdown: parseFloat(result.maxDrawdown.toString()),
            totalTrades: trades.length
          }
        });
      }

      return windowCharts;
    } catch (error) {
      console.error('❌ Error generating windowed backtest charts:', error);
      return [];
    }
  }

  private async generateWindowChartsHTML(
    windowCharts: WindowChartData[], 
    params: ParameterCombination, 
    timestamp: number
  ): Promise<string> {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Windowed Backtest Charts - ${this.baseAsset}/${this.quoteAsset}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@2.0.1/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
    <style>
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            margin: 0; 
            padding: 20px; 
            background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
            min-height: 100vh;
        }
        .container { 
            max-width: 1400px; 
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
            font-size: 2.2em;
            background: linear-gradient(45deg, #3498db, #9b59b6);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .params-info {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 30px;
            text-align: center;
        }
        .window-container {
            margin: 40px 0;
            border: 1px solid #ddd;
            border-radius: 10px;
            overflow: hidden;
            background: #fafafa;
        }
        .window-header {
            background: linear-gradient(135deg, #34495e 0%, #2c3e50 100%);
            color: white;
            padding: 15px 25px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .window-header h3 {
            margin: 0;
            font-size: 1.1em;
        }
        .window-metrics {
            display: flex;
            gap: 20px;
            font-size: 0.9em;
        }
        .chart-container { 
            height: 400px; 
            padding: 20px;
            background: white;
        }
        .positive { color: #27ae60; font-weight: bold; }
        .negative { color: #e74c3c; font-weight: bold; }
        .neutral { color: #34495e; }
    </style>
</head>
<body>
    <div class="container">
        <h1>📊 Individual Windowed Backtest Charts</h1>
        
        <div class="params-info">
            <h3>Parameters: Z-Score=${params.zScoreThreshold} | Profit=${params.profitPercent}% | Stop=${params.stopLossPercent}%</h3>
            <p>Asset Pair: ${this.baseAsset}/${this.quoteAsset} | Window Size: ${this.windowSize} months</p>
        </div>

        ${windowCharts.map((window, index) => {
          const startDate = window.windowStart.toLocaleDateString();
          const endDate = window.windowEnd.toLocaleDateString();
          const returnClass = window.metrics.totalReturn >= 0 ? 'positive' : 'negative';
          
          return `
        <div class="window-container">
            <div class="window-header">
                <h3>Window ${index + 1}: ${startDate} - ${endDate}</h3>
                <div class="window-metrics">
                    <span>Return: <span class="${returnClass}">${window.metrics.totalReturn.toFixed(2)}%</span></span>
                    <span>Sharpe: <span class="neutral">${window.metrics.sharpeRatio.toFixed(3)}</span></span>
                    <span>Max DD: <span class="negative">${window.metrics.maxDrawdown.toFixed(2)}%</span></span>
                    <span>Trades: <span class="neutral">${window.metrics.totalTrades}</span></span>
                </div>
            </div>
            <div class="chart-container">
                <canvas id="chart-${index}"></canvas>
            </div>
        </div>`;
        }).join('')}
    </div>

    <script>
        const windowData = ${JSON.stringify(windowCharts.map(window => ({
          ...window,
          windowStart: window.windowStart.getTime(),
          windowEnd: window.windowEnd.getTime(),
          equityCurve: window.equityCurve.map(p => ({ x: p.timestamp.getTime(), y: p.value })),
          marketPrices: window.marketPrices.map(p => ({ x: p.timestamp.getTime(), y: p.price })),
          trades: window.trades.map(t => ({ 
            x: t.timestamp.getTime(), 
            y: t.price, 
            profit: t.profitLoss || 0,
            signal: t.signal
          }))
        })))};

        // Generate charts for each window
        windowData.forEach((window, index) => {
            const ctx = document.getElementById('chart-' + index).getContext('2d');
            
            // Normalize market prices for display (scale to equity curve range)
            const equityRange = Math.max(...window.equityCurve.map(p => p.y)) - Math.min(...window.equityCurve.map(p => p.y));
            const priceRange = Math.max(...window.marketPrices.map(p => p.y)) - Math.min(...window.marketPrices.map(p => p.y));
            const minPrice = Math.min(...window.marketPrices.map(p => p.y));
            const minEquity = Math.min(...window.equityCurve.map(p => p.y));
            
            const scaleFactor = equityRange / priceRange;
            const normalizedPrices = window.marketPrices.map(p => ({
                x: p.x,
                y: minEquity + (p.y - minPrice) * scaleFactor
            }));

            new Chart(ctx, {
                type: 'line',
                data: {
                    datasets: [
                        {
                            label: 'Portfolio Equity (USDT)',
                            data: window.equityCurve,
                            borderColor: '#3498db',
                            backgroundColor: 'rgba(52, 152, 219, 0.1)',
                            fill: false,
                            tension: 0.1,
                            borderWidth: 2,
                            yAxisID: 'y'
                        },
                        {
                            label: 'Asset Price (Normalized)',
                            data: normalizedPrices,
                            borderColor: '#95a5a6',
                            backgroundColor: 'rgba(149, 165, 166, 0.05)',
                            fill: false,
                            tension: 0.1,
                            borderWidth: 1,
                            yAxisID: 'y'
                        },
                        {
                            label: 'Profitable Trades',
                            data: window.trades.filter(t => t.profit > 0),
                            type: 'scatter',
                            backgroundColor: '#27ae60',
                            borderColor: '#27ae60',
                            pointRadius: 6,
                            pointHoverRadius: 8,
                            showLine: false,
                            yAxisID: 'y'
                        },
                        {
                            label: 'Loss Trades',
                            data: window.trades.filter(t => t.profit <= 0),
                            type: 'scatter',
                            backgroundColor: '#e74c3c',
                            borderColor: '#e74c3c',
                            pointRadius: 6,
                            pointHoverRadius: 8,
                            showLine: false,
                            yAxisID: 'y'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        intersect: false,
                        mode: 'index'
                    },
                    scales: {
                        x: {
                            type: 'time',
                            time: {
                                displayFormats: {
                                    day: 'MMM dd',
                                    month: 'MMM yyyy'
                                }
                            },
                            title: {
                                display: true,
                                text: 'Date'
                            }
                        },
                        y: {
                            type: 'linear',
                            display: true,
                            position: 'left',
                            title: {
                                display: true,
                                text: 'Portfolio Value (USDT)'
                            }
                        }
                    },
                    plugins: {
                        tooltip: {
                            filter: function(tooltipItem) {
                                return tooltipItem.datasetIndex !== 1; // Hide asset price tooltips
                            },
                            callbacks: {
                                label: function(context) {
                                    const dataset = context.dataset;
                                    if (dataset.label.includes('Trades')) {
                                        const trade = window.trades[context.dataIndex];
                                        return \`\${dataset.label}: \${trade.profit.toFixed(2)} USDT (\${trade.signal || 'Trade'})\`;
                                    }
                                    return \`\${dataset.label}: \${context.parsed.y.toFixed(2)}\`;
                                }
                            }
                        },
                        legend: {
                            display: true,
                            position: 'top'
                        }
                    }
                }
            });
        });

        console.log('📊 Generated', windowData.length, 'windowed backtest charts');
    </script>
</body>
</html>`;

    const chartPath = path.join('analysis', `windowed-charts-${this.baseAsset}-${this.quoteAsset}-${timestamp}.html`);
    fs.writeFileSync(chartPath, html);
    
    return chartPath;
  }

  private async generate3DChart(results: BacktestResult[], timestamp: number): Promise<string> {
    // Sort results by different metrics
    const byReturn = [...results].sort((a, b) => b.performance!.annualizedReturn - a.performance!.annualizedReturn);
    const bySharpe = [...results].sort((a, b) => b.performance!.sharpeRatio - a.performance!.sharpeRatio);
    
    // Calculate overall statistics
    const avgReturn = results.reduce((sum, r) => sum + r.performance!.annualizedReturn, 0) / results.length;
    const avgSharpe = results.reduce((sum, r) => sum + r.performance!.sharpeRatio, 0) / results.length;
    const maxReturn = Math.max(...results.map(r => r.performance!.annualizedReturn));
    const minReturn = Math.min(...results.map(r => r.performance!.annualizedReturn));

    // Prepare 3D data for Chart.js
    const chartData = results.map(r => ({
      x: r.parameters.profitPercent,
      y: r.parameters.stopLossPercent,
      z: r.parameters.zScoreThreshold,
      value: r.performance!.annualizedReturn,
      size: Math.max(5, r.performance!.sharpeRatio * 3),
      trades: r.performance!.totalTrades
    }));

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Concurrent 3D Parameter Optimization - ${this.baseAsset}/${this.quoteAsset}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
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
            max-width: 1600px; 
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
            font-size: 2.5em;
            background: linear-gradient(45deg, #3498db, #9b59b6);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        h2 { 
            color: #34495e; 
            border-bottom: 3px solid #3498db; 
            padding-bottom: 10px; 
            margin-top: 40px; 
        }
        .summary { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); 
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
            height: 600px; 
            margin: 40px 0; 
            background: #f8f9fa; 
            border-radius: 12px; 
            padding: 20px;
        }
        .results-table { 
            width: 100%; 
            border-collapse: collapse; 
            margin: 30px 0; 
            font-size: 13px; 
            background: white;
        }
        .results-table th, .results-table td { 
            padding: 12px 8px; 
            text-align: center; 
            border-bottom: 1px solid #dee2e6; 
        }
        .results-table th { 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
            color: white;
            font-weight: 600; 
            position: sticky; 
            top: 0; 
        }
        .results-table tr:hover { background: #f8f9fa; }
        .config-panel { 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
            color: white;
            padding: 25px; 
            border-radius: 12px; 
            margin: 25px 0; 
        }
        .config-panel h3 { color: white; margin-top: 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>⚡ Concurrent 3D Parameter Optimization</h1>
        
        <div class="config-panel">
            <h3>🎯 Optimization Configuration</h3>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px;">
                <div><strong>Asset Pair:</strong> ${this.baseAsset}/${this.quoteAsset}</div>
                <div><strong>Window Size:</strong> ${this.windowSize} months</div>
                <div><strong>Moving Average:</strong> ${this.movingAverage}</div>
                <div><strong>Max Concurrency:</strong> ${this.maxConcurrency}</div>
            </div>
            <div style="margin-top: 15px;">
                <div><strong>Parameters Tested:</strong></div>
                <div>Z-Scores: [${this.zScoreThresholds.join(', ')}] | 
                     Profits: [${this.profitPercents.join(', ')}]% | 
                     Stops: [${this.stopLossPercents.join(', ')}]%</div>
            </div>
        </div>

        <div class="summary">
            <div class="metric">
                <div class="metric-value">${results.length}</div>
                <div class="metric-label">Total Results</div>
            </div>
            <div class="metric">
                <div class="metric-value ${avgReturn >= 0 ? 'positive' : 'negative'}">${avgReturn.toFixed(2)}%</div>
                <div class="metric-label">Average Return</div>
            </div>
            <div class="metric">
                <div class="metric-value ${maxReturn >= 0 ? 'positive' : 'negative'}">${maxReturn.toFixed(2)}%</div>
                <div class="metric-label">Best Return</div>
            </div>
            <div class="metric">
                <div class="metric-value">${avgSharpe.toFixed(3)}</div>
                <div class="metric-label">Average Sharpe</div>
            </div>
        </div>

        <h2>📊 Interactive 3D Parameter Space</h2>
        <div id="plotlyChart" class="chart-container"></div>

        <h2>🏆 Top Performance Results</h2>
        <table class="results-table">
            <thead>
                <tr>
                    <th>Rank</th>
                    <th>Z-Score</th>
                    <th>Profit %</th>
                    <th>Stop %</th>
                    <th>Return %</th>
                    <th>Sharpe</th>
                    <th>Max DD %</th>
                    <th>Win Rate %</th>
                    <th>Trades</th>
                </tr>
            </thead>
            <tbody>
                ${byReturn.slice(0, 20).map((result, i) => `
                    <tr>
                        <td><strong>${i + 1}</strong></td>
                        <td>${result.parameters.zScoreThreshold}</td>
                        <td>${result.parameters.profitPercent}%</td>
                        <td>${result.parameters.stopLossPercent}%</td>
                        <td class="${result.performance!.annualizedReturn >= 0 ? 'positive' : 'negative'}">
                            <strong>${result.performance!.annualizedReturn.toFixed(2)}%</strong>
                        </td>
                        <td>${result.performance!.sharpeRatio.toFixed(3)}</td>
                        <td class="negative">${result.performance!.maxDrawdown.toFixed(2)}%</td>
                        <td>${result.performance!.winRate.toFixed(1)}%</td>
                        <td>${result.performance!.totalTrades}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>

        <h2>📈 Sharpe Ratio Leaders</h2>
        <table class="results-table">
            <thead>
                <tr>
                    <th>Rank</th>
                    <th>Z-Score</th>
                    <th>Profit %</th>
                    <th>Stop %</th>
                    <th>Sharpe</th>
                    <th>Return %</th>
                    <th>Max DD %</th>
                    <th>Win Rate %</th>
                </tr>
            </thead>
            <tbody>
                ${bySharpe.slice(0, 10).map((result, i) => `
                    <tr>
                        <td><strong>${i + 1}</strong></td>
                        <td>${result.parameters.zScoreThreshold}</td>
                        <td>${result.parameters.profitPercent}%</td>
                        <td>${result.parameters.stopLossPercent}%</td>
                        <td><strong>${result.performance!.sharpeRatio.toFixed(3)}</strong></td>
                        <td class="${result.performance!.annualizedReturn >= 0 ? 'positive' : 'negative'}">
                            ${result.performance!.annualizedReturn.toFixed(2)}%
                        </td>
                        <td class="negative">${result.performance!.maxDrawdown.toFixed(2)}%</td>
                        <td>${result.performance!.winRate.toFixed(1)}%</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </div>

    <script>
        // 3D Scatter plot with Plotly.js
        const chartData3D = [
            {
                x: [${chartData.map(d => d.x).join(', ')}],
                y: [${chartData.map(d => d.y).join(', ')}],
                z: [${chartData.map(d => d.z).join(', ')}],
                mode: 'markers',
                marker: {
                    color: [${chartData.map(d => d.value).join(', ')}],
                    colorscale: [
                        [0, '#ff0000'],
                        [0.5, '#ffff00'], 
                        [1, '#00ff00']
                    ],
                    size: [${chartData.map(d => Math.max(5, Math.abs(d.value) / 2)).join(', ')}],
                    colorbar: {
                        title: 'Annualized Return (%)',
                        x: 1.1
                    },
                    showscale: true
                },
                text: [${chartData.map(d => `'Z=${d.z}, P=${d.x}%, S=${d.y}%<br>Return: ${d.value.toFixed(2)}%<br>Trades: ${d.trades}'`).join(', ')}],
                hovertemplate: '%{text}<extra></extra>',
                type: 'scatter3d'
            }
        ];

        const layout3D = {
            title: {
                text: 'Parameter Optimization 3D Space<br><sub>Color = Annualized Return, Size = Performance Magnitude</sub>',
                font: { size: 18 }
            },
            scene: {
                xaxis: { title: 'Profit Percent (%)' },
                yaxis: { title: 'Stop Loss Percent (%)' },
                zaxis: { title: 'Z-Score Threshold' },
                camera: {
                    eye: { x: 1.5, y: 1.5, z: 1.5 }
                }
            },
            margin: { l: 0, r: 0, b: 0, t: 50 },
            font: { family: 'Segoe UI, sans-serif' }
        };

        const config3D = {
            displayModeBar: true,
            displaylogo: false,
            modeBarButtonsToRemove: ['pan2d', 'lasso2d'],
            responsive: true
        };

        Plotly.newPlot('plotlyChart', chartData3D, layout3D, config3D);
        
        console.log('📊 3D Optimization chart loaded successfully');
        console.log(\`🎯 Analyzed \${${results.length}} parameter combinations\`);
    </script>
</body>
</html>`;

    const chartPath = path.join('analysis', `concurrent-3d-chart-${this.baseAsset}-${this.quoteAsset}-${timestamp}.html`);
    fs.writeFileSync(chartPath, html);
    
    return chartPath;
  }
}

function parseArguments() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('Usage: npm run runAllWindowedBacktestsForPair-concurrent -- baseAsset quoteAsset [windowSize] [--mas=10] [--zscores=1,2,3] [--profits=2,4,6] [--stops=2,4,6] [--concurrency=4] [--charts] [--window-charts]');
    process.exit(1);
  }
  
  const regularArgs: string[] = [];
  const paramFlags: { [key: string]: string } = {};
  let includeCharts = false;
  let includeWindowCharts = false;
  
  for (const arg of args) {
    if (arg.startsWith('--')) {
      if (arg === '--charts') {
        includeCharts = true;
      } else if (arg === '--window-charts') {
        includeWindowCharts = true;
      } else {
        const [key, value] = arg.split('=');
        if (value) {
          paramFlags[key.substring(2)] = value;
        }
      }
    } else {
      regularArgs.push(arg);
    }
  }
  
  const [baseAsset, quoteAsset, windowSizeStr] = regularArgs;
  const windowSize = windowSizeStr ? parseInt(windowSizeStr) : 12;
  const maxConcurrency = paramFlags.concurrency ? parseInt(paramFlags.concurrency) : 4;
  
  const customParams: any = {};
  
  if (paramFlags.zscores) {
    customParams.zScoreThresholds = paramFlags.zscores
      .split(',')
      .map(v => parseFloat(v.trim()))
      .filter(v => !isNaN(v));
  }
  
  if (paramFlags.profits) {
    customParams.profitPercents = paramFlags.profits
      .split(',')
      .map(v => parseFloat(v.trim()))
      .filter(v => !isNaN(v));
  }
  
  if (paramFlags.stops) {
    customParams.stopLossPercents = paramFlags.stops
      .split(',')
      .map(v => parseFloat(v.trim()))
      .filter(v => !isNaN(v));
  }
  
  if (paramFlags.ma || paramFlags.mas) {
    const ma = parseInt(paramFlags.ma || paramFlags.mas);
    if (!isNaN(ma)) {
      customParams.movingAverage = ma;
    }
  }
  
  return {
    baseAsset: baseAsset.toUpperCase(),
    quoteAsset: quoteAsset.toUpperCase(),
    windowSize,
    maxConcurrency,
    customParams,
    includeCharts,
    includeWindowCharts
  };
}

async function main() {
  try {
    const { baseAsset, quoteAsset, windowSize, maxConcurrency, customParams, includeCharts, includeWindowCharts } = parseArguments();
    
    console.log('🎯 Concurrent Parameter Optimization Starting...');
    console.log('================================================================================');
    console.log(`📊 Asset Pair: ${baseAsset}/${quoteAsset}`);
    console.log(`📅 Window Size: ${windowSize} months`);
    console.log(`⚡ Max Concurrency: ${maxConcurrency}`);
    console.log(`📈 Charts: ${includeCharts ? 'Enabled (will generate 3D visualizations)' : 'Disabled'}`);
    console.log(`📊 Window Charts: ${includeWindowCharts ? 'Enabled (individual window analysis)' : 'Disabled'}`);
    
    if (Object.keys(customParams).length > 0) {
      console.log('📋 Using custom parameters:');
      if (customParams.zScoreThresholds) console.log(`   Z-Scores: [${customParams.zScoreThresholds.join(', ')}]`);
      if (customParams.profitPercents) console.log(`   Profits: [${customParams.profitPercents.join(', ')}]%`);
      if (customParams.stopLossPercents) console.log(`   Stops: [${customParams.stopLossPercents.join(', ')}]%`);
      if (customParams.movingAverage) console.log(`   Moving Average: ${customParams.movingAverage}`);
    } else {
      console.log('📋 Using .env default parameters');
    }
    
    const runner = new ConcurrentBacktestRunner(
      baseAsset,
      quoteAsset, 
      windowSize,
      undefined, // startDate
      maxConcurrency,
      customParams
    );
    
    const results = await runner.runOptimization();
    await runner.generateReport(includeCharts, includeWindowCharts);
    
  } catch (error) {
    console.error('❌ Concurrent optimization failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}