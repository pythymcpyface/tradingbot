#!/usr/bin/env ts-node

/**
 * Enhanced 3D Parameter Optimization Analysis with Success Metrics
 * 
 * This script creates comprehensive 3D visualization reports that analyze
 * parameter combinations using advanced success metrics for mixed window results.
 * 
 * Features:
 * - Multiple 3D charts for different success metrics
 * - Calmar Ratio (Return/Drawdown) optimization
 * - Profit Factor analysis
 * - Strategy grading (A+ to F)
 * - Risk-adjusted scoring
 * - Kelly percentage for position sizing
 * 
 * Usage: 
 *   npm run generate3DOptimizationReport [baseAsset] [quoteAsset]  # Specific pair
 *   npm run generate3DOptimizationReport [baseAsset]              # All quote assets for baseAsset
 * Examples:
 *   npm run generate3DOptimizationReport ETH USDT    # ETH/USDT specific
 *   npm run generate3DOptimizationReport ETH         # All ETH pairs (ETH/USDT, ETH/BTC, etc.)
 */

import { PrismaClient } from '@prisma/client';
import { BacktestSuccessAnalyzer, WindowResult } from '../src/utils/BacktestSuccessMetrics';
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

config();

interface EnhancedOptimizationDataPoint {
  // Parameter combination
  zScoreThreshold: number;
  profitPercent: number;
  stopLossPercent: number;
  movingAverages: number;
  
  // Original metrics
  annualizedReturn: number;
  sharpeRatio: number;
  alpha: number;
  maxDrawdown: number;
  winRatio: number;
  totalTrades: number;
  
  // Enhanced success metrics
  calmarRatio: number;
  sortinoRatio: number;
  profitFactor: number;
  kellyPercentage: number;
  compositeScore: number;
  riskAdjustedScore: number;
  strategyGrade: string;
  riskLevel: string;
  
  // Derived insights
  isTopPerformer: boolean;
  riskCategory: 'Conservative' | 'Moderate' | 'Aggressive';
  recommendation: string;
  
  // For baseAsset analysis
  quoteAsset?: string;
}

interface OptimizationInsights {
  bestCalmar: EnhancedOptimizationDataPoint;
  bestProfitFactor: EnhancedOptimizationDataPoint;
  bestComposite: EnhancedOptimizationDataPoint;
  mostConsistent: EnhancedOptimizationDataPoint;
  safestHigh: EnhancedOptimizationDataPoint;
  riskAdjustedBest: EnhancedOptimizationDataPoint;
  
  // Parameter insights
  optimalZScoreRange: { min: number; max: number };
  optimalProfitRange: { min: number; max: number };
  optimalStopRange: { min: number; max: number };
  
  // Strategy insights
  gradeDistribution: Record<string, number>;
  riskDistribution: Record<string, number>;
  averageKellySize: number;
}

class Enhanced3DOptimizationReporter {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async initialize(): Promise<void> {
    await this.prisma.$connect();
    console.log('✅ Connected to database');
  }

  /**
   * Enhanced analysis with comprehensive success metrics
   */
  async analyzeOptimizationResults(baseAsset: string, quoteAsset?: string): Promise<{
    data: EnhancedOptimizationDataPoint[];
    insights: OptimizationInsights;
  }> {
    if (quoteAsset) {
      console.log(`📊 Enhanced analysis for ${baseAsset}/${quoteAsset}...`);
    } else {
      console.log(`📊 Enhanced analysis for all ${baseAsset} pairs...`);
    }

    // Build where clause
    const whereClause: any = { baseAsset };
    if (quoteAsset) {
      whereClause.quoteAsset = quoteAsset;
    }

    // Get optimization results with individual trades/windows
    const results = await this.prisma.optimizationResults.findMany({
      where: whereClause,
      include: {
        // If you have individual window/trade results, include them
        // For now, we'll simulate from aggregate data
      }
    });

    if (results.length === 0) {
      const pairDesc = quoteAsset ? `${baseAsset}/${quoteAsset}` : `${baseAsset} (any quote asset)`;
      throw new Error(`No results found for ${pairDesc}`);
    }

    console.log(`   ✅ Analyzing ${results.length} parameter combinations...`);

    // Enhance each data point with success metrics
    const enhancedData: EnhancedOptimizationDataPoint[] = results.map(result => {
      return this.enhanceDataPoint(result);
    });

    // Generate insights
    const insights = this.generateInsights(enhancedData);

    return { data: enhancedData, insights };
  }

