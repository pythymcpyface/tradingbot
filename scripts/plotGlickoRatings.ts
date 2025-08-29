#!/usr/bin/env ts-node

/**
 * Plot Glicko Ratings Script
 * 
 * This script plots all Glicko-2 ratings from the glicko_ratings table on a chart,
 * including the rating deviation as an uncertainty band. Outputs a single .html file
 * and saves in the analysis directory.
 * 
 * As specified in SPEC.md Stage 3.9
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

config();

interface GlickoRatingData {
  symbol: string;
  timestamp: Date;
  rating: number;
  ratingDeviation: number;
  volatility: number;
  performanceScore: number;
}

interface ChartDataPoint {
  timestamp: string;
  rating: number;
  upperBound: number;
  lowerBound: number;
  volatility: number;
  performanceScore: number;
}

interface CoinChartData {
  symbol: string;
  data: ChartDataPoint[];
  minRating: number;
  maxRating: number;
  latestRating: number;
  ratingChange: number;
}

class GlickoRatingsPlotter {
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
   * Fetch sampled Glicko ratings from database for visualization
   * Samples every Nth record to manage large datasets efficiently
   */
  async fetchAllRatings(): Promise<GlickoRatingData[]> {
    console.log('📊 Fetching Glicko-2 ratings from database...');

    // First, get the total count
    const totalCount = await this.prisma.glickoRatings.count();
    console.log(`📈 Total ratings in database: ${totalCount.toLocaleString()}`);

    // If dataset is large (>100k), sample every Nth record for visualization
    const MAX_POINTS_PER_COIN = 2000; // Reasonable number for chart visualization
    const COINS_COUNT = 12; // Expected number of coins
    const TARGET_TOTAL = MAX_POINTS_PER_COIN * COINS_COUNT;

    let ratings: any[];

    if (totalCount > TARGET_TOTAL) {
      // Calculate sampling interval
      const sampleInterval = Math.ceil(totalCount / TARGET_TOTAL);
      console.log(`📊 Large dataset detected. Sampling every ${sampleInterval} records...`);

      // Use raw query for efficient sampling
      ratings = await this.prisma.$queryRaw`
        SELECT *
        FROM (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY timestamp) as rn
          FROM glicko_ratings
        ) t
        WHERE t.rn % ${sampleInterval} = 1
        ORDER BY symbol ASC, timestamp ASC
      `;
    } else {
      // Fetch all data if dataset is manageable
      console.log('📊 Fetching all ratings data...');
      ratings = await this.prisma.glickoRatings.findMany({
        orderBy: [
          { symbol: 'asc' },
          { timestamp: 'asc' }
        ]
      });
    }

    console.log(`✅ Fetched ${ratings.length.toLocaleString()} ratings for analysis`);

    return ratings.map(r => ({
      symbol: r.symbol,
      timestamp: r.timestamp,
      rating: Number(r.rating),
      ratingDeviation: Number(r.ratingDeviation),
      volatility: Number(r.volatility),
      performanceScore: Number(r.performanceScore)
    }));
  }

  /**
   * Group ratings by coin symbol
   */
  groupRatingsBySymbol(ratings: GlickoRatingData[]): { [symbol: string]: GlickoRatingData[] } {
    const grouped: { [symbol: string]: GlickoRatingData[] } = {};

    for (const rating of ratings) {
      if (!grouped[rating.symbol]) {
        grouped[rating.symbol] = [];
      }
      grouped[rating.symbol].push(rating);
    }

    return grouped;
  }

  /**
   * Convert ratings to chart data format
   */
  convertToChartData(groupedRatings: { [symbol: string]: GlickoRatingData[] }): CoinChartData[] {
    console.log('📈 Converting ratings to chart data format...');

    const chartData: CoinChartData[] = [];

    for (const [symbol, ratings] of Object.entries(groupedRatings)) {
      if (ratings.length === 0) continue;

      const data: ChartDataPoint[] = ratings.map(r => ({
        timestamp: r.timestamp.toISOString(),
        rating: r.rating,
        upperBound: r.rating + r.ratingDeviation, // Upper uncertainty band
        lowerBound: r.rating - r.ratingDeviation, // Lower uncertainty band
        volatility: r.volatility,
        performanceScore: r.performanceScore
      }));

      const minRating = Math.min(...ratings.map(r => r.rating - r.ratingDeviation));
      const maxRating = Math.max(...ratings.map(r => r.rating + r.ratingDeviation));
      const latestRating = ratings[ratings.length - 1].rating;
      const firstRating = ratings[0].rating;
      const ratingChange = latestRating - firstRating;

      chartData.push({
        symbol,
        data,
        minRating,
        maxRating,
        latestRating,
        ratingChange
      });
    }

    // Sort by latest rating (descending)
    chartData.sort((a, b) => b.latestRating - a.latestRating);

    console.log(`✅ Processed chart data for ${chartData.length} coins`);
    return chartData;
  }

  /**
   * Generate color palette for different coins
   */
  generateColors(count: number): string[] {
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
      '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
      '#F8C471', '#82E0AA', '#F1948A', '#85C1E9', '#F4D03F'
    ];

    // Repeat colors if we need more
    const result = [];
    for (let i = 0; i < count; i++) {
      result.push(colors[i % colors.length]);
    }

    return result;
  }

  /**
   * Generate HTML chart using Chart.js
   */
  generateHTMLChart(chartData: CoinChartData[]): string {
    const colors = this.generateColors(chartData.length);
    const now = new Date().toISOString();

    // Prepare datasets for Chart.js
    const datasets = chartData.flatMap((coinData, index) => [
      // Main rating line
      {
        label: `${coinData.symbol} Rating`,
        data: coinData.data.map(d => ({ x: d.timestamp, y: d.rating })),
        borderColor: colors[index],
        backgroundColor: colors[index] + '20',
        borderWidth: 2,
        pointRadius: 1,
        pointHoverRadius: 4,
        fill: false,
        tension: 0.1
      },
      // Upper uncertainty band
      {
        label: `${coinData.symbol} Upper Bound`,
        data: coinData.data.map(d => ({ x: d.timestamp, y: d.upperBound })),
        borderColor: colors[index] + '40',
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderDash: [5, 5],
        pointRadius: 0,
        fill: false,
        hidden: true
      },
      // Lower uncertainty band
      {
        label: `${coinData.symbol} Lower Bound`,
        data: coinData.data.map(d => ({ x: d.timestamp, y: d.lowerBound })),
        borderColor: colors[index] + '40',
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderDash: [5, 5],
        pointRadius: 0,
        fill: '-1' // Fill between this and the previous dataset (upper bound)
      }
    ]);

    const summaryTable = chartData.map((coin, index) => `
      <tr>
        <td style="color: ${colors[index]};">●</td>
        <td><strong>${coin.symbol}</strong></td>
        <td>${coin.latestRating.toFixed(0)}</td>
        <td style="color: ${coin.ratingChange >= 0 ? '#27AE60' : '#E74C3C'};">
          ${coin.ratingChange >= 0 ? '+' : ''}${coin.ratingChange.toFixed(0)}
        </td>
        <td>${coin.data.length.toLocaleString()}</td>
        <td>${coin.minRating.toFixed(0)} - ${coin.maxRating.toFixed(0)}</td>
      </tr>
    `).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Glicko-2 Ratings Analysis</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/date-fns@2.29.3/index.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@2.0.1/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
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
            height: 600px;
            margin: 30px 0;
        }
        .summary-section {
            margin-top: 40px;
        }
        .summary-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
            font-size: 14px;
        }
        .summary-table th,
        .summary-table td {
            padding: 12px;
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
        .legend-note {
            background: #e8f4fd;
            border-left: 4px solid #3498db;
            padding: 15px;
            margin: 20px 0;
            border-radius: 4px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎯 Glicko-2 Ratings Analysis</h1>
        
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
                <div class="stat-value">${chartData.length}</div>
                <div class="stat-label">Coins Analyzed</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${chartData.reduce((sum, coin) => sum + coin.data.length, 0).toLocaleString()}</div>
                <div class="stat-label">Total Data Points</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${Math.round(chartData.reduce((sum, coin) => sum + coin.latestRating, 0) / chartData.length)}</div>
                <div class="stat-label">Average Rating</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${chartData.filter(coin => coin.ratingChange > 0).length}</div>
                <div class="stat-label">Improving Coins</div>
            </div>
        </div>

        <div class="legend-note">
            <strong>Chart Legend:</strong> 
            • Solid lines represent Glicko-2 ratings over time
            • Dotted lines show uncertainty bounds (rating ± deviation)
            • Shaded areas indicate confidence intervals
            • Higher ratings suggest better recent performance
        </div>

        <div class="chart-container">
            <canvas id="glickoChart"></canvas>
        </div>

        <div class="summary-section">
            <h2>📊 Rating Summary</h2>
            <table class="summary-table">
                <thead>
                    <tr>
                        <th></th>
                        <th>Coin</th>
                        <th>Latest Rating</th>
                        <th>Change</th>
                        <th>Data Points</th>
                        <th>Range</th>
                    </tr>
                </thead>
                <tbody>
                    ${summaryTable}
                </tbody>
            </table>
        </div>
    </div>

    <script>
        const ctx = document.getElementById('glickoChart').getContext('2d');
        
        const chart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: ${JSON.stringify(datasets)}
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: 'Glicko-2 Ratings Over Time',
                        font: {
                            size: 18,
                            weight: 'bold'
                        },
                        padding: 20
                    },
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            filter: function(legendItem, chartData) {
                                // Only show main rating lines in legend
                                return legendItem.text.includes('Rating') && !legendItem.text.includes('Bound');
                            },
                            usePointStyle: true,
                            pointStyle: 'line',
                            padding: 15
                        }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            title: function(tooltipItems) {
                                return new Date(tooltipItems[0].parsed.x).toLocaleDateString();
                            },
                            label: function(context) {
                                const label = context.dataset.label;
                                const value = Math.round(context.parsed.y);
                                
                                if (label.includes('Rating')) {
                                    return \`\${label}: \${value}\`;
                                }
                                return null; // Hide bound tooltips
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            display: true,
                            tooltipFormat: 'MMM dd, yyyy'
                        },
                        title: {
                            display: true,
                            text: 'Time',
                            font: {
                                size: 14,
                                weight: 'bold'
                            }
                        },
                        grid: {
                            color: '#e9ecef'
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'Glicko-2 Rating',
                            font: {
                                size: 14,
                                weight: 'bold'
                            }
                        },
                        grid: {
                            color: '#e9ecef'
                        },
                        beginAtZero: false
                    }
                },
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                elements: {
                    line: {
                        tension: 0.1
                    }
                }
            }
        });

        // Add click handler for legend to toggle uncertainty bands
        chart.options.plugins.legend.onClick = function(e, legendItem, legend) {
            const index = legendItem.datasetIndex;
            const chart = legend.chart;
            const meta = chart.getDatasetMeta(index);
            
            // Toggle main line
            meta.hidden = meta.hidden === null ? !chart.data.datasets[index].hidden : null;
            
            // Also toggle corresponding uncertainty bands
            const symbol = legendItem.text.replace(' Rating', '');
            chart.data.datasets.forEach((dataset, i) => {
                if (dataset.label.includes(symbol) && dataset.label.includes('Bound')) {
                    const boundMeta = chart.getDatasetMeta(i);
                    boundMeta.hidden = meta.hidden;
                }
            });
            
            chart.update();
        };
    </script>
</body>
</html>`;
  }

  /**
   * Save HTML chart to analysis directory
   */
  async saveHTMLChart(html: string): Promise<string> {
    const analysisDir = path.join(process.cwd(), 'analysis');
    
    // Ensure analysis directory exists
    if (!fs.existsSync(analysisDir)) {
      fs.mkdirSync(analysisDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `glicko-ratings-${timestamp}.html`;
    const filePath = path.join(analysisDir, filename);
    
    fs.writeFileSync(filePath, html);
    console.log(`📁 Chart saved to: ${filePath}`);
    
    return filePath;
  }

  /**
   * Generate comprehensive analysis report
   */
  generateAnalysisReport(chartData: CoinChartData[]): void {
    console.log('\n📈 Glicko-2 Ratings Analysis Report:');
    console.log('=' .repeat(60));
    
    const totalDataPoints = chartData.reduce((sum, coin) => sum + coin.data.length, 0);
    const avgRating = chartData.reduce((sum, coin) => sum + coin.latestRating, 0) / chartData.length;
    const improvingCoins = chartData.filter(coin => coin.ratingChange > 0);
    const decliningCoins = chartData.filter(coin => coin.ratingChange < 0);
    
    console.log(`📊 Overall Statistics:`);
    console.log(`  • Total coins analyzed: ${chartData.length}`);
    console.log(`  • Total data points: ${totalDataPoints.toLocaleString()}`);
    console.log(`  • Average rating: ${avgRating.toFixed(1)}`);
    console.log(`  • Improving coins: ${improvingCoins.length} (${((improvingCoins.length / chartData.length) * 100).toFixed(1)}%)`);
    console.log(`  • Declining coins: ${decliningCoins.length} (${((decliningCoins.length / chartData.length) * 100).toFixed(1)}%)`);
    
    console.log(`\n🏆 Top 5 Performing Coins (by latest rating):`);
    chartData.slice(0, 5).forEach((coin, index) => {
      const changeIcon = coin.ratingChange >= 0 ? '📈' : '📉';
      console.log(`  ${index + 1}. ${coin.symbol}: ${coin.latestRating.toFixed(0)} ${changeIcon} (${coin.ratingChange >= 0 ? '+' : ''}${coin.ratingChange.toFixed(0)})`);
    });
    
    console.log(`\n📉 Bottom 5 Performing Coins (by latest rating):`);
    chartData.slice(-5).reverse().forEach((coin, index) => {
      const changeIcon = coin.ratingChange >= 0 ? '📈' : '📉';
      console.log(`  ${index + 1}. ${coin.symbol}: ${coin.latestRating.toFixed(0)} ${changeIcon} (${coin.ratingChange >= 0 ? '+' : ''}${coin.ratingChange.toFixed(0)})`);
    });
  }

  /**
   * Main plotting function
   */
  async plotGlickoRatings(): Promise<void> {
    console.log('🚀 Starting Glicko-2 ratings plotting process...');
    console.log('=' .repeat(70));
    
    // Fetch all ratings data
    const allRatings = await this.fetchAllRatings();
    
    if (allRatings.length === 0) {
      console.warn('⚠️ No Glicko-2 ratings found in database. Run calculateGlickoRatings.ts first.');
      return;
    }
    
    // Group ratings by symbol
    const groupedRatings = this.groupRatingsBySymbol(allRatings);
    
    // Convert to chart data format
    const chartData = this.convertToChartData(groupedRatings);
    
    // Generate HTML chart
    console.log('🎨 Generating interactive HTML chart...');
    const html = this.generateHTMLChart(chartData);
    
    // Save chart to file
    const filePath = await this.saveHTMLChart(html);
    
    // Generate analysis report
    this.generateAnalysisReport(chartData);
    
    console.log('\n🎉 Glicko-2 ratings plotting completed successfully!');
    console.log(`📊 Chart saved to: ${filePath}`);
    console.log(`🌐 Open the HTML file in a web browser to view the interactive chart.`);
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
  const plotter = new GlickoRatingsPlotter();

  try {
    console.log('🎯 Starting Glicko-2 ratings plotting script...');
    console.log('=' .repeat(60));

    await plotter.initialize();
    await plotter.plotGlickoRatings();

  } catch (error) {
    console.error('\n💥 Glicko-2 ratings plotting failed:', error);
    process.exit(1);
  } finally {
    await plotter.cleanup();
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { GlickoRatingsPlotter };