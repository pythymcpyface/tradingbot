#!/usr/bin/env ts-node

/**
 * Simple Backtest Results Analysis
 * 
 * Analyzes and visualizes backtest results from the database
 * Creates comparison charts and summary reports
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

config();

interface BacktestSummary {
  id: string;
  pair: string;
  startTime: Date;
  endTime: Date;
  totalReturn: number;
  annualizedReturn: number;
  benchmarkReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRatio: number;
  totalTrades: number;
  profitFactor: number;
  avgTradeDuration: number;
  parameters: {
    zScoreThreshold: number;
    movingAverages: number;
    profitPercent: number;
    stopLossPercent: number;
  };
}

class BacktestAnalyzer {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async initialize(): Promise<void> {
    await this.prisma.$connect();
    console.log('✅ Connected to database');
  }

  /**
   * Fetch all backtest runs from the database
   */
  async fetchBacktestRuns(): Promise<BacktestSummary[]> {
    console.log('📊 Fetching backtest runs with results...');
    
    const results = await this.prisma.optimizationResults.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10, // Get latest 10 runs
      include: {
        backtestRun: true
      }
    });

    console.log(`✅ Found ${results.length} backtest results`);

    return results.map(result => ({
      id: result.runId,
      pair: `${result.baseAsset}/${result.quoteAsset}`,
      startTime: result.startTime,
      endTime: result.endTime,
      totalReturn: Number(result.totalReturn),
      annualizedReturn: Number(result.annualizedReturn),
      benchmarkReturn: Number(result.benchmarkReturn || 0),
      sharpeRatio: Number(result.sharpeRatio),
      maxDrawdown: Number(result.maxDrawdown),
      winRatio: Number(result.winRatio),
      totalTrades: result.totalTrades,
      profitFactor: Number(result.profitFactor),
      avgTradeDuration: Number(result.avgTradeDuration),
      parameters: {
        zScoreThreshold: Number(result.zScoreThreshold),
        movingAverages: result.movingAverages,
        profitPercent: Number(result.profitPercent),
        stopLossPercent: Number(result.stopLossPercent)
      }
    }));
  }

  /**
   * Generate HTML comparison chart
   */
  generateComparisonChart(backtests: BacktestSummary[]): string {
    const now = new Date().toISOString();
    
    // Prepare data for charts
    const labels = backtests.map(bt => `${bt.pair} (${bt.parameters.zScoreThreshold}z)`);
    const returnsData = backtests.map(bt => bt.totalReturn);
    const benchmarkData = backtests.map(bt => bt.benchmarkReturn);
    const sharpeData = backtests.map(bt => bt.sharpeRatio);
    const drawdownData = backtests.map(bt => Math.abs(bt.maxDrawdown));
    const winRatioData = backtests.map(bt => bt.winRatio * 100);

    // Generate colors
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
      '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
    ];

    const summaryTable = backtests.map((bt, index) => `
      <tr>
        <td style="color: ${colors[index % colors.length]};">●</td>
        <td><strong>${bt.pair}</strong></td>
        <td>${bt.parameters.zScoreThreshold}</td>
        <td>${bt.parameters.movingAverages}</td>
        <td>${bt.parameters.profitPercent}%</td>
        <td>${bt.parameters.stopLossPercent}%</td>
        <td style="color: ${bt.totalReturn >= 0 ? '#27AE60' : '#E74C3C'};">
          ${bt.totalReturn >= 0 ? '+' : ''}${bt.totalReturn.toFixed(2)}%
        </td>
        <td style="color: ${bt.benchmarkReturn >= 0 ? '#27AE60' : '#E74C3C'};">
          ${bt.benchmarkReturn >= 0 ? '+' : ''}${bt.benchmarkReturn.toFixed(2)}%
        </td>
        <td>${bt.sharpeRatio.toFixed(2)}</td>
        <td>${Math.abs(bt.maxDrawdown).toFixed(2)}%</td>
        <td>${(bt.winRatio * 100).toFixed(1)}%</td>
        <td>${bt.totalTrades}</td>
      </tr>
    `).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Backtest Results Comparison</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f8f9fa;
            color: #343a40;
        }
        .container {
            max-width: 1400px;
            margin: 0 auto;
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        h1 {
            text-align: center;
            color: #2c3e50;
            margin-bottom: 30px;
            font-size: 2.5em;
        }
        .meta-info {
            background: #ecf0f1;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 30px;
            text-align: center;
            color: #7f8c8d;
        }
        .chart-container {
            position: relative;
            height: 400px;
            margin: 30px 0;
        }
        .chart-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(600px, 1fr));
            gap: 30px;
            margin: 30px 0;
        }
        .summary-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
            font-size: 13px;
        }
        .summary-table th,
        .summary-table td {
            padding: 8px;
            text-align: left;
            border-bottom: 1px solid #dee2e6;
        }
        .summary-table th {
            background-color: #f8f9fa;
            font-weight: 600;
            color: #495057;
        }
        .summary-table tr:hover {
            background-color: #f8f9fa;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin: 30px 0;
        }
        .stat-card {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
            border-left: 4px solid #3498db;
        }
        .stat-value {
            font-size: 2em;
            font-weight: bold;
            color: #2c3e50;
        }
        .stat-label {
            color: #7f8c8d;
            font-size: 0.9em;
            margin-top: 5px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>📊 Backtest Results Comparison</h1>
        
        <div class="meta-info">
            Generated on ${new Date(now).toLocaleDateString('en-US', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            })} at ${new Date(now).toLocaleTimeString()}
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${backtests.length}</div>
                <div class="stat-label">Backtest Runs</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${(returnsData.reduce((sum, val) => sum + val, 0) / returnsData.length).toFixed(1)}%</div>
                <div class="stat-label">Avg Return</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${backtests.reduce((sum, bt) => sum + bt.totalTrades, 0)}</div>
                <div class="stat-label">Total Trades</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${backtests.filter(bt => bt.totalReturn > 0).length}</div>
                <div class="stat-label">Profitable Strategies</div>
            </div>
        </div>

        <div class="chart-grid">
            <div class="chart-container">
                <canvas id="returnsChart"></canvas>
            </div>
            <div class="chart-container">
                <canvas id="sharpeChart"></canvas>
            </div>
            <div class="chart-container">
                <canvas id="drawdownChart"></canvas>
            </div>
            <div class="chart-container">
                <canvas id="winRatioChart"></canvas>
            </div>
        </div>

        <div class="summary-section">
            <h2>📋 Detailed Results</h2>
            <table class="summary-table">
                <thead>
                    <tr>
                        <th></th>
                        <th>Pair</th>
                        <th>Z-Score</th>
                        <th>MA</th>
                        <th>Profit%</th>
                        <th>Stop%</th>
                        <th>Total Return</th>
                        <th>Benchmark</th>
                        <th>Sharpe</th>
                        <th>Max DD</th>
                        <th>Win Rate</th>
                        <th>Trades</th>
                    </tr>
                </thead>
                <tbody>
                    ${summaryTable}
                </tbody>
            </table>
        </div>
    </div>

    <script>
        // Returns Comparison Chart
        const returnsCtx = document.getElementById('returnsChart').getContext('2d');
        new Chart(returnsCtx, {
            type: 'bar',
            data: {
                labels: ${JSON.stringify(labels)},
                datasets: [{
                    label: 'Strategy Return (%)',
                    data: ${JSON.stringify(returnsData)},
                    backgroundColor: '${colors[0]}',
                    borderColor: '${colors[0]}',
                    borderWidth: 1
                }, {
                    label: 'Benchmark Return (%)',
                    data: ${JSON.stringify(benchmarkData)},
                    backgroundColor: '${colors[1]}',
                    borderColor: '${colors[1]}',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: 'Returns Comparison'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Return (%)'
                        }
                    }
                }
            }
        });

        // Sharpe Ratio Chart
        const sharpeCtx = document.getElementById('sharpeChart').getContext('2d');
        new Chart(sharpeCtx, {
            type: 'bar',
            data: {
                labels: ${JSON.stringify(labels)},
                datasets: [{
                    label: 'Sharpe Ratio',
                    data: ${JSON.stringify(sharpeData)},
                    backgroundColor: '${colors[2]}',
                    borderColor: '${colors[2]}',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: 'Sharpe Ratio Comparison'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Sharpe Ratio'
                        }
                    }
                }
            }
        });

        // Max Drawdown Chart
        const drawdownCtx = document.getElementById('drawdownChart').getContext('2d');
        new Chart(drawdownCtx, {
            type: 'bar',
            data: {
                labels: ${JSON.stringify(labels)},
                datasets: [{
                    label: 'Max Drawdown (%)',
                    data: ${JSON.stringify(drawdownData)},
                    backgroundColor: '${colors[3]}',
                    borderColor: '${colors[3]}',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: 'Maximum Drawdown'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Drawdown (%)'
                        }
                    }
                }
            }
        });

        // Win Ratio Chart
        const winRatioCtx = document.getElementById('winRatioChart').getContext('2d');
        new Chart(winRatioCtx, {
            type: 'bar',
            data: {
                labels: ${JSON.stringify(labels)},
                datasets: [{
                    label: 'Win Rate (%)',
                    data: ${JSON.stringify(winRatioData)},
                    backgroundColor: '${colors[4]}',
                    borderColor: '${colors[4]}',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: 'Win Rate Comparison'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        title: {
                            display: true,
                            text: 'Win Rate (%)'
                        }
                    }
                }
            }
        });
    </script>