  /**
   * Enhance a single data point with comprehensive success metrics
   */
  private enhanceDataPoint(result: any): EnhancedOptimizationDataPoint {
    // Simulate window results from aggregate data (in real implementation, 
    // you'd get actual window results from database)
    const windowResults = this.simulateWindowResults(result);
    
    // Calculate enhanced metrics
    const successMetrics = BacktestSuccessAnalyzer.analyzeWindowResults(windowResults);

    // Calculate additional derived metrics
    const calmarRatio = result.maxDrawdown > 0 ? 
      result.annualizedReturn / result.maxDrawdown : 0;
    
    // Estimate profit factor from win ratio and returns
    const profitFactor = this.estimateProfitFactor(
      result.winRatio, 
      result.annualizedReturn, 
      result.maxDrawdown
    );

    return {
      // Parameters
      zScoreThreshold: parseFloat(result.zScoreThreshold.toString()),
      profitPercent: parseFloat(result.profitPercent.toString()),
      stopLossPercent: parseFloat(result.stopLossPercent.toString()),
      movingAverages: result.movingAverages,
      
      // Original metrics
      annualizedReturn: parseFloat(result.annualizedReturn.toString()),
      sharpeRatio: parseFloat(result.sharpeRatio.toString()),
      alpha: parseFloat((result.alpha || 0).toString()),
      maxDrawdown: parseFloat(result.maxDrawdown.toString()),
      winRatio: parseFloat(result.winRatio.toString()),
      totalTrades: result.totalTrades,
      
      // Enhanced metrics
      calmarRatio,
      sortinoRatio: successMetrics.sortinoRatio,
      profitFactor,
      kellyPercentage: successMetrics.kellyPercentage,
      compositeScore: successMetrics.compositeScore,
      riskAdjustedScore: successMetrics.riskAdjustedScore,
      strategyGrade: successMetrics.strategyGrade,
      riskLevel: successMetrics.riskLevel,
      
      // Derived insights
      isTopPerformer: successMetrics.compositeScore > 75,
      riskCategory: this.categorizeRisk(result.maxDrawdown, result.sharpeRatio),
      recommendation: successMetrics.recommendation
    };
  }

  /**
   * Simulate window results from aggregate data
   * (In production, you'd store actual window results)
   */
  private simulateWindowResults(result: any): WindowResult[] {
    const totalWindows = 12; // Assume monthly windows
    const avgReturn = result.annualizedReturn / 12;
    const volatility = avgReturn / (result.sharpeRatio || 1);
    const winRate = result.winRatio;
    
    const windows: WindowResult[] = [];
    
    for (let i = 0; i < totalWindows; i++) {
      // Simulate realistic return distribution
      const isWin = Math.random() < winRate;
      const baseReturn = isWin ? 
        Math.abs(avgReturn) + Math.random() * volatility :
        -Math.abs(avgReturn) * (1 - winRate) / winRate - Math.random() * volatility;
      
      windows.push({
        return: baseReturn,
        duration: 30,
        startDate: new Date(2024, i, 1),
        endDate: new Date(2024, i, 30),
        trades: Math.floor(result.totalTrades / totalWindows)
      });
    }
    
    return windows;
  }

  /**
   * Estimate profit factor from available metrics
   */
  private estimateProfitFactor(winRatio: number, annualizedReturn: number, maxDrawdown: number): number {
    // Simple estimation - in production you'd calculate from actual trades
    if (winRatio <= 0 || winRatio >= 1) return 1;
    
    const avgWin = Math.abs(annualizedReturn) * (2 / winRatio);
    const avgLoss = Math.abs(annualizedReturn) * (1 / (1 - winRatio));
    
    return avgWin / avgLoss;
  }

  /**
   * Categorize risk level
   */
  private categorizeRisk(maxDrawdown: number, sharpeRatio: number): 'Conservative' | 'Moderate' | 'Aggressive' {
    if (maxDrawdown < 0.1 && sharpeRatio > 1) return 'Conservative';
    if (maxDrawdown < 0.2 && sharpeRatio > 0.5) return 'Moderate';
    return 'Aggressive';
  }

