#!/usr/bin/env ts-node

/**
 * Run All Windowed Backtests Script
 * 
 * This script executes the runWindowedBacktest.ts script iteratively implementing 
 * the walk-forward methodology as defined in BACKTEST_SPEC.html.
 * 
 * It starts at startTime, runs backtests for windowSize months, then steps forward 
 * by windowSize/2 months and repeats until the end of the dataset.
 * 
 * Usage: npm run runAllWindowedBacktests "2021-08-01" 12 ETH USDT 3.0 200 5.0 2.5
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

config();

interface WalkForwardConfig {
  startTime: Date;
  endTime: Date;
  windowSize: number; // months
  stepSize: number; // months (windowSize / 2)
  baseAsset: string;
  quoteAsset: string;
  zScoreThreshold: number;
  movingAverages: number;
  profitPercent: number;
  stopLossPercent: number;
}

interface BacktestSummary {
  runId: string;
  startTime: Date;
  endTime: Date;
  totalReturn: number;
  annualizedReturn: number;
  benchmarkReturn: number;
  alpha: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRatio: number;
  totalTrades: number;
}

class WalkForwardTester {
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
   * Get the available date range from the glicko_ratings table
   */
  async getAvailableDateRange(symbol: string): Promise<{ start: Date; end: Date } | null> {
    const dateRange = await this.prisma.glickoRatings.aggregate({
      where: { symbol },
      _min: { timestamp: true },
      _max: { timestamp: true }
    });

    if (!dateRange._min.timestamp || !dateRange._max.timestamp) {
      return null;
    }

    return {
      start: dateRange._min.timestamp,
      end: dateRange._max.timestamp
    };
  }

  /**
   * Run a single windowed backtest
   */
  private async runSingleBacktest(
    windowStart: Date,
    windowEnd: Date,
    baseAsset: string,
    quoteAsset: string,
    zScoreThreshold: number,
    movingAverages: number,
    profitPercent: number,
    stopLossPercent: number
  ): Promise<BacktestSummary | null> {
    return new Promise((resolve, reject) => {
      // Calculate window size in months from start and end dates
      const windowSizeMonths = Math.round((windowEnd.getTime() - windowStart.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
      
      const args = [
        'scripts/runWindowedBacktest.ts',
        windowStart.toISOString().split('T')[0],
        windowSizeMonths.toString(),
        baseAsset,
        quoteAsset,
        zScoreThreshold.toString(),
        movingAverages.toString(),
        profitPercent.toString(),
        stopLossPercent.toString(),
        '--no-html'  // Skip HTML generation for walk-forward analysis
      ];

      const child = spawn('npx', ['ts-node', ...args], {
        stdio: 'pipe'
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', async (code) => {
        if (code === 0) {
          try {
            // Extract performance metrics from the output
            const returnMatch = stdout.match(/Total Return: (-?\d+\.?\d*)%/);
            const annualizedMatch = stdout.match(/Annualized Return: (-?\d+\.?\d*)%/);
            const benchmarkMatch = stdout.match(/Benchmark Return: (-?\d+\.?\d*)%/);
            const alphaMatch = stdout.match(/Alpha \(Excess Return\): (-?\d+\.?\d*)%/);
            const sharpeMatch = stdout.match(/Sharpe Ratio: (-?\d+\.?\d*)/);
            const drawdownMatch = stdout.match(/Max Drawdown: (-?\d+\.?\d*)%/);
            const winRatioMatch = stdout.match(/Win Ratio: (-?\d+\.?\d*)%/);
            const tradesMatch = stdout.match(/Total Trades: (\d+)/);

            const summary: BacktestSummary = {
              runId: `${baseAsset}${quoteAsset}_${windowStart.toISOString().split('T')[0]}_${windowEnd.toISOString().split('T')[0]}_${Date.now()}`,
              startTime: new Date(windowStart.toISOString().split('T')[0]),
              endTime: new Date(windowEnd.toISOString().split('T')[0]),
              totalReturn: returnMatch ? parseFloat(returnMatch[1]) : 0,
              annualizedReturn: annualizedMatch ? parseFloat(annualizedMatch[1]) : 0,
              benchmarkReturn: benchmarkMatch ? parseFloat(benchmarkMatch[1]) : 0,
              alpha: alphaMatch ? parseFloat(alphaMatch[1]) : 0,
              sharpeRatio: sharpeMatch ? parseFloat(sharpeMatch[1]) : 0,
              maxDrawdown: drawdownMatch ? parseFloat(drawdownMatch[1]) : 0,
              winRatio: winRatioMatch ? parseFloat(winRatioMatch[1]) : 0,
              totalTrades: tradesMatch ? parseInt(tradesMatch[1]) : 0
            };

            resolve(summary);
          } catch (error) {
            console.error(`Error parsing backtest output:`, error);
            resolve(null);
          }
        } else {
          console.error(`Backtest failed with code ${code}:`, stderr);
          resolve(null);
        }
      });

      child.on('error', (error) => {
        console.error(`Failed to start backtest:`, error);
        reject(error);
      });
    });
  }

  /**
   * Run the complete walk-forward analysis
   */
  async runWalkForwardAnalysis(config: WalkForwardConfig): Promise<BacktestSummary[]> {
    console.log(`🚀 Starting Walk-Forward Analysis for ${config.baseAsset}/${config.quoteAsset}`);
    console.log(`📅 Period: ${config.startTime.toISOString().split('T')[0]} to ${config.endTime.toISOString().split('T')[0]}`);
    console.log(`📊 Window: ${config.windowSize} months, Step: ${config.stepSize} months`);
    console.log(`⚙️ Parameters: Z=${config.zScoreThreshold}, MA=${config.movingAverages}, P=${config.profitPercent}%, SL=${config.stopLossPercent}%`);

    const results: BacktestSummary[] = [];
    let currentStart = new Date(config.startTime);
    let runNumber = 1;

    while (currentStart < config.endTime) {
      const windowEnd = new Date(currentStart);
      windowEnd.setMonth(windowEnd.getMonth() + config.windowSize);

      // Stop if window extends beyond available data
      if (windowEnd > config.endTime) {
        console.log(`⏹️ Reached end of available data at ${config.endTime.toISOString().split('T')[0]}`);
        break;
      }

      const windowStartStr = currentStart.toISOString().split('T')[0];
      const windowEndStr = windowEnd.toISOString().split('T')[0];
      console.log(`\n[${runNumber}] Running backtest: ${windowStartStr} to ${windowEndStr}`);

      try {
        const result = await this.runSingleBacktest(
          currentStart,
          windowEnd,
          config.baseAsset,
          config.quoteAsset,
          config.zScoreThreshold,
          config.movingAverages,
          config.profitPercent,
          config.stopLossPercent
        );

        if (result) {
          results.push(result);
          console.log(`   ✅ Return: ${result.totalReturn.toFixed(2)}%, Alpha: ${result.alpha.toFixed(2)}%, Trades: ${result.totalTrades}, Sharpe: ${result.sharpeRatio.toFixed(2)}`);
        } else {
          console.log(`   ❌ Backtest failed`);
        }

      } catch (error) {
        console.error(`   ❌ Error running backtest:`, error);
      }

      // Move forward by step size
      currentStart.setMonth(currentStart.getMonth() + config.stepSize);
      runNumber++;

      // Add small delay to prevent overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`\n✅ Walk-forward analysis completed: ${results.length} successful backtests`);
    return results;
  }

  /**
   * Generate comprehensive analysis report
   */
  generateAnalysisReport(results: BacktestSummary[], config: WalkForwardConfig): string {
    if (results.length === 0) {
      return '<html><body><h1>No successful backtests to analyze</h1></body></html>';
    }

    // Calculate summary statistics
    const returns = results.map(r => r.totalReturn);
    const benchmarkReturns = results.map(r => r.benchmarkReturn);
    const alphas = results.map(r => r.alpha);
    const sharpeRatios = results.map(r => r.sharpeRatio);
    const drawdowns = results.map(r => r.maxDrawdown);
    const totalTrades = results.reduce((sum, r) => sum + r.totalTrades, 0);

    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const avgBenchmarkReturn = benchmarkReturns.reduce((sum, r) => sum + r, 0) / benchmarkReturns.length;
    const avgAlpha = alphas.reduce((sum, r) => sum + r, 0) / alphas.length;
    const avgSharpe = sharpeRatios.reduce((sum, r) => sum + r, 0) / sharpeRatios.length;
    const maxDrawdown = Math.max(...drawdowns);
    const consistency = results.filter(r => r.totalReturn > 0).length / results.length * 100;
    const positiveAlphaWindows = results.filter(r => r.alpha > 0).length / results.length * 100;

    // Prepare chart data
    const equityData = results.map(r => ({
      x: r.startTime.toISOString().split('T')[0],
      y: r.totalReturn
    }));

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Walk-Forward Analysis - ${config.baseAsset}/${config.quoteAsset}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@2.0.1/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1400px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        h1 { color: #2c3e50; text-align: center; margin-bottom: 30px; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 30px 0; }
        .metric { background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center; border-left: 4px solid #3498db; }
        .metric-value { font-size: 28px; font-weight: bold; color: #2c3e50; }
        .metric-label { color: #7f8c8d; font-size: 14px; margin-top: 5px; }
        .positive { color: #27ae60; }
        .negative { color: #e74c3c; }
        .chart-container { height: 400px; margin: 30px 0; }
        .results-table { width: 100%; border-collapse: collapse; margin: 30px 0; font-size: 14px; }
        .results-table th, .results-table td { padding: 12px; text-align: left; border-bottom: 1px solid #dee2e6; }
        .results-table th { background: #f8f9fa; font-weight: 600; position: sticky; top: 0; }
        .config-panel { background: #ecf0f1; padding: 20px; border-radius: 8px; margin: 20px 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Walk-Forward Analysis Report</h1>
        
        <div class="config-panel">
            <h3>Configuration</h3>
            <p><strong>Asset:</strong> ${config.baseAsset}/${config.quoteAsset}</p>
            <p><strong>Analysis Period:</strong> ${config.startTime.toISOString().split('T')[0]} to ${config.endTime.toISOString().split('T')[0]}</p>
            <p><strong>Window Size:</strong> ${config.windowSize} months | <strong>Step Size:</strong> ${config.stepSize} months</p>
            <p><strong>Parameters:</strong> Z-Score: ±${config.zScoreThreshold}, MA: ${config.movingAverages}, Profit: +${config.profitPercent}%, Stop: -${config.stopLossPercent}%</p>
            <p><strong>Total Backtests:</strong> ${results.length} windows</p>
        </div>

        <div class="summary">
            <div class="metric">
                <div class="metric-value ${avgReturn >= 0 ? 'positive' : 'negative'}">${avgReturn.toFixed(2)}%</div>
                <div class="metric-label">Average Return per Window</div>
            </div>
            <div class="metric">
                <div class="metric-value ${avgBenchmarkReturn >= 0 ? 'positive' : 'negative'}">${avgBenchmarkReturn.toFixed(2)}%</div>
                <div class="metric-label">Average Benchmark Return</div>
            </div>
            <div class="metric">
                <div class="metric-value ${avgAlpha >= 0 ? 'positive' : 'negative'}">${avgAlpha.toFixed(2)}%</div>
                <div class="metric-label">Average Alpha (Excess Return)</div>
            </div>
            <div class="metric">
                <div class="metric-value">${avgSharpe.toFixed(2)}</div>
                <div class="metric-label">Average Sharpe Ratio</div>
            </div>
            <div class="metric">
                <div class="metric-value negative">${maxDrawdown.toFixed(2)}%</div>
                <div class="metric-label">Worst Drawdown</div>
            </div>
            <div class="metric">
                <div class="metric-value">${consistency.toFixed(1)}%</div>
                <div class="metric-label">Positive Windows</div>
            </div>
            <div class="metric">
                <div class="metric-value">${positiveAlphaWindows.toFixed(1)}%</div>
                <div class="metric-label">Windows with Positive Alpha</div>
            </div>
            <div class="metric">
                <div class="metric-value">${totalTrades}</div>
                <div class="metric-label">Total Trades</div>
            </div>
            <div class="metric">
                <div class="metric-value">${(totalTrades / results.length).toFixed(1)}</div>
                <div class="metric-label">Avg Trades per Window</div>
            </div>
        </div>

        <div class="chart-container">
            <canvas id="returnsChart"></canvas>
        </div>

        <h3>Individual Backtest Results</h3>
        <div style="max-height: 500px; overflow-y: auto;">
            <table class="results-table">
                <thead>
                    <tr>
                        <th>Window</th>
                        <th>Start Date</th>
                        <th>End Date</th>
                        <th>Total Return %</th>
                        <th>Benchmark Return %</th>
                        <th>Alpha %</th>
                        <th>Annualized Return %</th>
                        <th>Sharpe Ratio</th>
                        <th>Max Drawdown %</th>
                        <th>Win Ratio %</th>
                        <th>Total Trades</th>
                    </tr>
                </thead>
                <tbody>
                    ${results.map((result, index) => `
                        <tr>
                            <td>${index + 1}</td>
                            <td>${result.startTime.toISOString().split('T')[0]}</td>
                            <td>${result.endTime.toISOString().split('T')[0]}</td>
                            <td class="${result.totalReturn >= 0 ? 'positive' : 'negative'}">${result.totalReturn.toFixed(2)}%</td>
                            <td class="${result.benchmarkReturn >= 0 ? 'positive' : 'negative'}">${result.benchmarkReturn.toFixed(2)}%</td>
                            <td class="${result.alpha >= 0 ? 'positive' : 'negative'}">${result.alpha.toFixed(2)}%</td>
                            <td class="${result.annualizedReturn >= 0 ? 'positive' : 'negative'}">${result.annualizedReturn.toFixed(2)}%</td>
                            <td>${result.sharpeRatio.toFixed(2)}</td>
                            <td class="negative">${result.maxDrawdown.toFixed(2)}%</td>
                            <td>${result.winRatio.toFixed(1)}%</td>
                            <td>${result.totalTrades}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <script>
            // Returns by Window Chart
            const ctx = document.getElementById('returnsChart').getContext('2d');
            new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: [${results.map((_, i) => `'Window ${i + 1}'`).join(', ')}],
                    datasets: [{
                        label: 'Total Return (%)',
                        data: [${results.map(r => r.totalReturn).join(', ')}],
                        backgroundColor: [${results.map(r => r.totalReturn >= 0 ? "'rgba(39, 174, 96, 0.7)'" : "'rgba(231, 76, 60, 0.7)'").join(', ')}],
                        borderColor: [${results.map(r => r.totalReturn >= 0 ? "'rgba(39, 174, 96, 1)'" : "'rgba(231, 76, 60, 1)'").join(', ')}],
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: { display: true, text: 'Return (%)' }
                        },
                        x: {
                            title: { display: true, text: 'Backtest Window' }
                        }
                    },
                    plugins: {
                        title: {
                            display: true,
                            text: 'Returns by Backtest Window'
                        },
                        legend: { display: false }
                    }
                }
            });
        </script>
    </div>
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
function parseArguments(): Omit<WalkForwardConfig, 'startTime'> & { startTimeStr?: string } {
  const args = process.argv.slice(2);

  if (args.length !== 7 && args.length !== 8) {
    console.error('❌ Invalid arguments. Usage:');
    console.error('npm run runAllWindowedBacktests [startTime] windowSize baseAsset quoteAsset zScoreThreshold movingAverages profitPercent stopLossPercent');
    console.error('');
    console.error('Examples:');
    console.error('  npm run runAllWindowedBacktests 12 ETH USDT 3.0 200 5.0 2.5  (auto-detect start date)');
    console.error('  npm run runAllWindowedBacktests "2021-08-01" 12 ETH USDT 3.0 200 5.0 2.5  (specify start date)');
    console.error('');
    console.error('Arguments:');
    console.error('  startTime: Start date (YYYY-MM-DD) - Optional, auto-detected from database if omitted');
    console.error('  windowSize: Window size in months');
    console.error('  baseAsset: Base asset (e.g., ETH)');
    console.error('  quoteAsset: Quote asset (e.g., USDT)');
    console.error('  zScoreThreshold: Z-score threshold');
    console.error('  movingAverages: Moving average period');
    console.error('  profitPercent: Profit target %');
    console.error('  stopLossPercent: Stop loss %');
    process.exit(1);
  }

  let startTimeStr: string | undefined;
  let restArgs: string[];

  if (args.length === 8) {
    // Start time provided
    [startTimeStr, ...restArgs] = args;
  } else {
    // Start time not provided, will auto-detect
    restArgs = args;
  }

  const [windowSizeStr, baseAsset, quoteAsset, zScoreThresholdStr, movingAveragesStr, profitPercentStr, stopLossPercentStr] = restArgs;

  const windowSize = parseInt(windowSizeStr);
  const stepSize = Math.floor(windowSize / 2); // Half of window size

  if (startTimeStr && isNaN(new Date(startTimeStr).getTime())) {
    console.error('❌ Invalid start date format. Use YYYY-MM-DD format');
    process.exit(1);
  }

  // Calculate rough end time (will be refined based on available data)
  const endTime = new Date('2025-08-01'); // Use current date as maximum

  return {
    startTimeStr,
    endTime,
    windowSize,
    stepSize,
    baseAsset: baseAsset.toUpperCase(),
    quoteAsset: quoteAsset.toUpperCase(),
    zScoreThreshold: parseFloat(zScoreThresholdStr),
    movingAverages: parseInt(movingAveragesStr),
    profitPercent: parseFloat(profitPercentStr),
    stopLossPercent: parseFloat(stopLossPercentStr)
  };
}

/**
 * Main execution function
 */
async function main() {
  const tester = new WalkForwardTester();

  try {
    console.log('🎯 Starting Walk-Forward Backtesting Analysis...');
    console.log('=' .repeat(80));

    await tester.initialize();

    const parsedArgs = parseArguments();

    // Check available data range
    const dateRange = await tester.getAvailableDateRange(parsedArgs.baseAsset);
    if (!dateRange) {
      throw new Error(`No Glicko ratings found for ${parsedArgs.baseAsset}. Run calculateGlickoRatings first.`);
    }

    // Determine start time
    let startTime: Date;
    if (parsedArgs.startTimeStr) {
      startTime = new Date(parsedArgs.startTimeStr);
      console.log(`📅 Using provided start date: ${startTime.toISOString().split('T')[0]}`);
    } else {
      startTime = dateRange.start;
      console.log(`📅 Auto-detected start date from database: ${startTime.toISOString().split('T')[0]}`);
    }

    // Create complete config
    const config: WalkForwardConfig = {
      startTime,
      endTime: parsedArgs.endTime,
      windowSize: parsedArgs.windowSize,
      stepSize: parsedArgs.stepSize,
      baseAsset: parsedArgs.baseAsset,
      quoteAsset: parsedArgs.quoteAsset,
      zScoreThreshold: parsedArgs.zScoreThreshold,
      movingAverages: parsedArgs.movingAverages,
      profitPercent: parsedArgs.profitPercent,
      stopLossPercent: parsedArgs.stopLossPercent
    };

    // Adjust end time based on available data
    if (config.endTime > dateRange.end) {
      config.endTime = dateRange.end;
      console.log(`📅 Adjusted end time to available data: ${config.endTime.toISOString().split('T')[0]}`);
    }

    // Ensure we have sufficient data (window size + moving average buffer)
    const minRequiredMonths = config.windowSize + Math.ceil(config.movingAverages / (24 * 30)); // Rough estimate
    const availableMonths = (dateRange.end.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
    
    if (availableMonths < minRequiredMonths) {
      console.warn(`⚠️ Warning: Available data (${availableMonths.toFixed(1)} months) may be insufficient for window size (${config.windowSize} months)`);
    }

    // Run walk-forward analysis
    const results = await tester.runWalkForwardAnalysis(config);

    if (results.length === 0) {
      console.log('❌ No successful backtests completed');
      return;
    }

    // Generate analysis report
    const html = tester.generateAnalysisReport(results, config);
    const paramString = `Z${config.zScoreThreshold}_MA${config.movingAverages}_P${config.profitPercent}_S${config.stopLossPercent}`;
    const reportPath = path.join('analysis', `walk-forward-${config.baseAsset}${config.quoteAsset}-${paramString}-${Date.now()}.html`);
    
    // Ensure analysis directory exists
    if (!fs.existsSync('analysis')) {
      fs.mkdirSync('analysis');
    }
    
    fs.writeFileSync(reportPath, html);

    // Display summary
    console.log('\n🎉 Walk-Forward Analysis completed successfully!');
    console.log('📊 Summary Statistics:');
    
    const returns = results.map(r => r.totalReturn);
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const positiveWindows = results.filter(r => r.totalReturn > 0).length;
    const consistency = (positiveWindows / results.length) * 100;
    
    console.log(`  - Windows analyzed: ${results.length}`);
    console.log(`  - Average return per window: ${avgReturn.toFixed(2)}%`);
    console.log(`  - Positive windows: ${positiveWindows}/${results.length} (${consistency.toFixed(1)}%)`);
    console.log(`  - Best window: ${Math.max(...returns).toFixed(2)}%`);
    console.log(`  - Worst window: ${Math.min(...returns).toFixed(2)}%`);
    console.log(`📁 Detailed report saved to: ${reportPath}`);

  } catch (error) {
    console.error('\n❌ Walk-forward analysis failed:', error);
    process.exit(1);
  } finally {
    await tester.cleanup();
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { WalkForwardTester, WalkForwardConfig };