</body>
</html>`;
  }

  /**
   * Save comparison chart to analysis directory
   */
  async saveComparisonChart(html: string): Promise<string> {
    const analysisDir = path.join(process.cwd(), 'analysis');
    
    if (!fs.existsSync(analysisDir)) {
      fs.mkdirSync(analysisDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `backtest-comparison-${timestamp}.html`;
    const filePath = path.join(analysisDir, filename);
    
    fs.writeFileSync(filePath, html);
    console.log(`📁 Comparison chart saved to: ${filePath}`);
    
    return filePath;
  }

  /**
   * Generate analysis report
   */
  generateAnalysisReport(backtests: BacktestSummary[]): void {
    console.log('\n📈 Backtest Analysis Report:');
    console.log('=' .repeat(60));
    
    const avgReturn = backtests.reduce((sum, bt) => sum + bt.totalReturn, 0) / backtests.length;
    const avgSharpe = backtests.reduce((sum, bt) => sum + bt.sharpeRatio, 0) / backtests.length;
    const avgWinRate = backtests.reduce((sum, bt) => sum + bt.winRatio, 0) / backtests.length;
    const profitableStrategies = backtests.filter(bt => bt.totalReturn > 0);
    
    console.log(`📊 Summary Statistics:`);
    console.log(`  • Total backtests: ${backtests.length}`);
    console.log(`  • Average return: ${avgReturn.toFixed(2)}%`);
    console.log(`  • Average Sharpe ratio: ${avgSharpe.toFixed(2)}`);
    console.log(`  • Average win rate: ${(avgWinRate * 100).toFixed(1)}%`);
    console.log(`  • Profitable strategies: ${profitableStrategies.length}/${backtests.length}`);
    
    // Best performing strategy
    const bestStrategy = backtests.reduce((best, current) => 
      current.totalReturn > best.totalReturn ? current : best
    );
    
    console.log(`\n🏆 Best Performing Strategy:`);
    console.log(`  • Pair: ${bestStrategy.pair}`);
    console.log(`  • Parameters: Z=${bestStrategy.parameters.zScoreThreshold}, MA=${bestStrategy.parameters.movingAverages}`);
    console.log(`  • Total return: ${bestStrategy.totalReturn.toFixed(2)}%`);
    console.log(`  • Sharpe ratio: ${bestStrategy.sharpeRatio.toFixed(2)}`);
    console.log(`  • Win rate: ${(bestStrategy.winRatio * 100).toFixed(1)}%`);
    
    // Strategy insights
    console.log(`\n💡 Insights:`);
    if (avgReturn < 0) {
      console.log(`  • Overall negative performance suggests need for strategy refinement`);
    }
    if (avgSharpe < 0) {
      console.log(`  • Poor risk-adjusted returns indicate high volatility relative to returns`);
    }
    if (avgWinRate < 0.5) {
      console.log(`  • Low win rate suggests entry/exit signals need optimization`);
    }
    
    console.log(`\n📋 Individual Results:`);
    backtests.forEach((bt, index) => {
      console.log(`  ${index + 1}. ${bt.pair} (Z=${bt.parameters.zScoreThreshold}): ${bt.totalReturn.toFixed(2)}% return, ${(bt.winRatio * 100).toFixed(1)}% win rate`);
    });
  }

  /**
   * Main analysis function
   */
  async analyzeBacktestResults(): Promise<void> {
    console.log('🎯 Starting backtest results analysis...');
    
    const backtests = await this.fetchBacktestRuns();
    
    if (backtests.length === 0) {
      console.warn('⚠️ No backtest results found. Run some backtests first.');
      return;
    }
    
    // Generate comparison chart
    console.log('🎨 Generating comparison charts...');
    const html = this.generateComparisonChart(backtests);
    
    // Save chart to file
    const filePath = await this.saveComparisonChart(html);
    
    // Generate analysis report
    this.generateAnalysisReport(backtests);
    
    console.log('\n🎉 Backtest analysis completed successfully!');
    console.log(`📊 Comparison chart saved to: ${filePath}`);
    console.log(`🌐 Open the HTML file in a web browser to view the interactive charts.`);
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
    console.log('\n🧹 Database connection closed');
  }
}

/**
 * Main execution function
 */
async function main() {
  const analyzer = new BacktestAnalyzer();

  try {
    await analyzer.initialize();
    await analyzer.analyzeBacktestResults();
  } catch (error) {
    console.error('\n💥 Backtest analysis failed:', error);
    process.exit(1);
  } finally {
    await analyzer.cleanup();
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { BacktestAnalyzer };