  /**
   * Generate comprehensive insights
   */
  private generateInsights(data: EnhancedOptimizationDataPoint[]): OptimizationInsights {
    // Find best performers by different metrics
    const bestCalmar = data.reduce((best, curr) => 
      curr.calmarRatio > best.calmarRatio ? curr : best);
    
    const bestProfitFactor = data.reduce((best, curr) => 
      curr.profitFactor > best.profitFactor ? curr : best);
    
    const bestComposite = data.reduce((best, curr) => 
      curr.compositeScore > best.compositeScore ? curr : best);
    
    const mostConsistent = data.reduce((best, curr) => 
      curr.maxDrawdown < best.maxDrawdown ? curr : best);
    
    // Best high-return with acceptable risk
    const safestHigh = data
      .filter(d => d.annualizedReturn > 0.2 && d.maxDrawdown < 0.15)
      .reduce((best, curr) => 
        curr.calmarRatio > best.calmarRatio ? curr : best, data[0]);
    
    const riskAdjustedBest = data.reduce((best, curr) => 
      curr.riskAdjustedScore > best.riskAdjustedScore ? curr : best);

    // Parameter range analysis
    const topPerformers = data.filter(d => d.compositeScore > 70);
    
    const optimalZScoreRange = {
      min: Math.min(...topPerformers.map(d => d.zScoreThreshold)),
      max: Math.max(...topPerformers.map(d => d.zScoreThreshold))
    };
    
    const optimalProfitRange = {
      min: Math.min(...topPerformers.map(d => d.profitPercent)),
      max: Math.max(...topPerformers.map(d => d.profitPercent))
    };
    
    const optimalStopRange = {
      min: Math.min(...topPerformers.map(d => d.stopLossPercent)),
      max: Math.max(...topPerformers.map(d => d.stopLossPercent))
    };

    // Distribution analysis
    const gradeDistribution: Record<string, number> = {};
    const riskDistribution: Record<string, number> = {};
    
    data.forEach(d => {
      gradeDistribution[d.strategyGrade] = (gradeDistribution[d.strategyGrade] || 0) + 1;
      riskDistribution[d.riskLevel] = (riskDistribution[d.riskLevel] || 0) + 1;
    });

    const averageKellySize = data.reduce((sum, d) => sum + d.kellyPercentage, 0) / data.length;

    return {
      bestCalmar,
      bestProfitFactor,
      bestComposite,
      mostConsistent,
      safestHigh,
      riskAdjustedBest,
      optimalZScoreRange,
      optimalProfitRange,
      optimalStopRange,
      gradeDistribution,
      riskDistribution,
      averageKellySize
    };
  }

  /**
   * Generate enhanced 3D visualization HTML
   */
  generateEnhanced3DHTML(
    data: EnhancedOptimizationDataPoint[], 
    insights: OptimizationInsights,
    baseAsset: string,
    quoteAsset?: string
  ): string {
    const charts = [
      { metric: 'calmarRatio', title: 'Calmar Ratio (Return/Drawdown)', colorScale: 'Viridis' },
      { metric: 'compositeScore', title: 'Composite Success Score', colorScale: 'Plasma' },
      { metric: 'riskAdjustedScore', title: 'Risk-Adjusted Score', colorScale: 'Cividis' },
      { metric: 'profitFactor', title: 'Profit Factor', colorScale: 'Turbo' },
      { metric: 'kellyPercentage', title: 'Kelly Percentage (Position Size)', colorScale: 'RdYlGn' },
    ];

    const chartElements = charts.map((chart, index) => {
      const values = data.map(d => d[chart.metric as keyof EnhancedOptimizationDataPoint] as number);
      const minValue = Math.min(...values);
      const maxValue = Math.max(...values);

      const trace = {
        x: data.map(d => d.stopLossPercent),
        y: data.map(d => d.profitPercent),
        z: data.map(d => d.zScoreThreshold),
        mode: 'markers',
        marker: {
          size: data.map(d => Math.max(3, d.totalTrades / 100)), // Size based on trade count
          color: values,
          colorscale: chart.colorScale,
          cmin: minValue,
          cmax: maxValue,
          cauto: false,
          colorbar: {
            title: chart.title,
            titleside: 'right'
          },
          opacity: 0.8
        },
        text: data.map(d => 
          `Parameters: ${d.zScoreThreshold}/${d.profitPercent}%/${d.stopLossPercent}%<br>` +
          `${chart.title}: ${(d[chart.metric as keyof EnhancedOptimizationDataPoint] as number).toFixed(3)}<br>` +
          `Strategy Grade: ${d.strategyGrade}<br>` +
          `Risk Level: ${d.riskLevel}<br>` +
          `Trades: ${d.totalTrades}<br>` +
          `Recommendation: ${d.recommendation.substring(0, 50)}...`
        ),
        hovertemplate: '%{text}<extra></extra>',
        type: 'scatter3d'
      };

      return `
        <div class="chart-container">
          <div id="chart${index}" style="width: 100%; height: 600px; margin-bottom: 30px;"></div>
          <script>
            Plotly.newPlot('chart${index}', [${JSON.stringify(trace)}], {
              title: '${chart.title} Optimization - ${quoteAsset ? `${baseAsset}/${quoteAsset}` : `${baseAsset} All Pairs`}',
              scene: {
                xaxis: { title: 'Stop Loss %' },
                yaxis: { title: 'Profit %' },
                zaxis: { title: 'Z-Score Threshold' },
                camera: { eye: { x: 1.5, y: 1.5, z: 1.5 } }
              },
              margin: { l: 0, r: 0, t: 50, b: 0 }
            }, {responsive: true});
            
            console.log('${chart.metric} range: ${minValue.toFixed(2)} to ${maxValue.toFixed(2)}');
          </script>
        </div>
      `;
    }).join('\n');

    return `
<!DOCTYPE html>
<html>
<head>
    <title>Enhanced 3D Parameter Optimization - ${quoteAsset ? `${baseAsset}/${quoteAsset}` : `${baseAsset} All Pairs`}</title>
    <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
    <style>
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            margin: 20px; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
        }
        .container { 
            background: white; 
            border-radius: 15px; 
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            padding: 30px;
            margin: 20px auto;
            max-width: 1400px;
        }
        .header { 
            text-align: center; 
            margin-bottom: 40px; 
            color: #2c3e50;
        }
        .insights { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); 
            gap: 20px; 
            margin-bottom: 40px;
        }
        .insight-card { 
            background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
            border-radius: 10px; 
            padding: 20px; 
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        .insight-title { 
            font-weight: bold; 
            color: #2c3e50; 
            margin-bottom: 10px;
            font-size: 1.1em;
        }
        .best-params { 
            background: linear-gradient(135deg, #a8e6cf 0%, #dcedc1 100%);
        }
        .chart-container { 
            background: white; 
            border-radius: 10px; 
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            margin-bottom: 30px;
            padding: 20px;
        }
        .grade-distribution {
            display: flex;
            justify-content: space-around;
            margin: 20px 0;
        }
        .grade-item {
            text-align: center;
            padding: 10px;
            border-radius: 5px;
            background: #f8f9fa;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎯 Enhanced 3D Parameter Optimization Analysis</h1>
            <h2>${quoteAsset ? `${baseAsset}/${quoteAsset}` : `${baseAsset} All Pairs`} Trading Strategy</h2>
            <p>Comprehensive success metrics for mixed positive/negative window results</p>
        </div>

        <div class="insights">
            <div class="insight-card best-params">
                <div class="insight-title">🏆 Best Overall (Calmar Ratio)</div>
                <div>Z-Score: ${insights.bestCalmar.zScoreThreshold}</div>
                <div>Profit: ${insights.bestCalmar.profitPercent}%</div>
                <div>Stop: ${insights.bestCalmar.stopLossPercent}%</div>
                <div>Calmar: ${insights.bestCalmar.calmarRatio.toFixed(3)}</div>
                <div>Grade: ${insights.bestCalmar.strategyGrade}</div>
            </div>

            <div class="insight-card">
                <div class="insight-title">💰 Best Profit Factor</div>
                <div>Z-Score: ${insights.bestProfitFactor.zScoreThreshold}</div>
                <div>Profit: ${insights.bestProfitFactor.profitPercent}%</div>
                <div>Stop: ${insights.bestProfitFactor.stopLossPercent}%</div>
                <div>Profit Factor: ${insights.bestProfitFactor.profitFactor.toFixed(3)}</div>
                <div>Grade: ${insights.bestProfitFactor.strategyGrade}</div>
            </div>

            <div class="insight-card">
                <div class="insight-title">🎯 Highest Composite Score</div>
                <div>Z-Score: ${insights.bestComposite.zScoreThreshold}</div>
                <div>Profit: ${insights.bestComposite.profitPercent}%</div>
                <div>Stop: ${insights.bestComposite.stopLossPercent}%</div>
                <div>Score: ${insights.bestComposite.compositeScore.toFixed(1)}/100</div>
                <div>Grade: ${insights.bestComposite.strategyGrade}</div>
            </div>

            <div class="insight-card">
                <div class="insight-title">🛡️ Safest High Return</div>
                <div>Z-Score: ${insights.safestHigh.zScoreThreshold}</div>
                <div>Profit: ${insights.safestHigh.profitPercent}%</div>
                <div>Stop: ${insights.safestHigh.stopLossPercent}%</div>
                <div>Max DD: ${(insights.safestHigh.maxDrawdown * 100).toFixed(1)}%</div>
                <div>Risk: ${insights.safestHigh.riskLevel}</div>
            </div>

            <div class="insight-card">
                <div class="insight-title">📊 Optimal Ranges</div>
                <div>Z-Score: ${insights.optimalZScoreRange.min} - ${insights.optimalZScoreRange.max}</div>
                <div>Profit: ${insights.optimalProfitRange.min}% - ${insights.optimalProfitRange.max}%</div>
                <div>Stop: ${insights.optimalStopRange.min}% - ${insights.optimalStopRange.max}%</div>
                <div>Avg Kelly: ${(insights.averageKellySize * 100).toFixed(1)}%</div>
            </div>

            <div class="insight-card">
                <div class="insight-title">📈 Strategy Distribution</div>
                <div class="grade-distribution">
                    ${Object.entries(insights.gradeDistribution)
                      .map(([grade, count]) => `
                        <div class="grade-item">
                          <div><strong>${grade}</strong></div>
                          <div>${count}</div>
                        </div>
                      `).join('')}
                </div>
            </div>
        </div>

        ${chartElements}

        <div class="insight-card">
            <div class="insight-title">🔍 Key Insights</div>
            <ul>
                <li><strong>Best Strategy:</strong> ${insights.bestCalmar.strategyGrade} grade with ${insights.bestCalmar.calmarRatio.toFixed(2)} Calmar ratio</li>
                <li><strong>Optimal Position Size:</strong> Average Kelly percentage suggests ${(insights.averageKellySize * 100).toFixed(1)}% allocation</li>
                <li><strong>Risk Management:</strong> Best strategies keep drawdown under ${(insights.safestHigh.maxDrawdown * 100).toFixed(1)}%</li>
                <li><strong>Parameter Sweet Spot:</strong> Z-Score ${insights.optimalZScoreRange.min}-${insights.optimalZScoreRange.max}, Profit ${insights.optimalProfitRange.min}-${insights.optimalProfitRange.max}%</li>
                <li><strong>Success Rate:</strong> ${Object.entries(insights.gradeDistribution).filter(([grade]) => ['A+', 'A', 'B+', 'B'].includes(grade)).reduce((sum, [,count]) => sum + count, 0)} out of ${data.length} combinations are B+ or better</li>
            </ul>
        </div>
    </div>
</body>
</html>`;
  }

  /**
   * Generate and save enhanced report
   */
  async generateReport(baseAsset: string = 'ETH', quoteAsset?: string): Promise<void> {
    try {
      await this.initialize();
      
      console.log('🚀 Generating enhanced 3D optimization report...');
      const { data, insights } = await this.analyzeOptimizationResults(baseAsset, quoteAsset);
      
      const html = this.generateEnhanced3DHTML(data, insights, baseAsset, quoteAsset);
      
      // Ensure analysis directory exists
      const analysisDir = path.join(process.cwd(), 'analysis');
      if (!fs.existsSync(analysisDir)) {
        fs.mkdirSync(analysisDir, { recursive: true });
      }
      
      const filename = `enhanced-3d-optimization-${baseAsset}-${quoteAsset || 'ALL'}-${Date.now()}.html`;
      const filepath = path.join(analysisDir, filename);
      
      fs.writeFileSync(filepath, html);
      
      console.log('✅ Enhanced report generated successfully!');
      console.log(`📁 Location: ${filepath}`);
      console.log(`🌐 Open in browser: file://${filepath}`);
      
      // Print summary
      console.log('\n📊 OPTIMIZATION SUMMARY:');
      console.log(`   Total combinations analyzed: ${data.length}`);
      console.log(`   Best Calmar Ratio: ${insights.bestCalmar.calmarRatio.toFixed(3)} (Grade: ${insights.bestCalmar.strategyGrade})`);
      console.log(`   Best Profit Factor: ${insights.bestProfitFactor.profitFactor.toFixed(3)}`);
      console.log(`   Optimal Z-Score range: ${insights.optimalZScoreRange.min} - ${insights.optimalZScoreRange.max}`);
      console.log(`   Average position size: ${(insights.averageKellySize * 100).toFixed(1)}%`);
      
    } catch (error) {
      console.error('❌ Report generation failed:', error);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const baseAsset = args[0] || 'ETH';
  const quoteAsset = args[1] ? args[1].toUpperCase() : undefined; // Optional quote asset

  const reporter = new Enhanced3DOptimizationReporter();
  
  try {
    await reporter.generateReport(baseAsset.toUpperCase(), quoteAsset);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { Enhanced3DOptimizationReporter };